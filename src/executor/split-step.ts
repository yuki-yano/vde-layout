import type { CommandStep } from "../core/emitter"
import { createCoreError } from "../core/errors"
import { ErrorCodes } from "../utils/errors"

type SplitOrientation = "horizontal" | "vertical"

export const resolveSplitOrientation = (step: CommandStep): SplitOrientation => {
  if (step.kind !== "split") {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Non-split step cannot resolve split orientation",
      path: step.id,
      details: { kind: step.kind },
    })
  }

  if (step.orientation === "horizontal" || step.orientation === "vertical") {
    return step.orientation
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: "Split step missing orientation metadata",
    path: step.id,
    details: { orientation: step.orientation },
  })
}

export const resolveSplitPercentage = (step: CommandStep): string => {
  if (step.kind !== "split") {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Non-split step cannot resolve split percentage",
      path: step.id,
      details: { kind: step.kind },
    })
  }

  if (typeof step.percentage === "number" && Number.isFinite(step.percentage)) {
    return String(clampSplitPercentage(step.percentage))
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: "Split step missing percentage metadata",
    path: step.id,
    details: { percentage: step.percentage },
  })
}

const clampSplitPercentage = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}
