import { createCoreError } from "../core/errors"
import type { CoreError } from "../core/errors"
import { ErrorCodes } from "../utils/errors"

type UnsupportedStep = {
  readonly id: string
  readonly kind?: unknown
}

export const createUnsupportedStepKindError = (step: UnsupportedStep): CoreError => {
  return createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: `Unsupported step kind in emission: ${String(step.kind)}`,
    path: step.id,
  })
}
