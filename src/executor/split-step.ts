import type { CommandStep, SplitSizing } from "../core/emitter"
import { createCoreError } from "../core/errors"
import { ErrorCodes } from "../utils/errors"

type SplitOrientation = "horizontal" | "vertical"
type SplitCommandStep = CommandStep & { readonly kind: "split" }

export type SplitSizeResolutionContext = {
  readonly paneCells?: number
  readonly paneId?: string
  readonly requiredVersion?: string
  readonly detectedVersion?: string
  readonly rawPaneRecord?: Readonly<Record<string, unknown>>
}

export type ResolvedSplitSize =
  | {
      readonly mode: "percent"
      readonly percentage: string
    }
  | {
      readonly mode: "cells"
      readonly cells: string
      readonly targetCells: number
      readonly createdCells: number
    }

const asSplitStep = (step: CommandStep, field: "orientation" | "percentage" | "sizing"): SplitCommandStep => {
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

const resolveLegacySplitSizing = (step: SplitCommandStep): SplitSizing | undefined => {
  if (typeof step.percentage === "number" && Number.isFinite(step.percentage)) {
    return {
      mode: "percent",
      percentage: step.percentage,
    }
  }
  return undefined
}

const resolveSplitSizingMetadata = (step: SplitCommandStep): SplitSizing | undefined => {
  if (step.splitSizing !== undefined) {
    return step.splitSizing
  }
  return resolveLegacySplitSizing(step)
}

export const resolveSplitSize = (step: CommandStep, context: SplitSizeResolutionContext = {}): ResolvedSplitSize => {
  const splitStep = asSplitStep(step, "sizing")
  const splitSizing = resolveSplitSizingMetadata(splitStep)

  if (splitSizing === undefined) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Split step missing sizing metadata",
      path: splitStep.id,
      details: {
        splitSizing: splitStep.splitSizing,
        percentage: splitStep.percentage,
      },
    })
  }

  if (splitSizing.mode === "percent") {
    if (Number.isFinite(splitSizing.percentage)) {
      return {
        mode: "percent",
        percentage: String(clampSplitPercentage(splitSizing.percentage)),
      }
    }

    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Split step missing percentage metadata",
      path: splitStep.id,
      details: { percentage: splitSizing.percentage },
    })
  }

  const dynamic = splitSizing
  const resolvedPaneCells = context.paneCells
  if (typeof resolvedPaneCells !== "number" || !Number.isInteger(resolvedPaneCells) || resolvedPaneCells <= 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED,
      message: "Pane size is unavailable for dynamic split sizing",
      path: splitStep.id,
      details: buildDynamicResolutionDetails(splitStep, dynamic, context),
    })
  }

  const { remainingFixedCells, remainingWeight, remainingWeightPaneCount, target } = dynamic
  if (
    !Number.isInteger(remainingFixedCells) ||
    remainingFixedCells < 0 ||
    !Number.isFinite(remainingWeight) ||
    remainingWeight < 0 ||
    !Number.isInteger(remainingWeightPaneCount) ||
    remainingWeightPaneCount < 0
  ) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Split step has invalid dynamic sizing metadata",
      path: splitStep.id,
      details: buildDynamicResolutionDetails(splitStep, dynamic, context),
    })
  }

  const minTargetCells = target.kind === "fixed-cells" ? target.cells : 1
  // Together with minTargetCells, minCreatedCells reserves remainingFixedCells + remainingWeightPaneCount.
  const minCreatedCells = remainingFixedCells + remainingWeightPaneCount

  if (
    !Number.isInteger(minTargetCells) ||
    minTargetCells <= 0 ||
    !Number.isInteger(minCreatedCells) ||
    minCreatedCells < 0
  ) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Split step has invalid minimum-cell constraints",
      path: splitStep.id,
      details: buildDynamicResolutionDetails(splitStep, dynamic, context),
    })
  }

  if (resolvedPaneCells < minTargetCells + minCreatedCells) {
    throw createCoreError("execution", {
      code: ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED,
      message: "Pane is too small for requested fixed and weighted splits",
      path: splitStep.id,
      details: buildDynamicResolutionDetails(splitStep, dynamic, context),
    })
  }

  let targetCells: number
  if (target.kind === "fixed-cells") {
    targetCells = target.cells
  } else {
    if (!Number.isFinite(target.weight) || target.weight <= 0) {
      throw createCoreError("execution", {
        code: ErrorCodes.INVALID_PLAN,
        message: "Split step has invalid weight metadata",
        path: splitStep.id,
        details: buildDynamicResolutionDetails(splitStep, dynamic, context),
      })
    }

    const availableForWeights = resolvedPaneCells - remainingFixedCells
    const weightTotal = target.weight + remainingWeight
    if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
      throw createCoreError("execution", {
        code: ErrorCodes.INVALID_PLAN,
        message: "Split step has invalid dynamic weight totals",
        path: splitStep.id,
        details: buildDynamicResolutionDetails(splitStep, dynamic, context),
      })
    }

    const rawTarget = Math.round((availableForWeights * target.weight) / weightTotal)
    const maxTargetCells = resolvedPaneCells - minCreatedCells
    targetCells = clamp(rawTarget, minTargetCells, maxTargetCells)
  }

  const createdCells = resolvedPaneCells - targetCells

  if (targetCells < minTargetCells || createdCells < minCreatedCells || targetCells <= 0 || createdCells <= 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED,
      message: "Unable to resolve split size without violating pane minimums",
      path: splitStep.id,
      details: buildDynamicResolutionDetails(splitStep, dynamic, context, {
        targetCells,
        createdCells,
      }),
    })
  }

  return {
    mode: "cells",
    cells: String(createdCells),
    targetCells,
    createdCells,
  }
}

export const resolveSplitPercentage = (step: CommandStep): string => {
  const splitStep = asSplitStep(step, "percentage")
  const splitSizing = resolveSplitSizingMetadata(splitStep)
  if (splitSizing?.mode === "dynamic-cells") {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Split step uses dynamic sizing and has no percentage value",
      path: splitStep.id,
      details: { splitSizing: splitStep.splitSizing },
    })
  }

  const resolved = resolveSplitSize(step)
  if (resolved.mode === "percent") {
    return resolved.percentage
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: "Split step uses dynamic sizing and has no percentage value",
    path: splitStep.id,
    details: { splitSizing: splitStep.splitSizing },
  })
}

const clampSplitPercentage = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value))
}

const buildDynamicResolutionDetails = (
  splitStep: SplitCommandStep,
  splitSizing: Extract<SplitSizing, { mode: "dynamic-cells" }>,
  context: SplitSizeResolutionContext,
  extra: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => {
  return {
    stepId: splitStep.id,
    paneId: context.paneId,
    paneCells: context.paneCells,
    targetSpec: splitSizing.target,
    remainingFixedCells: splitSizing.remainingFixedCells,
    remainingWeight: splitSizing.remainingWeight,
    remainingWeightPaneCount: splitSizing.remainingWeightPaneCount,
    requiredVersion: context.requiredVersion,
    detectedVersion: context.detectedVersion,
    rawPaneRecord: context.rawPaneRecord,
    ...extra,
  }
}
