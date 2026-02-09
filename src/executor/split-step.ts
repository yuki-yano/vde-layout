import type { CommandStep } from "../core/emitter"
import { createCoreError } from "../core/errors"
import { ErrorCodes } from "../utils/errors"

type SplitOrientation = "horizontal" | "vertical"
type SplitCommandStep = CommandStep & { readonly kind: "split" }

const asSplitStep = (step: CommandStep, field: "orientation" | "percentage"): SplitCommandStep => {
  if (step.kind !== "split") {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: `Non-split step cannot resolve split ${field}`,
      path: step.id,
      details: { kind: step.kind },
    })
  }
  return step as SplitCommandStep
}

export const resolveSplitOrientation = (step: CommandStep): SplitOrientation => {
  const splitStep = asSplitStep(step, "orientation")

  if (splitStep.orientation === "horizontal" || splitStep.orientation === "vertical") {
    return splitStep.orientation
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: "Split step missing orientation metadata",
    path: splitStep.id,
    details: { orientation: splitStep.orientation },
  })
}

export const resolveSplitPercentage = (step: CommandStep): string => {
  const splitStep = asSplitStep(step, "percentage")

  if (typeof splitStep.percentage === "number" && Number.isFinite(splitStep.percentage)) {
    return String(clampSplitPercentage(splitStep.percentage))
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: "Split step missing percentage metadata",
    path: splitStep.id,
    details: { percentage: splitStep.percentage },
  })
}

const clampSplitPercentage = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}
