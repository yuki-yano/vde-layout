import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import packageJson from "../../package.json"
import { createCli, type CLI, type CoreBridge } from "./index"
import { createMockPresetManager, type MockPresetManager } from "../testing/preset-manager-mock"
import type { CommandExecutor } from "../contracts"
import type {
  CompilePresetInput,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
  PlanEmission,
  CompiledPreset,
  PlanNode,
  LayoutPlan,
} from "../core/index"

const createRecordingExecutor = (
  dryRun: boolean,
): CommandExecutor & { readonly commands: string[][]; readonly getPaneIds: () => string[] } => {
  const state = {
    commands: [] as string[][],
    paneIds: ["%0"] as string[],
    paneCounter: 0,
  }

  const parseArgs = (command: string | string[]): string[] => {
    return typeof command === "string"
      ? command
          .split(" ")
          .filter((segment) => segment.length > 0)
          .slice(1)
      : command
  }

  const execute = async (command: string | string[]): Promise<string> => {
    const args = parseArgs(command)
    state.commands.push([...args])

    const [cmd] = args
    if (cmd === "display-message" && args.includes("#{pane_id}")) {
      return state.paneIds[0] ?? "%0"
    }

    if (cmd === "list-panes" && args.includes("#{pane_id}")) {
      return state.paneIds.join("\n")
    }

    if (cmd === "split-window") {
      state.paneCounter += 1
      const newId = `%${state.paneCounter}`
      state.paneIds = [...state.paneIds, newId]
    }

    return ""
  }

  const executeMany = async (commandsList: string[][]): Promise<void> => {
    for (const command of commandsList) {
      await execute(command)
    }
  }

  const isDryRun = (): boolean => dryRun

  const logCommand = (): void => {}

  const getPaneIds = () => state.paneIds

  return {
    commands: state.commands,
    execute,
    executeMany,
    isDryRun,
    logCommand,
    getPaneIds,
  }
}

describe("CLI", () => {
  const packageVersion = packageJson.version
  let cli: CLI
  let mockPresetManager: MockPresetManager
  let recordingExecutor: ReturnType<typeof createRecordingExecutor>
  let originalTMUX: string | undefined
  let runExitCode: number
  let consoleOutput: string[] = []
  let errorOutput: string[] = []

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
    hash: "abc123",
    terminals: [
      {
        virtualPaneId: "root.0",
        command: "nvim",
        cwd: "/repo",
        env: { NODE_ENV: "test" },
        focus: true,
        name: "main",
      },
      {
        virtualPaneId: "root.1",
        command: "npm run dev",
        cwd: undefined,
        env: undefined,
        focus: false,
        name: "aux",
      },
    ],
  }

  let compilePresetMock: ReturnType<typeof vi.fn>
  let compilePresetFromValueMock: ReturnType<typeof vi.fn>
  let createLayoutPlanMock: ReturnType<typeof vi.fn>
  let emitPlanMock: ReturnType<typeof vi.fn>
  let coreBridge: CoreBridge

  beforeEach(() => {
    mockPresetManager = createMockPresetManager()
    originalTMUX = process.env.TMUX
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"

    compilePresetMock = vi.fn((): CompilePresetSuccess => ({ preset: samplePreset }))
    compilePresetFromValueMock = vi.fn((): CompilePresetSuccess => ({ preset: samplePreset }))
    createLayoutPlanMock = vi.fn((): CreateLayoutPlanSuccess => ({ plan: samplePlan }))
    emitPlanMock = vi.fn(() => sampleEmission)

    const createCommandExecutor = vi.fn(({ dryRun }: { verbose: boolean; dryRun: boolean }) => {
      recordingExecutor = createRecordingExecutor(dryRun)
      return recordingExecutor
    })

    coreBridge = {
      compilePreset: compilePresetMock as unknown as CoreBridge["compilePreset"],
      compilePresetFromValue: compilePresetFromValueMock as unknown as CoreBridge["compilePresetFromValue"],
      createLayoutPlan: createLayoutPlanMock as unknown as CoreBridge["createLayoutPlan"],
      emitPlan: emitPlanMock as unknown as CoreBridge["emitPlan"],
    } as CoreBridge

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
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errorOutput.push(args.join(" "))
    })
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "))
    })
  })

  afterEach(() => {
    if (originalTMUX !== undefined) {
      process.env.TMUX = originalTMUX
    } else {
      delete process.env.TMUX
    }
    vi.restoreAllMocks()
  })

  const expectCorePipelineCalled = () => {
    expect(compilePresetFromValueMock).toHaveBeenCalled()
    expect(compilePresetMock).not.toHaveBeenCalled()
    expect(createLayoutPlanMock).toHaveBeenCalled()
    expect(emitPlanMock).toHaveBeenCalled()
  }

  describe("basic commands", () => {
    it("should display version", async () => {
      runExitCode = await cli.run(["--version"])
      expect(runExitCode).toBe(0)
    })

    it("should display version with -v", async () => {
      runExitCode = await cli.run(["-v"])
      expect(runExitCode).toBe(0)
    })

    it("should show help with --help", async () => {
      runExitCode = await cli.run(["--help"])
      expect(runExitCode).toBe(0)
    })

    it("should show help with -h", async () => {
      runExitCode = await cli.run(["-h"])
      expect(runExitCode).toBe(0)
    })

    it("treats values after -- as positional arguments", async () => {
      runExitCode = await cli.run(["--", "-h"])
      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain('Preset "-h" not found')
    })
  })

  describe("list command", () => {
    it("should list available presets", async () => {
      runExitCode = await cli.run(["list"])

      expect(consoleOutput.join("\n")).toContain("Available presets")
      expect(consoleOutput.join("\n")).toContain("default")
      expect(consoleOutput.join("\n")).toContain("dev")
      expect(runExitCode).toBe(0)
    })

    it("should handle config loading error", async () => {
      mockPresetManager.setShouldFailOnLoad(true)

      runExitCode = await cli.run(["list"])

      expect(errorOutput.join("\n")).toContain("Error:")
      expect(runExitCode).toBe(1)
    })
  })

  describe("preset execution", () => {
    it("should execute named preset", async () => {
      runExitCode = await cli.run(["dev"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%0", "cd -- '/repo'", "Enter"])
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%0", "export NODE_ENV='test'", "Enter"])
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%0", "nvim", "Enter"])
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%1", "npm run dev", "Enter"])
      expect(consoleOutput.join("\n")).toContain('Applied preset "Development"')
      expect(runExitCode).toBe(0)
    })

    it("should execute default preset when no name provided", async () => {
      runExitCode = await cli.run([])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands.some((command) => command.includes("nvim"))).toBe(true)
      expect(runExitCode).toBe(0)
    })

    it("should handle config loading error", async () => {
      mockPresetManager.setShouldFailOnLoad(true)

      runExitCode = await cli.run(["dev"])

      expect(errorOutput.join("\n")).toContain("Error:")
      expect(runExitCode).toBe(1)
    })

    it("should handle preset not found error", async () => {
      runExitCode = await cli.run(["nonexistent"])

      expect(errorOutput.join("\n")).toContain('Preset "nonexistent" not found')
      expect(runExitCode).toBe(1)
    })
  })

  describe("options", () => {
    it("should accept verbose option", async () => {
      runExitCode = await cli.run(["dev", "--verbose"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands.some((command) => command.includes("nvim"))).toBe(true)
      expect(consoleOutput.join("\n")).toContain("Window mode:")
      expect(runExitCode).toBe(0)
    })

    it("should accept dry-run option", async () => {
      runExitCode = await cli.run(["dev", "--dry-run"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(0)
      expect(consoleOutput.join("\n")).toContain("[DRY RUN]")
      expect(consoleOutput.join("\n")).toContain("Planned terminal steps")
      expect(runExitCode).toBe(0)
    })

    it("should fail when outside tmux without explicit dry-run", async () => {
      delete process.env.TMUX

      runExitCode = await cli.run(["dev"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("Must be run inside a tmux session")
    })

    it("should accept both verbose and dry-run options", async () => {
      runExitCode = await cli.run(["dev", "--verbose", "--dry-run"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(0)
      expect(runExitCode).toBe(0)
    })

    it("should reject when both window override options are provided", async () => {
      runExitCode = await cli.run(["dev", "--current-window", "--new-window"])

      expect(errorOutput.join("\n")).toContain("Cannot use --current-window and --new-window")
      expect(runExitCode).toBe(1)
    })

    it("should allow specifying configuration file via --config", async () => {
      const customPresetManager = createMockPresetManager()
      const cliWithConfig = createCli({
        presetManager: customPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
      })

      await cliWithConfig.run(["dev", "--config", "/tmp/custom.yml", "--dry-run"])

      expect(customPresetManager.getConfigPath()).toBe("/tmp/custom.yml")
      expect(customPresetManager.getConfigPathAtLastLoad()).toBe("/tmp/custom.yml")
    })

    it("selects preset with --select and executes it", async () => {
      const selectPreset = vi.fn(async () => ({
        status: "selected" as const,
        presetName: "dev",
      }))
      const cliWithSelect = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
        selectPreset,
      })

      runExitCode = await cliWithSelect.run(["--select", "--dry-run"])

      expect(runExitCode).toBe(0)
      expect(selectPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          uiMode: "auto",
          surfaceMode: "auto",
          fzfExtraArgs: [],
          skipLoadConfig: true,
        }),
      )
    })

    it("loads config only once when using --select", async () => {
      const loadConfigSpy = vi.spyOn(mockPresetManager, "loadConfig")
      const selectPreset = vi.fn(async () => ({
        status: "selected" as const,
        presetName: "dev",
      }))
      const cliWithSelect = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
        selectPreset,
      })

      runExitCode = await cliWithSelect.run(["--select", "--dry-run"])

      expect(runExitCode).toBe(0)
      expect(loadConfigSpy).toHaveBeenCalledTimes(1)
    })

    it("accepts --select=fzf syntax and passes explicit UI mode", async () => {
      const selectPreset = vi.fn(async () => ({
        status: "selected" as const,
        presetName: "dev",
      }))
      const cliWithSelect = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
        selectPreset,
      })

      runExitCode = await cliWithSelect.run(["--select=fzf", "--dry-run"])

      expect(runExitCode).toBe(0)
      expect(selectPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          uiMode: "fzf",
          surfaceMode: "auto",
          skipLoadConfig: true,
        }),
      )
    })

    it("passes selector surface and fzf args from CLI options", async () => {
      const selectPreset = vi.fn(async () => ({
        status: "selected" as const,
        presetName: "dev",
      }))
      const cliWithSelect = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
        selectPreset,
      })

      runExitCode = await cliWithSelect.run([
        "--select",
        "--select-surface",
        "tmux-popup",
        "--select-tmux-popup-opts",
        "80%,70%",
        "--fzf-arg",
        "--cycle",
        "--fzf-arg",
        "--info=inline",
        "--dry-run",
      ])

      expect(runExitCode).toBe(0)
      expect(selectPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceMode: "tmux-popup",
          tmuxPopupOptions: "80%,70%",
          fzfExtraArgs: ["--cycle", "--info=inline"],
        }),
      )
    })

    it("uses defaults.selector values when select options are omitted", async () => {
      mockPresetManager.setDefaults({
        selector: {
          ui: "fzf",
          surface: "inline",
          tmuxPopupOpts: "75%,65%",
          fzf: {
            extraArgs: ["--cycle"],
          },
        },
      })
      const selectPreset = vi.fn(async () => ({
        status: "selected" as const,
        presetName: "dev",
      }))
      const cliWithSelect = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
        selectPreset,
      })

      runExitCode = await cliWithSelect.run(["--select", "--dry-run"])

      expect(runExitCode).toBe(0)
      expect(selectPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          uiMode: "fzf",
          surfaceMode: "inline",
          tmuxPopupOptions: "75%,65%",
          fzfExtraArgs: ["--cycle"],
        }),
      )
    })

    it("returns 130 when selection is cancelled", async () => {
      const selectPreset = vi.fn(async () => ({
        status: "cancelled" as const,
      }))
      const cliWithSelect = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
        selectPreset,
      })

      runExitCode = await cliWithSelect.run(["--select"])

      expect(runExitCode).toBe(130)
      expect(compilePresetFromValueMock).not.toHaveBeenCalled()
    })

    it("rejects preset argument with --select", async () => {
      runExitCode = await cli.run(["dev", "--select"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("Cannot use preset argument with --select")
    })

    it("rejects extra positional arguments for preset execution", async () => {
      runExitCode = await cli.run(["dev", "extra", "--dry-run"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("too many arguments")
      expect(compilePresetFromValueMock).not.toHaveBeenCalled()
    })

    it("rejects --select-ui without --select", async () => {
      runExitCode = await cli.run(["--select-ui", "fzf", "--dry-run"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("--select-ui requires --select")
    })

    it("rejects --select-surface without --select", async () => {
      runExitCode = await cli.run(["--select-surface", "inline", "--dry-run"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("--select-surface requires --select")
    })

    it("rejects --select-tmux-popup-opts without --select", async () => {
      runExitCode = await cli.run(["--select-tmux-popup-opts", "80%,70%", "--dry-run"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("--select-tmux-popup-opts requires --select")
    })

    it("rejects --fzf-arg without --select", async () => {
      runExitCode = await cli.run(["--fzf-arg", "--cycle", "--dry-run"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("--fzf-arg requires --select")
    })

    it("rejects invalid backend values before execution", async () => {
      runExitCode = await cli.run(["dev", "--backend", "screen", "--dry-run"])

      expect(runExitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("Invalid value for argument")
      expect(errorOutput.join("\n")).toContain("--backend")
      expect(compilePresetFromValueMock).not.toHaveBeenCalled()
    })

    it("applies --config before list command loads presets", async () => {
      const customPresetManager = createMockPresetManager()
      const cliWithConfig = createCli({
        presetManager: customPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => createRecordingExecutor(dryRun),
        core: coreBridge,
      })

      await cliWithConfig.run(["--config", "/tmp/list-config.yml", "list"])

      expect(customPresetManager.getConfigPathAtLastLoad()).toBe("/tmp/list-config.yml")
    })
  })

  describe("error handling", () => {
    it("should handle unexpected errors gracefully", async () => {
      runExitCode = await cli.run(["unknown-preset"])

      const output = errorOutput.join("\n")
      expect(output).toContain("Error:")
      expect(runExitCode).toBe(1)
    })

    it("should report structured errors when plan execution fails", async () => {
      const failingExecutorFactory = vi.fn(() => {
        let paneIds = ["%0"]
        return {
          async execute(command: string | string[]): Promise<string> {
            const args =
              typeof command === "string"
                ? command
                    .split(" ")
                    .filter((segment) => segment.length > 0)
                    .slice(1)
                : command
            const [cmd] = args
            if (cmd === "new-window") {
              paneIds = ["%0"]
              return "%0"
            }
            if (cmd === "display-message" && args.includes("#{pane_id}")) {
              return paneIds[0] ?? "%0"
            }
            if (cmd === "list-panes" && args.includes("#{pane_id}")) {
              return paneIds.join("\n")
            }
            if (cmd === "split-window") {
              const error = new Error("tmux failed") as Error & { code?: string; details?: Record<string, unknown> }
              error.code = "TMUX_COMMAND_FAILED"
              error.details = { stderr: "boom" }
              throw error
            }
            return ""
          },
          async executeMany(commandsList: string[][]): Promise<void> {
            for (const commandArgs of commandsList) {
              await this.execute(commandArgs)
            }
          },
          isDryRun: () => false,
          logCommand: () => {},
        }
      })

      const failingCli = createCli({
        presetManager: mockPresetManager,
        createCommandExecutor: failingExecutorFactory as unknown as (options: {
          verbose: boolean
          dryRun: boolean
        }) => CommandExecutor,
        core: coreBridge,
      })

      runExitCode = await failingCli.run(["dev"])

      const errorLog = errorOutput.join("\n")
      expect(errorLog).toContain("[execution] [TMUX_COMMAND_FAILED]")
      expect(errorLog).toContain("[root:split:1]")
      expect(errorLog).toContain("tmux failed")
      expect(errorLog).toContain("stderr: boom")
      expect(runExitCode).toBe(1)
    })
  })
})
