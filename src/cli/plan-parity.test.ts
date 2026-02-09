import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { createCli, type CLI, type CoreBridge } from "./index"
import type { Preset, PresetInfo } from "../models/types"
import type { CommandExecutor } from "../contracts/command-executor"
import type { PresetManager } from "../contracts/preset-manager"
import {
  compilePreset as defaultCompilePreset,
  compilePresetFromValue as defaultCompilePresetFromValue,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "../core/index"

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
  let runExitCode: number

  beforeEach(() => {
    process.env.TMUX = "tmux-test-session"
    process.env.VDE_TEST_MODE = "true"

    emissionHashes = []
    runExitCode = 0

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
    delete process.env.TMUX
    delete process.env.VDE_TEST_MODE
  })

  it("generates identical plan hashes for dry-run and execution", async () => {
    runExitCode = await cli.run(["fixture", "--dry-run"])

    expect(runExitCode).toBe(0)
    expect(emissionHashes).toHaveLength(1)
    const dryRunHash = emissionHashes[0]

    runExitCode = 0
    emissionHashes = []

    runExitCode = await cli.run(["fixture"])

    expect(runExitCode).toBe(0)
    expect(emissionHashes).toHaveLength(1)
    const executeHash = emissionHashes[0]

    expect(executor?.isDryRun()).toBe(false)
    expect(executor?.commands.length ?? 0).toBeGreaterThan(0)
    expect(executeHash).toBe(dryRunHash)
  })
})
