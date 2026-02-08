import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../executor/backend-factory.ts", () => ({
  createTerminalBackend: vi.fn(),
}))

import { createCli, type CoreBridge } from "../cli.ts"
import { createMockPresetManager, type MockPresetManager } from "./mocks/preset-manager-mock.ts"
import { createTerminalBackend } from "../executor/backend-factory.ts"
import type { TerminalBackend } from "../executor/terminal-backend.ts"
import type { CommandExecutor } from "../types/command-executor.ts"
import type {
  CompilePresetInput,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
  CompiledPreset,
  LayoutPlan,
  PlanEmission,
} from "../core/index.ts"
import { createCoreError } from "../core/errors.ts"

const createTerminalBackendMock = vi.mocked(createTerminalBackend)

const samplePreset: CompiledPreset = {
  name: "development",
  version: "legacy",
  metadata: { source: "preset://dev" },
  layout: {
    kind: "split",
    orientation: "horizontal",
    ratio: [0.5, 0.5],
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
    ratio: [0.5, 0.5],
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
  let createLayoutPlanMock: ReturnType<typeof vi.fn>
  let emitPlanMock: ReturnType<typeof vi.fn>
  let coreBridge: CoreBridge
  let exitCode: number | undefined
  let processExitCalled = false
  let originalExit: typeof process.exit
  let consoleOutput: string[] = []
  let errorOutput: string[] = []

  beforeEach(() => {
    createTerminalBackendMock.mockReset()
    mockPresetManager = createMockPresetManager()
    compilePresetMock = vi.fn((): CompilePresetSuccess => ({ preset: samplePreset }))
    createLayoutPlanMock = vi.fn((): CreateLayoutPlanSuccess => ({ plan: samplePlan }))
    emitPlanMock = vi.fn(() => sampleEmission)

    coreBridge = {
      compilePreset: compilePresetMock as unknown as CoreBridge["compilePreset"],
      createLayoutPlan: createLayoutPlanMock as unknown as CoreBridge["createLayoutPlan"],
      emitPlan: emitPlanMock as unknown as CoreBridge["emitPlan"],
    }

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

    originalExit = process.exit
    exitCode = undefined
    processExitCalled = false
    process.exit = ((code?: number) => {
      exitCode = code
      processExitCalled = true
      if (code === 0) {
        return
      }
      throw new Error(`Process exited with code ${code}`)
    }) as never

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
    process.exit = originalExit
    vi.restoreAllMocks()
  })

  it("renders wezterm dry-run output with backend-provided steps", async () => {
    const verifyEnvironment = vi.fn(async () => {})
    const applyPlan = vi.fn()
    const getDryRunSteps = vi.fn(() => [
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
    ])
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

    await cli.run(["dev", "--backend", "wezterm", "--dry-run"])

    expect(createTerminalBackendMock).toHaveBeenCalledWith("wezterm", expect.objectContaining({ dryRun: true }))
    expect(verifyEnvironment).toHaveBeenCalledTimes(1)
    expect(applyPlan).not.toHaveBeenCalled()
    expect(getDryRunSteps).toHaveBeenCalledWith(sampleEmission)
    expect(consoleOutput.join("\n")).toContain(
      "[wezterm] split root: wezterm cli split-pane --right --percent 50 --pane-id root",
    )
    expect(consoleOutput.join("\n")).toContain(
      "[wezterm] set cwd root: wezterm cli send-text --pane-id root --no-paste -- 'cd \"/repo\"'",
    )
    expect(processExitCalled).toBe(true)
    expect(exitCode).toBe(0)
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

    await cli.run(["--dry-run"])

    expect(createTerminalBackendMock).toHaveBeenCalledWith("wezterm", expect.objectContaining({ dryRun: true }))
    expect(processExitCalled).toBe(true)
    expect(exitCode).toBe(0)
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

    await expect(cli.run(["dev", "--backend", "wezterm"])).rejects.toThrow("Process exited with code 1")

    expect(verifyEnvironment).toHaveBeenCalledTimes(1)
    expect(applyPlan).toHaveBeenCalledTimes(1)
    expect(errorOutput.join("\n")).toContain("WezTerm command failed")
    expect(errorOutput.join("\n")).toContain("wezterm cli send-text")
    expect(processExitCalled).toBe(true)
    expect(exitCode).toBe(1)
  })
})
