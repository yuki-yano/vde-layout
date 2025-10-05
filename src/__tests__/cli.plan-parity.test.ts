import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { createCli, type CLI, type FunctionalCoreBridge } from "../cli.ts"
import type { IPresetManager } from "../interfaces/index.ts"
import type { Preset, PresetInfo } from "../models/types.ts"
import type { ICommandExecutor } from "../interfaces/command-executor.ts"
import {
  compilePreset as defaultCompilePreset,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
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

  async verifyTmuxEnvironment(): Promise<void> {
    if (!this.isInTmuxSession()) {
      throw new Error("Not running inside a tmux session")
    }
  }

  isInTmuxSession(): boolean {
    return Boolean(process.env.TMUX)
  }

  getCommandString(args: string[]): string {
    return ["tmux", ...args].join(" ")
  }

  async getCurrentSessionName(): Promise<string> {
    return "plan-comparison"
  }
}

class FixturePresetManager implements IPresetManager {
  private readonly preset: Preset = {
    name: "Fixture Development Layout",
    layout: {
      type: "horizontal",
      ratio: [1, 1],
      panes: [
        { name: "main", command: "nvim", focus: true },
        { name: "logs", command: "htop" },
      ],
    },
  }

  async loadConfig(): Promise<void> {}

  setConfigPath(): void {}

  getPreset(name: string): Preset {
    if (name === "fixture") {
      return this.preset
    }
    throw new Error(`Preset "${name}" not found`)
  }

  getDefaultPreset(): Preset {
    return this.preset
  }

  listPresets(): PresetInfo[] {
    return [
      {
        key: "fixture",
        name: this.preset.name ?? "Fixture Development Layout",
        description: "Fixture preset for plan parity tests",
      },
    ]
  }
}

describe("CLI plan parity", () => {
  let cli: CLI
  let executor: RecordingExecutor | undefined
  let emissionHashes: string[]
  let originalExit: typeof process.exit
  let exitCode: number | undefined
  let processExitCalled: boolean

  beforeEach(() => {
    process.env.TMUX = "tmux-test-session"
    process.env.VDE_TEST_MODE = "true"

    emissionHashes = []
    exitCode = undefined
    processExitCalled = false

    originalExit = process.exit
    process.exit = ((code?: number) => {
      exitCode = code
      processExitCalled = true
      return undefined as never
    }) as never

    const presetManager = new FixturePresetManager()

    const functionalCore: FunctionalCoreBridge = {
      compilePreset: defaultCompilePreset,
      createLayoutPlan: defaultCreateLayoutPlan,
      emitPlan: (input) => {
        const result = defaultEmitPlan(input)
        if (result.ok) {
          emissionHashes.push(result.value.hash)
        }
        return result
      },
    }

    cli = createCli({
      presetManager,
      createCommandExecutor: ({ dryRun }) => {
        executor = new RecordingExecutor(dryRun)
        return executor
      },
      functionalCore,
    })
  })

  afterEach(() => {
    process.exit = originalExit
    delete process.env.TMUX
    delete process.env.VDE_TEST_MODE
  })

  it("generates identical plan hashes for dry-run and execution", async () => {
    await cli.run(["fixture", "--dry-run"])

    expect(processExitCalled).toBe(true)
    expect(exitCode).toBe(0)
    expect(emissionHashes).toHaveLength(1)
    const dryRunHash = emissionHashes[0]

    processExitCalled = false
    exitCode = undefined
    emissionHashes = []

    await cli.run(["fixture"])

    expect(processExitCalled).toBe(true)
    expect(exitCode).toBe(0)
    expect(emissionHashes).toHaveLength(1)
    const executeHash = emissionHashes[0]

    expect(executor?.isDryRun()).toBe(false)
    expect(executor?.commands.length ?? 0).toBeGreaterThan(0)
    expect(executeHash).toBe(dryRunHash)
  })
})
