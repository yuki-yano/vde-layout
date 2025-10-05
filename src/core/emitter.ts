import { createHash } from "crypto"
import type { LayoutPlan, PlanNode } from "./planner.ts"

type EmitPlanInput = {
  readonly plan: LayoutPlan
}

type CommandStepKind = "split" | "focus"

export type CommandStep = {
  readonly id: string
  readonly kind: CommandStepKind
  readonly command: ReadonlyArray<string>
  readonly summary: string
  readonly targetPaneId?: string
  readonly createdPaneId?: string
}

export type EmittedTerminal = {
  readonly virtualPaneId: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly focus: boolean
  readonly name: string
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
    command: ["select-pane", "-t", plan.focusPaneId],
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

  for (let index = 1; index < node.panes.length; index += 1) {
    const previousRatioSum = node.ratio.slice(0, index).reduce((sum, value) => sum + value, 0)
    const percentage = Math.max(1, Math.round((1 - previousRatioSum) * 100))
    const targetPaneId = node.panes[index - 1]?.id ?? node.id
    const createdPaneId = node.panes[index]?.id

    steps.push({
      id: `${node.id}:split:${index}`,
      kind: "split",
      command: ["split-window", directionFlag, "-t", targetPaneId, "-p", String(Math.min(percentage, 99))],
      summary: `split ${targetPaneId} (${directionFlag})`,
      targetPaneId,
      createdPaneId,
    })
  }
}

const collectTerminals = (node: PlanNode): EmittedTerminal[] => {
  if (node.kind === "terminal") {
    return [
      {
        virtualPaneId: node.id,
        command: node.command,
        cwd: node.cwd,
        env: node.env,
        focus: node.focus,
        name: node.name,
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
