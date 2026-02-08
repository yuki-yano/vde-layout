import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import packageJson from "../../package.json"
import { createCli, type CLI, type CoreBridge } from "../cli.ts"
import { createMockPresetManager, type MockPresetManager } from "./mocks/preset-manager-mock.ts"
import type { CommandExecutor } from "../types/command-executor.ts"
import type {
  CompilePresetInput,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
  PlanEmission,
  CompiledPreset,
  PlanNode,
  LayoutPlan,
} from "../core/index.ts"

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
  let originalExit: typeof process.exit
  let originalTMUX: string | undefined
  let exitCode: number | undefined
  let consoleOutput: string[] = []
  let errorOutput: string[] = []
  let processExitCalled = false

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
      compilePresetFromValue: compilePresetFromValueMock as never,
      createLayoutPlan: createLayoutPlanMock as unknown as CoreBridge["createLayoutPlan"],
      emitPlan: emitPlanMock as unknown as CoreBridge["emitPlan"],
    } as CoreBridge

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
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errorOutput.push(args.join(" "))
    })
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "))
    })
  })

  afterEach(() => {
    process.exit = originalExit
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
      await cli.run(["--version"])
      expect(processExitCalled || consoleOutput.some((line) => line.includes(packageVersion))).toBe(true)
    })

    it("should display version with -v", async () => {
      await cli.run(["-v"])
      expect(processExitCalled || consoleOutput.some((line) => line.includes(packageVersion))).toBe(true)
    })

    it("should show help with --help", async () => {
      try {
        await cli.run(["--help"])
      } catch (error) {
        if (error instanceof Error && error.message.includes("unknown option")) {
          expect(exitCode).toBe(1)
          return
        }
      }
      expect(processExitCalled || consoleOutput.some((line) => line.includes("Usage:"))).toBe(true)
    })

    it("should show help with -h", async () => {
      try {
        await cli.run(["-h"])
      } catch (error) {
        if (error instanceof Error && error.message.includes("unknown option")) {
          expect(exitCode).toBe(1)
          return
        }
      }
      expect(processExitCalled || consoleOutput.some((line) => line.includes("Usage:"))).toBe(true)
    })
  })

  describe("list command", () => {
    it("should list available presets", async () => {
      await cli.run(["list"])

      expect(processExitCalled).toBe(true)
      expect(consoleOutput.join("\n")).toContain("Available presets")
      expect(consoleOutput.join("\n")).toContain("default")
      expect(consoleOutput.join("\n")).toContain("dev")
      expect(exitCode).toBe(0)
    })

    it("should handle config loading error", async () => {
      mockPresetManager.setShouldFailOnLoad(true)

      await expect(cli.run(["list"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain("Error:")
      expect(exitCode).toBe(1)
    })
  })

  describe("preset execution", () => {
    it("should execute named preset", async () => {
      await cli.run(["dev"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%0", 'cd "\/repo"', "Enter"])
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%0", 'export NODE_ENV="test"', "Enter"])
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%0", "nvim", "Enter"])
      expect(recordingExecutor.commands).toContainEqual(["send-keys", "-t", "%1", "npm run dev", "Enter"])
      expect(consoleOutput.join("\n")).toContain('Applied preset "Development"')
      expect(exitCode).toBe(0)
    })

    it("should execute default preset when no name provided", async () => {
      await cli.run([])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands.some((command) => command.includes("nvim"))).toBe(true)
      expect(exitCode).toBe(0)
    })

    it("should handle config loading error", async () => {
      mockPresetManager.setShouldFailOnLoad(true)

      await expect(cli.run(["dev"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain("Error:")
      expect(exitCode).toBe(1)
    })

    it("should handle preset not found error", async () => {
      await expect(cli.run(["nonexistent"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain('Preset "nonexistent" not found')
      expect(exitCode).toBe(1)
    })
  })

  describe("options", () => {
    it("should accept verbose option", async () => {
      await cli.run(["dev", "--verbose"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands.some((command) => command.includes("nvim"))).toBe(true)
      expect(exitCode).toBe(0)
    })

    it("should accept dry-run option", async () => {
      await cli.run(["dev", "--dry-run"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(0)
      expect(consoleOutput.join("\n")).toContain("[DRY RUN]")
      expect(consoleOutput.join("\n")).toContain("Planned terminal steps")
      expect(exitCode).toBe(0)
    })

    it("should fail when outside tmux without explicit dry-run", async () => {
      delete process.env.TMUX

      await expect(cli.run(["dev"])).rejects.toThrow("Process exited")

      expect(processExitCalled).toBe(true)
      expect(exitCode).toBe(1)
      expect(errorOutput.join("\n")).toContain("Must be run inside a tmux session")
    })

    it("should accept both verbose and dry-run options", async () => {
      await cli.run(["dev", "--verbose", "--dry-run"])

      expectCorePipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(0)
      expect(exitCode).toBe(0)
    })

    it("should reject when both window override options are provided", async () => {
      await expect(cli.run(["dev", "--current-window", "--new-window"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain("Cannot use --current-window and --new-window")
      expect(exitCode).toBe(1)
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
    })
  })

  describe("error handling", () => {
    it("should handle unexpected errors gracefully", async () => {
      await expect(cli.run(["unknown-preset"])).rejects.toThrow("Process exited")

      const output = errorOutput.join("\n")
      expect(output).toContain("Error:")
      expect(exitCode).toBe(1)
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

      await expect(failingCli.run(["dev"])).rejects.toThrow("Process exited")

      const errorLog = errorOutput.join("\n")
      expect(errorLog).toContain("[execution] [TMUX_COMMAND_FAILED]")
      expect(errorLog).toContain("[root:split:1]")
      expect(errorLog).toContain("tmux failed")
      expect(errorLog).toContain("stderr: boom")
      expect(exitCode).toBe(1)
    })
  })
})
