import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { createCli, type CLI, type FunctionalCoreBridge } from "../cli.ts"
import { MockPresetManager } from "./mocks/preset-manager-mock.ts"
import type { ICommandExecutor } from "../interfaces/command-executor.ts"
import type {
  CompilePresetInput,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
  PlanEmission,
  FunctionalPreset,
  PlanNode,
  LayoutPlan,
} from "../core/index.ts"

class RecordingExecutor implements ICommandExecutor {
  readonly commands: string[][] = []
  private paneIds: string[] = ["%0"]
  private paneCounter = 0

  constructor(private readonly dryRun: boolean) {}

  async execute(command: string | string[]): Promise<string> {
    const args =
      typeof command === "string"
        ? command
            .split(" ")
            .filter((segment) => segment.length > 0)
            .slice(1)
        : command
    this.commands.push([...args])

    const [cmd] = args
    if (cmd === "display-message" && args.includes("#{pane_id}")) {
      return this.paneIds[0] ?? "%0"
    }

    if (cmd === "list-panes" && args.includes("#{pane_id}")) {
      return this.paneIds.join("\n")
    }

    if (cmd === "split-window") {
      this.paneCounter += 1
      const newId = `%${this.paneCounter}`
      this.paneIds = [...this.paneIds, newId]
    }

    return ""
  }

  async executeMany(commandsList: string[][]): Promise<void> {
    for (const command of commandsList) {
      await this.execute(command)
    }
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
  }

  let compilePresetMock: ReturnType<typeof vi.fn>
  let createLayoutPlanMock: ReturnType<typeof vi.fn>
  let emitPlanMock: ReturnType<typeof vi.fn>
  let functionalCore: FunctionalCoreBridge

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

    functionalCore = {
      compilePreset: compilePresetMock as unknown as FunctionalCoreBridge["compilePreset"],
      createLayoutPlan: createLayoutPlanMock as unknown as FunctionalCoreBridge["createLayoutPlan"],
      emitPlan: emitPlanMock as unknown as FunctionalCoreBridge["emitPlan"],
    }

    cli = createCli({
      presetManager: mockPresetManager,
      createCommandExecutor,
      functionalCore,
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
      const expectedCommandCount =
        1 + sampleEmission.steps.length + sampleEmission.steps.filter((step) => step.kind === "split").length * 2
      expect(recordingExecutor.commands).toHaveLength(expectedCommandCount)
      expect(consoleOutput.join("\n")).toContain('Applied preset "Development"')
      expect(exitCode).toBe(0)
    })

    it("should execute default preset when no name provided", async () => {
      await cli.run([])

      expectFunctionalPipelineCalled()
      const expectedCommandCount =
        1 + sampleEmission.steps.length + sampleEmission.steps.filter((step) => step.kind === "split").length * 2
      expect(recordingExecutor.commands).toHaveLength(expectedCommandCount)
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
      const expectedCommandCount =
        1 + sampleEmission.steps.length + sampleEmission.steps.filter((step) => step.kind === "split").length * 2
      expect(recordingExecutor.commands).toHaveLength(expectedCommandCount)
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
      const cliWithConfig = createCli({
        presetManager: customPresetManager,
        createCommandExecutor: ({ dryRun }: { verbose: boolean; dryRun: boolean }) => new RecordingExecutor(dryRun),
        functionalCore,
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
        }) => ICommandExecutor,
        functionalCore,
      })

      await expect(failingCli.run(["dev"])).rejects.toThrow("Process exited")

      const errorLog = errorOutput.join("\n")
      expect(errorLog).toContain("TMUX_COMMAND_FAILED")
      expect(errorLog).toContain("root:split:1")
      expect(errorLog).toContain("split-window -h -t root.0")
      expect(exitCode).toBe(1)
    })
  })
})
