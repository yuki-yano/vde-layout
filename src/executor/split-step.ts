import type { CommandStep } from "../core/emitter"

export type SplitOrientation = "horizontal" | "vertical"

export const resolveSplitOrientation = (step: CommandStep): SplitOrientation => {
  if (step.kind === "split" && (step.orientation === "horizontal" || step.orientation === "vertical")) {
    return step.orientation
  }
  return "vertical"
}

export const resolveSplitPercentage = (step: CommandStep): string => {
  if (step.kind === "split" && typeof step.percentage === "number" && Number.isFinite(step.percentage)) {
    return String(clampSplitPercentage(step.percentage))
  }
  return "50"
}

export const clampSplitPercentage = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}
