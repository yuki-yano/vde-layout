import type { CommandStep } from "../core/emitter"
import { createCoreError } from "../core/errors"
import { ErrorCodes } from "../utils/errors"

const getStepLabel = (step: CommandStep): string => {
  if (step.kind === "split") {
    return "Split"
  }
  if (step.kind === "focus") {
    return "Focus"
  }
  return "Step"
}

export const resolveRequiredStepTargetPaneId = (step: CommandStep): string => {
  if (typeof step.targetPaneId === "string" && step.targetPaneId.length > 0) {
    return step.targetPaneId
  }

  throw createCoreError("execution", {
    code: ErrorCodes.MISSING_TARGET,
    message: `${getStepLabel(step)} step missing target pane metadata`,
    path: step.id,
  })
}
