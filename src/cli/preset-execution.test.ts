import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Preset } from "../models/types"
import { LogLevel, type Logger } from "../utils/logger"
import type { PlanEmission } from "../core/index"
import { executePreset } from "./preset-execution"
import type { CoreBridge } from "./index"
import type { PresetManager } from "../contracts/preset-manager"
import type { CommandExecutor } from "../contracts/command-executor"
import type { TerminalBackend } from "../executor/terminal-backend"

const createTerminalBackendMock = vi.hoisted(() => vi.fn())

vi.mock("../executor/backend-factory", () => ({
  createTerminalBackend: createTerminalBackendMock,
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

const createMockCore = (emission: PlanEmission): CoreBridge => {
  return {
    compilePreset: vi.fn() as unknown as CoreBridge["compilePreset"],
    compilePresetFromValue: vi.fn(() => ({
      preset: {
        name: "Development",
        version: "legacy",
        metadata: { source: "preset://dev" },
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
})
