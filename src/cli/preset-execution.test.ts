import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Preset } from "../models/types"
import { LogLevel, type Logger } from "../utils/logger"
import type { PlanEmission } from "../core/index"
import { executePreset } from "./preset-execution"
import type { CoreBridge } from "./index"
import type { PresetManager } from "../contracts"
import type { CommandExecutor } from "../contracts"
import type { TerminalBackend } from "../executor/terminal-backend"
import type { CompiledPreset } from "../core/index"

const createTerminalBackendMock = vi.hoisted(() => vi.fn())
const runAfterApplyHookMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("../executor/backend-factory", () => ({
  createTerminalBackend: createTerminalBackendMock,
}))

vi.mock("./after-apply-hook", () => ({
  runAfterApplyHook: runAfterApplyHookMock,
}))

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

const createMockPresetManager = (preset: Preset): PresetManager => {
  return {
    loadConfig: vi.fn(async () => {}),
    getPreset: vi.fn(() => preset),
    getDefaultPreset: vi.fn(() => preset),
    listPresets: vi.fn(() => []),
    getDefaults: vi.fn(() => ({})),
    setConfigPath: vi.fn(),
  }
}

const createMockExecutor = (): CommandExecutor => ({
  execute: vi.fn(),
  executeMany: vi.fn(),
  isDryRun: vi.fn(() => true),
  logCommand: vi.fn(),
})

const createMockCore = (emission: PlanEmission, compiledPresetOverrides: Partial<CompiledPreset> = {}): CoreBridge => {
  return {
    compilePreset: vi.fn() as unknown as CoreBridge["compilePreset"],
    compilePresetFromValue: vi.fn(() => ({
      preset: {
        name: "Development",
        version: "legacy",
        metadata: { source: "preset://dev" },
        ...compiledPresetOverrides,
      },
    })) as unknown as CoreBridge["compilePresetFromValue"],
    createLayoutPlan: vi.fn(() => ({
      plan: {
        focusPaneId: "root",
        root: {
          kind: "terminal",
          id: "root",
          name: "Development",
          focus: true,
        },
      },
    })) as unknown as CoreBridge["createLayoutPlan"],
    emitPlan: vi.fn(() => emission) as unknown as CoreBridge["emitPlan"],
  }
}

describe("executePreset", () => {
  const basePreset = {
    name: "Development",
    backend: "tmux",
  } as unknown as Preset

  const baseEmission: PlanEmission = {
    steps: [],
    summary: {
      stepsCount: 0,
      focusPaneId: "root",
      initialPaneId: "root",
    },
    terminals: [],
    hash: "hash",
  }

  beforeEach(() => {
    createTerminalBackendMock.mockReset()
    runAfterApplyHookMock.mockReset()
    runAfterApplyHookMock.mockResolvedValue(undefined)
  })

  it("runs dry-run flow and renders backend-provided steps", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission)
    const executor = createMockExecutor()
    const output = vi.fn()
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => ({ executedSteps: 0 })),
      getDryRunSteps: vi.fn(() => [
        {
          backend: "tmux" as const,
          summary: "split root",
          command: "tmux split-window -h -t root -p 50",
        },
      ]),
    }
    createTerminalBackendMock.mockReturnValue(backend)

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: false,
        dryRun: true,
        currentWindow: false,
        newWindow: false,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure: vi.fn(() => 1),
      output,
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(output).toHaveBeenCalledWith("[DRY RUN] No actual commands will be executed")
    expect(backend.verifyEnvironment).toHaveBeenCalledTimes(1)
    expect(backend.getDryRunSteps).toHaveBeenCalledWith(baseEmission)
    expect(backend.applyPlan).not.toHaveBeenCalled()
    expect(logger.success).toHaveBeenCalledWith('Applied preset "Development"')
    expect(core.compilePresetFromValue).toHaveBeenCalledWith({
      value: basePreset,
      source: "preset://dev",
    })
  })

  it("runs apply flow and logs executed step count", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission)
    const executor = createMockExecutor()
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => ({ executedSteps: 2 })),
      getDryRunSteps: vi.fn(() => []),
    }
    createTerminalBackendMock.mockReturnValue(backend)

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: true,
        dryRun: false,
        currentWindow: false,
        newWindow: true,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure: vi.fn(() => 1),
      output: vi.fn(),
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(backend.getDryRunSteps).not.toHaveBeenCalled()
    expect(backend.applyPlan).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith("Executed 2 tmux steps")
    expect(runAfterApplyHookMock).not.toHaveBeenCalled()
  })

  it("delegates compile/emit failures to pipeline handler", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission)
    const executor = createMockExecutor()
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => ({ executedSteps: 0 })),
      getDryRunSteps: vi.fn(() => []),
    }
    createTerminalBackendMock.mockReturnValue(backend)
    const pipelineError = new Error("pipeline failed")
    ;(core.compilePresetFromValue as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw pipelineError
    })
    const handlePipelineFailure = vi.fn(() => 1)

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: false,
        dryRun: false,
        currentWindow: false,
        newWindow: false,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure,
      output: vi.fn(),
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(1)
    expect(handlePipelineFailure).toHaveBeenCalledWith(pipelineError)
  })

  it("runs hooks.afterApply once after a successful apply, passing the resolved pane mapping", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission, {
      hooks: { afterApply: "vde-tmux-sidebar open {{pane_id:sidebar}}" },
    })
    const executor = createMockExecutor()
    const paneNameToRealId = new Map([["sidebar", "%2"]])
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => ({ executedSteps: 2, focusPaneId: "%0", paneNameToRealId })),
      getDryRunSteps: vi.fn(() => []),
    }
    createTerminalBackendMock.mockReturnValue(backend)

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: false,
        dryRun: false,
        currentWindow: false,
        newWindow: true,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure: vi.fn(() => 1),
      output: vi.fn(),
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(runAfterApplyHookMock).toHaveBeenCalledTimes(1)
    expect(runAfterApplyHookMock).toHaveBeenCalledWith({
      hookCommand: "vde-tmux-sidebar open {{pane_id:sidebar}}",
      context: { cwd: "/workspace", focusPaneId: "%0", paneNameToRealId },
      logger,
    })
  })

  it("passes the resolved window id from applyPlan through to hooks.afterApply", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission, {
      hooks: { afterApply: "vde-tmux-sidebar layout-applied --window '{{window_id}}'" },
    })
    const executor = createMockExecutor()
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => ({ executedSteps: 2, focusPaneId: "%0", windowId: "@5" })),
      getDryRunSteps: vi.fn(() => []),
    }
    createTerminalBackendMock.mockReturnValue(backend)

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: false,
        dryRun: false,
        currentWindow: false,
        newWindow: true,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure: vi.fn(() => 1),
      output: vi.fn(),
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(runAfterApplyHookMock).toHaveBeenCalledWith({
      hookCommand: "vde-tmux-sidebar layout-applied --window '{{window_id}}'",
      context: { cwd: "/workspace", focusPaneId: "%0", paneNameToRealId: undefined, windowId: "@5" },
      logger,
    })
  })

  it("skips hooks.afterApply during dry-run and renders it as a planned step instead", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission, {
      hooks: { afterApply: "vde-tmux-sidebar open {{pane_id:sidebar}}" },
    })
    const executor = createMockExecutor()
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => ({ executedSteps: 0 })),
      getDryRunSteps: vi.fn(() => []),
    }
    createTerminalBackendMock.mockReturnValue(backend)
    const output = vi.fn()

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: false,
        dryRun: true,
        currentWindow: false,
        newWindow: false,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure: vi.fn(() => 1),
      output,
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(backend.applyPlan).not.toHaveBeenCalled()
    expect(runAfterApplyHookMock).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith(expect.stringContaining("Planned hooks (dry-run)"))
    expect(output).toHaveBeenCalledWith(" 1. [afterApply] vde-tmux-sidebar open {{pane_id:sidebar}}")
  })

  it("does not run hooks.afterApply when applyPlan fails", async () => {
    const logger = createMockLogger()
    const presetManager = createMockPresetManager(basePreset)
    const core = createMockCore(baseEmission, {
      hooks: { afterApply: "vde-tmux-sidebar open {{pane_id:sidebar}}" },
    })
    const executor = createMockExecutor()
    const applyError = new Error("apply failed")
    const backend: TerminalBackend = {
      verifyEnvironment: vi.fn(async () => {}),
      applyPlan: vi.fn(async () => {
        throw applyError
      }),
      getDryRunSteps: vi.fn(() => []),
    }
    createTerminalBackendMock.mockReturnValue(backend)
    const handlePipelineFailure = vi.fn(() => 1)

    const exitCode = await executePreset({
      presetName: "dev",
      options: {
        verbose: false,
        dryRun: false,
        currentWindow: false,
        newWindow: false,
      },
      presetManager,
      createCommandExecutor: vi.fn(() => executor),
      core,
      logger,
      handleError: vi.fn(() => 1),
      handlePipelineFailure,
      output: vi.fn(),
      cwd: "/workspace",
      env: {},
    })

    expect(exitCode).toBe(1)
    expect(handlePipelineFailure).toHaveBeenCalledWith(applyError)
    expect(runAfterApplyHookMock).not.toHaveBeenCalled()
  })
})
