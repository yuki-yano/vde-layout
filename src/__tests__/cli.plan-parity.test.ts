import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { stringify as toYAML } from "yaml"
import { CLI } from "../cli"
import type { IPresetManager } from "../interfaces"
import type { Preset, PresetInfo } from "../models/types"
import type { ICommandExecutor } from "../interfaces/command-executor"
import {
  compilePreset as defaultCompilePreset,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
  compileFunctionalCorePipeline,
} from "../functional-core"
import type { LayoutPlan, PlanNode } from "../functional-core"
import { LayoutEngine } from "../layout/engine"

class RecordingExecutor implements ICommandExecutor {
  readonly commands: string[][] = []
  constructor(private readonly dryRun: boolean) {}

  async execute(command: string | string[]): Promise<string> {
    const args = typeof command === "string" ? command.split(" ").slice(1) : command
    this.commands.push([...args])
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

    cli = new CLI({
      presetManager,
      createCommandExecutor: ({ dryRun }) => {
        executor = new RecordingExecutor(dryRun)
        return executor
      },
      functionalCore: {
        compilePreset: defaultCompilePreset,
        createLayoutPlan: defaultCreateLayoutPlan,
        emitPlan: (input) => {
          const result = defaultEmitPlan(input)
          if (result.ok) {
            emissionHashes.push(result.value.hash)
          }
          return result
        },
      },
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

interface SplitExpectation {
  readonly target: string
  readonly newPane: string
  readonly orientation: "horizontal" | "vertical"
  readonly percentage: number
}

class PlanComparisonExecutor implements ICommandExecutor {
  private readonly splitQueue: SplitExpectation[]
  private readonly focusPaneId: string
  private readonly recorded: string[][] = []
  private readonly paneIds: string[]
  private activePaneId: string
  private focusRecorded = false

  constructor({
    splits,
    focusPaneId,
    initialPaneId,
  }: {
    splits: SplitExpectation[]
    focusPaneId: string
    initialPaneId: string
  }) {
    this.splitQueue = [...splits]
    this.focusPaneId = focusPaneId
    this.paneIds = [initialPaneId]
    this.activePaneId = initialPaneId
  }

  getRecordedCommands(): string[][] {
    return this.recorded
  }

  async execute(commandOrArgs: string | string[]): Promise<string> {
    const args = this.parse(commandOrArgs)
    const [command, ...rest] = args

    switch (command) {
      case "new-window":
        return ""
      case "display-message":
        if (rest.includes("#{pane_id}")) {
          return this.activePaneId
        }
        return ""
      case "list-panes":
        return this.paneIds.join("\n")
      case "split-window":
        this.handleSplit(rest)
        return ""
      case "select-pane":
        this.handleSelect(rest)
        return ""
      default:
        return ""
    }
  }

  async executeMany(commandsList: string[][]): Promise<void> {
    for (const command of commandsList) {
      await this.execute(command)
    }
  }

  isDryRun(): boolean {
    return false
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

  private parse(commandOrArgs: string | string[]): string[] {
    return typeof commandOrArgs === "string"
      ? commandOrArgs
          .split(" ")
          .filter((segment) => segment.length > 0)
          .slice(1)
      : commandOrArgs
  }

  private handleSplit(args: string[]): void {
    const expectation = this.splitQueue.shift()
    if (!expectation) {
      throw new Error("Unexpected split-window command")
    }

    const orientationFlag = args.includes("-h") ? "horizontal" : "vertical"
    if (orientationFlag !== expectation.orientation) {
      throw new Error(`Split orientation mismatch: expected ${expectation.orientation}, received ${orientationFlag}`)
    }

    const targetIndex = args.indexOf("-t")
    const targetPane = targetIndex >= 0 ? args[targetIndex + 1] : undefined
    if (targetPane !== expectation.target) {
      throw new Error(`Split target mismatch: expected ${expectation.target}, received ${targetPane}`)
    }

    const percentageIndex = args.indexOf("-p")
    const percentageValue = percentageIndex >= 0 ? args[percentageIndex + 1] : undefined
    if (percentageValue !== String(expectation.percentage)) {
      throw new Error(
        `Split percentage mismatch: expected ${expectation.percentage}, received ${percentageValue ?? "<missing>"}`,
      )
    }

    this.recorded.push(["split-window", ...args])
    this.paneIds.push(expectation.newPane)
    this.activePaneId = expectation.newPane
  }

  private handleSelect(args: string[]): void {
    const targetIndex = args.indexOf("-t")
    const targetPane = targetIndex >= 0 ? args[targetIndex + 1] : undefined
    if (targetPane !== undefined) {
      this.activePaneId = targetPane
      if (!this.focusRecorded && targetPane === this.focusPaneId && !args.includes("-T")) {
        this.recorded.push(["select-pane", ...args])
        this.focusRecorded = true
      }
    }
  }
}

describe("Legacy LayoutEngine parity", () => {
  const preset: Preset = {
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

  const document = toYAML({
    name: preset.name,
    layout: preset.layout,
  })

  const pipeline = compileFunctionalCorePipeline({ document, source: "preset://fixture" })
  if (!pipeline.ok) {
    throw pipeline.error
  }

  const { plan, emission } = pipeline.value

  const splitExpectations = collectSplitExpectations(plan)
  const initialPaneId = determineInitialPaneId(plan)

  it("matches Functional Core emission for split/focus commands", async () => {
    const executor = new PlanComparisonExecutor({
      splits: splitExpectations,
      focusPaneId: plan.focusPaneId,
      initialPaneId,
    })

    const layoutEngine = new LayoutEngine({
      executor,
    }) as unknown as LayoutEngine

    process.env.TMUX = "tmux-test-session"

    await layoutEngine.createLayout(preset)

    const expectedCommands = emission.steps.map((step) => step.command)
    expect(executor.getRecordedCommands()).toEqual(expectedCommands)
  })
})

function collectSplitExpectations(plan: LayoutPlan): SplitExpectation[] {
  const expectations: SplitExpectation[] = []

  const visit = (node: PlanNode): void => {
    if (node.kind === "split") {
      for (let index = 1; index < node.panes.length; index += 1) {
        const previousRatioSum = node.ratio.slice(0, index).reduce((sum, value) => sum + value, 0)
        const percentage = Math.round((1 - previousRatioSum) * 100)
        expectations.push({
          target: node.panes[index - 1]!.id,
          newPane: node.panes[index]!.id,
          orientation: node.orientation,
          percentage,
        })
      }
      node.panes.forEach((pane) => visit(pane))
    }
  }

  visit(plan.root)
  return expectations
}

function determineInitialPaneId(plan: LayoutPlan): string {
  if (plan.root.kind === "terminal") {
    return plan.root.id
  }

  let current: PlanNode = plan.root
  while (current.kind === "split") {
    current = current.panes[0]!
  }
  return current.id
}
