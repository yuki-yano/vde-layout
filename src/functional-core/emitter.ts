import { createHash } from "crypto"
import type { LayoutPlan, PlanNode } from "./planner"
import type { Result, StructuredError } from "./compile"

export interface EmitPlanInput {
  readonly plan: LayoutPlan
}

export interface CommandStep {
  readonly id: string
  readonly kind: "split" | "focus"
  readonly command: ReadonlyArray<string>
  readonly summary: string
}

export interface PlanEmissionSummary {
  readonly stepsCount: number
  readonly focusPaneId: string
}

export interface PlanEmission {
  readonly steps: ReadonlyArray<CommandStep>
  readonly summary: PlanEmissionSummary
  readonly hash: string
}

export const emitPlan = ({ plan }: EmitPlanInput): Result<PlanEmission, StructuredError> => {
  const steps: CommandStep[] = []

  collectSplitSteps(plan.root, steps)

  steps.push({
    id: `${plan.focusPaneId}:focus`,
    kind: "focus",
    command: ["select-pane", "-t", plan.focusPaneId],
    summary: `select pane ${plan.focusPaneId}`,
  })

  const hash = createPlanHash(plan, steps)

  return success({
    steps,
    summary: {
      stepsCount: steps.length,
      focusPaneId: plan.focusPaneId,
    },
    hash,
  })
}

const collectSplitSteps = (node: PlanNode, steps: CommandStep[]): void => {
  if (node.kind === "terminal") {
    return
  }

  const directionFlag = node.orientation === "horizontal" ? "-h" : "-v"

  for (let index = 1; index < node.panes.length; index += 1) {
    const previousRatioSum = node.ratio.slice(0, index).reduce((sum, value) => sum + value, 0)
    const percentage = Math.round((1 - previousRatioSum) * 100)
    const targetPaneId = node.panes[index - 1]?.id ?? node.id

    steps.push({
      id: `${node.id}:split:${index}`,
      kind: "split",
      command: ["split-window", directionFlag, "-t", targetPaneId, "-p", String(percentage)],
      summary: `split ${targetPaneId} (${directionFlag})`,
    })
  }

  node.panes.forEach((pane) => collectSplitSteps(pane, steps))
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

const success = <T>(value: T): Result<T, StructuredError> => ({
  ok: true,
  value,
})
