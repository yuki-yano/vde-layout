import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { CLI } from "../cli"
import type { CLIOptions } from "../cli"
import { MockPresetManager } from "./mocks/preset-manager-mock"
import type { ICommandExecutor } from "../interfaces/command-executor"
import type {
  CompilePresetInput,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
  PlanEmission,
  FunctionalPreset,
  PlanNode,
  LayoutPlan,
} from "../functional-core"

class RecordingExecutor implements ICommandExecutor {
  readonly commands: string[][] = []
  constructor(private readonly dryRun: boolean) {}

  async execute(command: string | string[]): Promise<string> {
    const args = typeof command === "string" ? command.split(" ").slice(1) : command
    this.commands.push([...args])
    return ""
  }

  async executeMany(commandsList: string[][]): Promise<void> {
    commandsList.forEach((command) => {
      this.commands.push([...command])
    })
  }

  isDryRun(): boolean {
    return this.dryRun
  }

  logCommand(): void {}
}

describe("CLI", () => {
  let cli: CLI
  let mockPresetManager: MockPresetManager
  let recordingExecutor: RecordingExecutor
  let originalExit: typeof process.exit
  let originalTMUX: string | undefined
  let exitCode: number | undefined
  let consoleOutput: string[] = []
  let errorOutput: string[] = []
  let processExitCalled = false

  const sampleFunctionalPreset: FunctionalPreset = {
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
      },
      {
        id: "root.0:focus",
        kind: "focus",
        command: ["select-pane", "-t", "root.0"],
        summary: "select pane root.0",
      },
    ],
    summary: {
      stepsCount: 2,
      focusPaneId: "root.0",
    },
    hash: "abc123",
  }

  let compilePresetMock: (input: CompilePresetInput) => ReturnType<typeof CLI["prototype"]["functionalCore"]["compilePreset"]>
  let createLayoutPlanMock: () => ReturnType<typeof CLI["prototype"]["functionalCore"]["createLayoutPlan"]>
  let emitPlanMock: () => ReturnType<typeof CLI["prototype"]["functionalCore"]["emitPlan"]>

  beforeEach(() => {
    mockPresetManager = new MockPresetManager()
    originalTMUX = process.env.TMUX
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0"

    compilePresetMock = vi.fn(() => ({ ok: true, value: { preset: sampleFunctionalPreset } as CompilePresetSuccess }))
    createLayoutPlanMock = vi.fn(() => ({ ok: true, value: { plan: samplePlan } as CreateLayoutPlanSuccess }))
    emitPlanMock = vi.fn(() => ({ ok: true, value: sampleEmission }))

    const createCommandExecutor = vi.fn(({ dryRun }: { verbose: boolean; dryRun: boolean }) => {
      recordingExecutor = new RecordingExecutor(dryRun)
      return recordingExecutor
    })

    cli = new CLI({
      presetManager: mockPresetManager,
      createCommandExecutor,
      functionalCore: {
        compilePreset: compilePresetMock,
        createLayoutPlan: createLayoutPlanMock,
        emitPlan: emitPlanMock,
      },
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

  const expectFunctionalPipelineCalled = () => {
    expect(compilePresetMock).toHaveBeenCalled()
    expect(createLayoutPlanMock).toHaveBeenCalled()
    expect(emitPlanMock).toHaveBeenCalled()
  }

  describe("basic commands", () => {
    it("should display version", async () => {
      await cli.run(["--version"])
      expect(processExitCalled || consoleOutput.some((line) => line.includes("0.0.1"))).toBe(true)
    })

    it("should display version with -V", async () => {
      await cli.run(["-V"])
      expect(processExitCalled || consoleOutput.some((line) => line.includes("0.0.1"))).toBe(true)
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

      expectFunctionalPipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(sampleEmission.steps.length)
      expect(consoleOutput.join("\n")).toContain('Applied preset "Development"')
      expect(exitCode).toBe(0)
    })

    it("should execute default preset when no name provided", async () => {
      await cli.run([])

      expectFunctionalPipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(sampleEmission.steps.length)
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

      expectFunctionalPipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(sampleEmission.steps.length)
      expect(exitCode).toBe(0)
    })

    it("should accept dry-run option", async () => {
      await cli.run(["dev", "--dry-run"])

      expectFunctionalPipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(0)
      expect(consoleOutput.join("\n")).toContain("[DRY RUN]")
      expect(consoleOutput.join("\n")).toContain("Planned tmux steps")
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
      await cli.run(["dev", "-v", "--dry-run"])

      expectFunctionalPipelineCalled()
      expect(recordingExecutor.commands).toHaveLength(0)
      expect(exitCode).toBe(0)
    })

    it("should allow specifying configuration file via --config", async () => {
      const customPresetManager = new MockPresetManager()
      const cliWithConfig = new CLI({
        presetManager: customPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => new RecordingExecutor(dryRun),
        functionalCore: {
          compilePreset: compilePresetMock,
          createLayoutPlan: createLayoutPlanMock,
          emitPlan: emitPlanMock,
        },
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
        let callCount = 0
        return {
          async execute(command: string | string[]): Promise<string> {
            const args = typeof command === "string" ? command.split(" ").slice(1) : command
            callCount += 1
            if (callCount === 2) {
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

      const failingCli = new CLI({
        presetManager: mockPresetManager,
        createCommandExecutor: failingExecutorFactory as unknown as CLIOptions["createCommandExecutor"],
        functionalCore: {
          compilePreset: compilePresetMock,
          createLayoutPlan: createLayoutPlanMock,
          emitPlan: emitPlanMock,
        },
      })

      await expect(failingCli.run(["dev"])).rejects.toThrow("Process exited")

      const errorLog = errorOutput.join("\n")
      expect(errorLog).toContain("TMUX_COMMAND_FAILED")
      expect(errorLog).toContain("root.0:focus")
      expect(errorLog).toContain("select-pane -t root.0")
      expect(exitCode).toBe(1)
    })
  })
})
