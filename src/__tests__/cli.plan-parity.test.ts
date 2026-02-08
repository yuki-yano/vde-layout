import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { createCli, type CLI, type CoreBridge } from "../cli.ts"
import type { Preset, PresetInfo } from "../models/types.ts"
import type { CommandExecutor } from "../types/command-executor.ts"
import type { PresetManager } from "../types/preset-manager.ts"
import {
  compilePreset as defaultCompilePreset,
  compilePresetFromValue as defaultCompilePresetFromValue,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "../core/index.ts"

const createRecordingExecutor = (
  dryRun: boolean,
): CommandExecutor & {
  readonly commands: string[][]
  readonly verifyTmuxEnvironment: () => Promise<void>
  readonly isInTmuxSession: () => boolean
  readonly getCommandString: (args: string[]) => string
  readonly getCurrentSessionName: () => Promise<string>
} => {
  const state = {
    commands: [] as string[][],
    paneIds: ["%0"],
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

  const isDryRun = () => dryRun
  const logCommand = () => {}

  const isInTmuxSession = (): boolean => Boolean(process.env.TMUX)

  const verifyTmuxEnvironment = async (): Promise<void> => {
    if (!isInTmuxSession()) {
      throw new Error("Not running inside a tmux session")
    }
  }

  const getCommandString = (args: string[]): string => ["tmux", ...args].join(" ")
  const getCurrentSessionName = async (): Promise<string> => "plan-comparison"

  return {
    commands: state.commands,
    execute,
    executeMany,
    isDryRun,
    logCommand,
    verifyTmuxEnvironment,
    isInTmuxSession,
    getCommandString,
    getCurrentSessionName,
  }
}

const fixturePreset: Preset = {
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

const createFixturePresetManager = (): PresetManager => {
  const loadConfig = async () => {}
  const setConfigPath = () => {}
  const getPreset = (name: string): Preset => {
    if (name === "fixture") {
      return fixturePreset
    }
    throw new Error(`Preset "${name}" not found`)
  }
  const getDefaultPreset = (): Preset => fixturePreset
  const listPresets = (): PresetInfo[] => [
    {
      key: "fixture",
      name: fixturePreset.name ?? "Fixture Development Layout",
      description: "Fixture preset for plan parity tests",
    },
  ]
  const getDefaults = () => undefined

  return {
    loadConfig,
    setConfigPath,
    getPreset,
    getDefaultPreset,
    listPresets,
    getDefaults,
  }
}

describe("CLI plan parity", () => {
  let cli: CLI
  let executor: ReturnType<typeof createRecordingExecutor> | undefined
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

    const presetManager = createFixturePresetManager()

    const coreBridge: CoreBridge = {
      compilePreset: defaultCompilePreset,
      compilePresetFromValue: defaultCompilePresetFromValue,
      createLayoutPlan: defaultCreateLayoutPlan,
      emitPlan: (input) => {
        const emission = defaultEmitPlan(input)
        emissionHashes.push(emission.hash)
        return emission
      },
    }

    cli = createCli({
      presetManager,
      createCommandExecutor: ({ dryRun }) => {
        executor = createRecordingExecutor(dryRun)
        return executor
      },
      core: coreBridge,
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
