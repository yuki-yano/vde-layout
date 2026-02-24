import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../executor/backend-factory.ts", () => ({
  createTerminalBackend: vi.fn(),
}))

import { createCli, type CoreBridge } from "./index"
import { createMockPresetManager, type MockPresetManager } from "../testing/preset-manager-mock"
import { createTerminalBackend } from "../executor/backend-factory"
import type { TerminalBackend } from "../executor/terminal-backend"
import type { CommandExecutor } from "../contracts"
import type {
  CompilePresetInput,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
  CompiledPreset,
  LayoutPlan,
  PlanEmission,
} from "../core/index"
import { createCoreError } from "../core/errors"

const createTerminalBackendMock = vi.mocked(createTerminalBackend)

const samplePreset: CompiledPreset = {
  name: "development",
  version: "legacy",
  metadata: { source: "preset://dev" },
  layout: {
    kind: "split",
    orientation: "horizontal",
    ratio: [
      { kind: "weight", weight: 1 },
      { kind: "weight", weight: 1 },
    ],
    panes: [
      {
        kind: "terminal",
        name: "main",
        command: "nvim",
        focus: true,
      },
      {
        kind: "terminal",
        name: "aux",
        command: "npm run dev",
      },
    ],
  },
}

const samplePlan: LayoutPlan = {
  focusPaneId: "root.0",
  root: {
    kind: "split",
    id: "root",
    orientation: "horizontal",
    ratio: [
      { kind: "weight", weight: 1 },
      { kind: "weight", weight: 1 },
    ],
    panes: [
      {
        kind: "terminal",
        id: "root.0",
        name: "main",
        command: "nvim",
        focus: true,
      },
      {
        kind: "terminal",
        id: "root.1",
        name: "aux",
        command: "npm run dev",
        focus: false,
      },
    ],
  },
}

const sampleEmission: PlanEmission = {
  steps: [
    {
      id: "root:split:1",
      kind: "split",
      command: ["split-window", "-h", "-t", "root.0", "-p", "50"],
      summary: "split root.0 (-h)",
      targetPaneId: "root.0",
      createdPaneId: "root.1",
      orientation: "horizontal",
      percentage: 50,
    },
    {
      id: "root.0:focus",
      kind: "focus",
      command: ["select-pane", "-t", "root.0"],
      summary: "select pane root.0",
      targetPaneId: "root.0",
    },
  ],
  summary: {
    stepsCount: 2,
    focusPaneId: "root.0",
    initialPaneId: "root.0",
  },
  terminals: [
    {
      virtualPaneId: "root.0",
      command: "nvim",
      cwd: "/repo",
      env: { NODE_ENV: "test" },
      focus: true,
      name: "main",
    },
  ],
  hash: "abc123",
}

describe("CLI WezTerm backend integration", () => {
  let cli: ReturnType<typeof createCli>
  let mockPresetManager: MockPresetManager
  let compilePresetMock: ReturnType<typeof vi.fn>
  let compilePresetFromValueMock: ReturnType<typeof vi.fn>
  let createLayoutPlanMock: ReturnType<typeof vi.fn>
  let emitPlanMock: ReturnType<typeof vi.fn>
  let coreBridge: CoreBridge
  let runExitCode: number
  let consoleOutput: string[] = []
  let errorOutput: string[] = []

  beforeEach(() => {
    createTerminalBackendMock.mockReset()
    mockPresetManager = createMockPresetManager()
    compilePresetMock = vi.fn((): CompilePresetSuccess => ({ preset: samplePreset }))
    compilePresetFromValueMock = vi.fn((): CompilePresetSuccess => ({ preset: samplePreset }))
    createLayoutPlanMock = vi.fn((): CreateLayoutPlanSuccess => ({ plan: samplePlan }))
    emitPlanMock = vi.fn(() => sampleEmission)

    coreBridge = {
      compilePreset: compilePresetMock as unknown as CoreBridge["compilePreset"],
      compilePresetFromValue: compilePresetFromValueMock as unknown as CoreBridge["compilePresetFromValue"],
      createLayoutPlan: createLayoutPlanMock as unknown as CoreBridge["createLayoutPlan"],
      emitPlan: emitPlanMock as unknown as CoreBridge["emitPlan"],
    } as CoreBridge

    const createCommandExecutor = vi.fn(
      ({ dryRun }: { verbose: boolean; dryRun: boolean }): CommandExecutor => ({
        execute: vi.fn(),
        executeMany: vi.fn(),
        isDryRun: vi.fn(() => dryRun),
        logCommand: vi.fn(),
      }),
    )

    cli = createCli({
      presetManager: mockPresetManager,
      createCommandExecutor,
      core: coreBridge,
    })

    runExitCode = 0

    consoleOutput = []
    errorOutput = []
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "))
    })
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "))
    })
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errorOutput.push(args.join(" "))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders wezterm dry-run output with backend-provided steps", async () => {
    const verifyEnvironment = vi.fn(async () => {})
    const applyPlan = vi.fn()
    const getDryRunSteps = vi.fn(
      (): ReturnType<TerminalBackend["getDryRunSteps"]> => [
        {
          backend: "wezterm",
          summary: "split root",
          command: "wezterm cli split-pane --right --percent 50 --pane-id root",
        },
        {
          backend: "wezterm",
          summary: "set cwd root",
          command: "wezterm cli send-text --pane-id root --no-paste -- 'cd \"/repo\"'",
        },
      ],
    )
    let receivedContext: TerminalBackend | undefined
    createTerminalBackendMock.mockImplementation((_kind, context) => {
      receivedContext = {
        verifyEnvironment,
        applyPlan,
        getDryRunSteps,
      }
      // satisfy type checker
      return receivedContext!
    })

    runExitCode = await cli.run(["dev", "--backend", "wezterm", "--dry-run"])

    expect(createTerminalBackendMock).toHaveBeenCalledWith("wezterm", expect.objectContaining({ dryRun: true }))
    expect(verifyEnvironment).toHaveBeenCalledTimes(1)
    expect(applyPlan).not.toHaveBeenCalled()
    expect(getDryRunSteps).toHaveBeenCalledWith(sampleEmission)
    expect(compilePresetFromValueMock).toHaveBeenCalledTimes(1)
    expect(compilePresetMock).not.toHaveBeenCalled()
    expect(consoleOutput.join("\n")).toContain(
      "[wezterm] split root: wezterm cli split-pane --right --percent 50 --pane-id root",
    )
    expect(consoleOutput.join("\n")).toContain(
      "[wezterm] set cwd root: wezterm cli send-text --pane-id root --no-paste -- 'cd \"/repo\"'",
    )
    expect(runExitCode).toBe(0)
  })

  it("uses preset backend when --backend is omitted", async () => {
    mockPresetManager.setPresets({
      default: {
        name: "Default Layout",
        backend: "wezterm",
      },
    })

    const verifyEnvironment = vi.fn(async () => {})
    const applyPlan = vi.fn()
    const getDryRunSteps = vi.fn(() => [])

    createTerminalBackendMock.mockReturnValue({
      verifyEnvironment,
      applyPlan,
      getDryRunSteps,
    })

    runExitCode = await cli.run(["--dry-run"])

    expect(createTerminalBackendMock).toHaveBeenCalledWith("wezterm", expect.objectContaining({ dryRun: true }))
    expect(runExitCode).toBe(0)
  })

  it("propagates wezterm backend failures with detailed error output", async () => {
    const verifyEnvironment = vi.fn(async () => {})
    const getDryRunSteps = vi.fn(() => [])
    const failure = createCoreError("execution", {
      code: "TERMINAL_COMMAND_FAILED",
      message: "WezTerm command failed",
      path: "root",
      details: { command: ["wezterm", "cli", "send-text"], stderr: "boom" },
    })
    const applyPlan = vi.fn(async () => {
      throw failure
    })

    createTerminalBackendMock.mockReturnValue({
      verifyEnvironment,
      applyPlan,
      getDryRunSteps,
    })

    runExitCode = await cli.run(["dev", "--backend", "wezterm"])

    expect(verifyEnvironment).toHaveBeenCalledTimes(1)
    expect(applyPlan).toHaveBeenCalledTimes(1)
    expect(errorOutput.join("\n")).toContain("WezTerm command failed")
    expect(errorOutput.join("\n")).toContain("wezterm cli send-text")
    expect(runExitCode).toBe(1)
  })
})
