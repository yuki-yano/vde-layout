import type { CommandStep } from "../core/emitter"

export type SplitOrientation = "horizontal" | "vertical"

export const resolveSplitOrientation = (step: CommandStep): SplitOrientation => {
  if (step.kind === "split" && (step.orientation === "horizontal" || step.orientation === "vertical")) {
    return step.orientation
  }

  // Legacy fallback: tmux default split direction is vertical when no flag is specified.
  if (step.command.includes("-h")) {
    return "horizontal"
  }
  if (step.command.includes("-v")) {
    return "vertical"
  }
  return "vertical"
}

export const resolveSplitPercentage = (step: CommandStep): string => {
  if (step.kind === "split" && typeof step.percentage === "number" && Number.isFinite(step.percentage)) {
    return String(clampSplitPercentage(step.percentage))
  }

  const index = step.command.findIndex((segment) => segment === "-p")
  if (index >= 0 && index + 1 < step.command.length) {
    const raw = step.command[index + 1]
    if (typeof raw === "string" && raw.trim().length > 0) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) {
        return String(clampSplitPercentage(parsed))
      }
    }
  }

  return "50"
}

export const clampSplitPercentage = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}
