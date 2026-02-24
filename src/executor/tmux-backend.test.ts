import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CommandExecutor } from "../contracts"
import type { PlanEmission } from "../core/emitter"
import { createTmuxBackend } from "../backends/tmux/backend"
import { ErrorCodes } from "../utils/errors"
import { LogLevel } from "../utils/logger"
import type { Logger } from "../utils/logger"
import type { TmuxTerminalBackendContext } from "./terminal-backend"

const { verifyEnvironmentMock, getExecutorMock, getCommandStringMock, executeMock } = vi.hoisted(() => {
  return {
    verifyEnvironmentMock: vi.fn(),
    getExecutorMock: vi.fn(),
    getCommandStringMock: vi.fn((args: string[]) => `tmux ${args.join(" ")}`),
    executeMock: vi.fn(),
  }
})

const { executePlanMock } = vi.hoisted(() => ({
  executePlanMock: vi.fn(),
}))

vi.mock("../backends/tmux/executor.ts", () => {
  return {
    createTmuxExecutor: vi.fn(() => ({
      verifyTmuxEnvironment: verifyEnvironmentMock,
      getExecutor: getExecutorMock,
      getCommandString: getCommandStringMock,
      execute: executeMock,
    })),
  }
})

vi.mock("./plan-runner.ts", () => {
  return {
    executePlan: executePlanMock,
  }
})

const createMockExecutor = (): CommandExecutor => ({
  execute: vi.fn(),
  executeMany: vi.fn(),
  isDryRun: vi.fn(() => false),
  logCommand: vi.fn(),
})

const createMockLogger = (): Logger => {
  const logger: Logger = {
    level: LogLevel.INFO,
    prefix: "",
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    createChild: vi.fn((): Logger => logger),
  }
  return logger
}

const createEmission = (): PlanEmission => ({
  steps: [
    {
      id: "root:split:1",
      kind: "split",
      summary: "split",
      command: ["split-window", "-h"],
      targetPaneId: "root",
      createdPaneId: "root.1",
      orientation: "horizontal",
      percentage: 50,
    },
    {
      id: "root:focus",
      kind: "focus",
      summary: "focus",
      command: ["select-pane", "-t", "root"],
      targetPaneId: "root",
    },
  ],
  summary: {
    stepsCount: 2,
    focusPaneId: "root",
    initialPaneId: "root",
  },
  terminals: [],
  hash: "hash",
})

describe("createTmuxBackend", () => {
  beforeEach(() => {
    verifyEnvironmentMock.mockReset()
    getExecutorMock.mockReset()
    executePlanMock.mockReset()
    getCommandStringMock.mockReset()
    executeMock.mockReset()
    getCommandStringMock.mockImplementation((args: string[]) => `tmux ${args.join(" ")}`)
    executeMock.mockResolvedValue("tmux 3.4")
  })

  const createContext = (overrides: Partial<TmuxTerminalBackendContext> = {}): TmuxTerminalBackendContext => ({
    executor: createMockExecutor(),
    logger: createMockLogger(),
    dryRun: false,
    verbose: false,
    prompt: undefined,
    cwd: "/workspace",
    paneId: undefined,
    ...overrides,
  })

  it("delegates environment verification to tmux executor", async () => {
    const context = createContext()
    const backend = createTmuxBackend(context)
    await backend.verifyEnvironment()
    expect(verifyEnvironmentMock).toHaveBeenCalledTimes(1)
  })

  it("skips environment verification when running in dry-run mode", async () => {
    const backend = createTmuxBackend(createContext({ dryRun: true }))
    await backend.verifyEnvironment()
    expect(verifyEnvironmentMock).not.toHaveBeenCalled()
  })

  it("executes plan through plan runner", async () => {
    const emission = createEmission()
    executePlanMock.mockResolvedValue({ executedSteps: 2 })
    const context = createContext()
    getExecutorMock.mockReturnValue(context.executor)

    const backend = createTmuxBackend(context)
    const result = await backend.applyPlan({ emission, windowMode: "new-window", windowName: "test" })

    expect(executePlanMock).toHaveBeenCalledWith({
      emission,
      executor: context.executor,
      windowMode: "new-window",
      windowName: "test",
      onConfirmKill: undefined,
      detectedVersion: undefined,
    })
    expect(result.executedSteps).toBe(2)
  })

  it("provides dry-run steps with tmux command strings", () => {
    const emission = createEmission()
    const backend = createTmuxBackend(createContext())
    const steps = backend.getDryRunSteps(emission)

    expect(steps).toHaveLength(2)
    expect(steps[0]).toEqual({
      backend: "tmux",
      summary: "split",
      command: "tmux split-window -h -t root -p 50",
    })
  })

  it("falls back to <dynamic> in dry-run when dynamic-cells cannot be resolved", () => {
    const originalTMUX = process.env.TMUX
    const originalTMUXPane = process.env.TMUX_PANE
    delete process.env.TMUX
    delete process.env.TMUX_PANE

    try {
      const baseEmission = createEmission()
      const [splitStep, focusStep] = baseEmission.steps
      if (splitStep === undefined || focusStep === undefined) {
        throw new Error("expected split and focus steps")
      }

      const emission: PlanEmission = {
        ...baseEmission,
        steps: [
          {
            ...splitStep,
            splitSizing: {
              mode: "dynamic-cells",
              target: { kind: "fixed-cells", cells: 80 },
              remainingFixedCells: 0,
              remainingWeight: 1,
              remainingWeightPaneCount: 1,
            },
            percentage: undefined,
          },
          focusStep,
        ],
      }

      const backend = createTmuxBackend(createContext())
      const steps = backend.getDryRunSteps(emission)

      expect(steps[0]).toEqual({
        backend: "tmux",
        summary: "split",
        command: "tmux split-window -h -t root -l <dynamic>",
      })
    } finally {
      if (originalTMUX === undefined) {
        delete process.env.TMUX
      } else {
        process.env.TMUX = originalTMUX
      }

      if (originalTMUXPane === undefined) {
        delete process.env.TMUX_PANE
      } else {
        process.env.TMUX_PANE = originalTMUXPane
      }
    }
  })

  it("throws MISSING_TARGET when dry-run split step omits target metadata", () => {
    const backend = createTmuxBackend(createContext())
    const baseEmission = createEmission()
    const [splitStep, focusStep] = baseEmission.steps
    if (splitStep === undefined || focusStep === undefined) {
      throw new Error("expected split and focus steps")
    }

    const emission: PlanEmission = {
      ...baseEmission,
      steps: [
        {
          ...splitStep,
          targetPaneId: undefined,
        },
        focusStep,
      ],
    }

    expect(() => backend.getDryRunSteps(emission)).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.MISSING_TARGET,
        path: splitStep.id,
      }),
    )
  })

  it("uses structured split metadata for dry-run output when available", () => {
    const baseEmission = createEmission()
    const [splitStep, focusStep] = baseEmission.steps
    if (splitStep === undefined || focusStep === undefined) {
      throw new Error("expected split and focus steps")
    }

    const emission: PlanEmission = {
      ...baseEmission,
      steps: [
        {
          ...splitStep,
          command: ["split-window", "-h", "-t", "root", "-p", "99"],
          orientation: "vertical",
          percentage: 33,
        },
        focusStep,
      ],
    }

    const backend = createTmuxBackend(createContext())
    const steps = backend.getDryRunSteps(emission)

    expect(steps[0]).toEqual({
      backend: "tmux",
      summary: "split",
      command: "tmux split-window -v -t root -p 33",
    })
  })

  it("throws INVALID_PLAN when split orientation metadata is missing", () => {
    const baseEmission = createEmission()
    const [splitStep, focusStep] = baseEmission.steps
    if (splitStep === undefined || focusStep === undefined) {
      throw new Error("expected split and focus steps")
    }

    const emission: PlanEmission = {
      ...baseEmission,
      steps: [
        {
          ...splitStep,
          command: ["split-window", "-t", "root", "-p", "40"],
          orientation: undefined,
          percentage: 40,
        },
        focusStep,
      ],
    }

    const backend = createTmuxBackend(createContext())
    expect(() => backend.getDryRunSteps(emission)).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.INVALID_PLAN,
        path: "root:split:1",
      }),
    )
  })

  it("throws INVALID_PLAN when split percentage metadata is missing", () => {
    const baseEmission = createEmission()
    const [splitStep, focusStep] = baseEmission.steps
    if (splitStep === undefined || focusStep === undefined) {
      throw new Error("expected split and focus steps")
    }

    const emission: PlanEmission = {
      ...baseEmission,
      steps: [
        {
          ...splitStep,
          command: ["split-window", "-t", "root", "-p", "40"],
          orientation: "horizontal",
          percentage: undefined,
        },
        focusStep,
      ],
    }

    const backend = createTmuxBackend(createContext())
    expect(() => backend.getDryRunSteps(emission)).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.INVALID_PLAN,
        path: "root:split:1",
      }),
    )
  })

  it("throws INVALID_PLAN when dry-run receives an unknown step kind", () => {
    const backend = createTmuxBackend(createContext())
    const legacyStep = {
      id: "legacy:step",
      kind: "legacy-step",
      summary: "legacy",
      command: ["legacy", "--arg"],
    } as unknown as PlanEmission["steps"][number]

    const emission: PlanEmission = {
      ...createEmission(),
      steps: [legacyStep],
      summary: {
        ...createEmission().summary,
        stepsCount: 1,
      },
    }

    let caughtError: unknown
    try {
      backend.getDryRunSteps(emission)
    } catch (error) {
      caughtError = error
    }

    expect(caughtError).toMatchObject({
      code: ErrorCodes.INVALID_PLAN,
      path: "legacy:step",
    })
  })
})
