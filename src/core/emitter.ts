import { createHash } from "crypto"
import type { LayoutPlan, PlanNode } from "./planner"
import type { CompiledRatioEntry } from "./compile"

type EmitPlanInput = {
  readonly plan: LayoutPlan
}

type CommandStepKind = "split" | "focus"

export type SplitSizing =
  | { readonly mode: "percent"; readonly percentage: number }
  | {
      readonly mode: "dynamic-cells"
      readonly target: CompiledRatioEntry
      readonly remainingFixedCells: number
      readonly remainingWeight: number
      readonly remainingWeightPaneCount: number
    }

export type CommandStep = {
  readonly id: string
  readonly kind: CommandStepKind
  readonly command?: ReadonlyArray<string>
  readonly summary: string
  readonly targetPaneId?: string
  readonly createdPaneId?: string
  readonly orientation?: "horizontal" | "vertical"
  readonly percentage?: number
  readonly splitSizing?: SplitSizing
}

export type EmittedTerminal = {
  readonly virtualPaneId: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly delay?: number
  readonly title?: string
  readonly focus: boolean
  readonly name: string
  readonly ephemeral?: boolean
  readonly closeOnError?: boolean
}

type PlanEmissionSummary = {
  readonly stepsCount: number
  readonly focusPaneId: string
  readonly initialPaneId: string
}

export type PlanEmission = {
  readonly steps: ReadonlyArray<CommandStep>
  readonly summary: PlanEmissionSummary
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly hash: string
}

type SplitNode = Extract<PlanNode, { kind: "split" }>

export const emitPlan = ({ plan }: EmitPlanInput): PlanEmission => {
  const steps: CommandStep[] = []
  collectSplitSteps(plan.root, steps)

  steps.push({
    id: `${plan.focusPaneId}:focus`,
    kind: "focus",
    summary: `select pane ${plan.focusPaneId}`,
    targetPaneId: plan.focusPaneId,
  })

  const hash = createPlanHash(plan, steps)
  const initialPaneId = determineInitialPaneId(plan.root)
  const terminals = collectTerminals(plan.root)

  return {
    steps,
    summary: {
      stepsCount: steps.length,
      focusPaneId: plan.focusPaneId,
      initialPaneId,
    },
    terminals,
    hash,
  }
}

const collectSplitSteps = (node: PlanNode, steps: CommandStep[]): void => {
  if (node.kind === "terminal") {
    return
  }

  appendSplitSteps(node, steps)
  node.panes.forEach((pane) => collectSplitSteps(pane, steps))
}

const appendSplitSteps = (node: SplitNode, steps: CommandStep[]): void => {
  const directionFlag = node.orientation === "horizontal" ? "-h" : "-v"
  const hasFixedCells = node.ratio.some((entry) => entry.kind === "fixed-cells")

  for (let index = 1; index < node.panes.length; index += 1) {
    const targetPaneId = node.panes[index - 1]?.id ?? node.id
    const createdPaneId = node.panes[index]?.id

    const splitSizing = hasFixedCells
      ? buildDynamicSplitSizing(node.ratio, index)
      : buildPercentSplitSizing(node.ratio, index)

    const percentage = splitSizing.mode === "percent" ? splitSizing.percentage : undefined

    steps.push({
      id: `${node.id}:split:${index}`,
      kind: "split",
      summary: `split ${targetPaneId} (${directionFlag})`,
      targetPaneId,
      createdPaneId,
      orientation: node.orientation,
      percentage,
      splitSizing,
    })
  }
}

const buildPercentSplitSizing = (ratio: ReadonlyArray<CompiledRatioEntry>, index: number): SplitSizing => {
  const remainingIncludingTarget = ratio
    .slice(index - 1)
    .reduce((sum, entry) => sum + (entry.kind === "weight" ? entry.weight : 0), 0)
  const remainingAfterTarget = ratio
    .slice(index)
    .reduce((sum, entry) => sum + (entry.kind === "weight" ? entry.weight : 0), 0)

  const desiredPercentage = remainingIncludingTarget <= 0 ? 0 : (remainingAfterTarget / remainingIncludingTarget) * 100

  return {
    mode: "percent",
    percentage: clampPercent(desiredPercentage),
  }
}

const buildDynamicSplitSizing = (ratio: ReadonlyArray<CompiledRatioEntry>, index: number): SplitSizing => {
  const target = ratio[index - 1]!
  const remaining = ratio.slice(index)

  const remainingFixedCells = remaining.reduce((sum, entry) => {
    return entry.kind === "fixed-cells" ? sum + entry.cells : sum
  }, 0)
  const remainingWeight = remaining.reduce((sum, entry) => {
    return entry.kind === "weight" ? sum + entry.weight : sum
  }, 0)
  const remainingWeightPaneCount = remaining.reduce((count, entry) => {
    return entry.kind === "weight" ? count + 1 : count
  }, 0)

  return {
    mode: "dynamic-cells",
    target,
    remainingFixedCells,
    remainingWeight,
    remainingWeightPaneCount,
  }
}

const clampPercent = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}

const collectTerminals = (node: PlanNode): EmittedTerminal[] => {
  if (node.kind === "terminal") {
    return [
      {
        virtualPaneId: node.id,
        command: node.command,
        cwd: node.cwd,
        env: node.env,
        delay: node.delay,
        title: node.title,
        focus: node.focus,
        name: node.name,
        ephemeral: node.ephemeral,
        closeOnError: node.closeOnError,
      },
    ]
  }

  return node.panes.flatMap((pane) => collectTerminals(pane))
}

const determineInitialPaneId = (node: PlanNode): string => {
  if (node.kind === "terminal") {
    return node.id
  }

  let current: PlanNode = node
  while (current.kind === "split") {
    current = current.panes[0]!
  }
  return current.id
}

const createPlanHash = (plan: LayoutPlan, steps: ReadonlyArray<CommandStep>): string => {
  const digest = createHash("sha256")
  const normalized = {
    focusPaneId: plan.focusPaneId,
    root: plan.root,
    steps,
  }
  digest.update(JSON.stringify(normalized))
  return digest.digest("hex")
}
