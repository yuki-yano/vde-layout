import type { CompilePresetInput, FunctionalPreset, Result, StructuredError } from "./compile.ts"
import { compilePreset } from "./compile.ts"
import type { LayoutPlan } from "./planner.ts"
import { createLayoutPlan } from "./planner.ts"
import type { PlanEmission } from "./emitter.ts"
import { emitPlan } from "./emitter.ts"

export interface CompileFunctionalCorePipelineSuccess {
  readonly preset: FunctionalPreset
  readonly plan: LayoutPlan
  readonly emission: PlanEmission
}

export interface FunctionalCorePipelineDependencies {
  readonly compilePreset: typeof compilePreset
  readonly createLayoutPlan: typeof createLayoutPlan
  readonly emitPlan: typeof emitPlan
}

export type CompileFunctionalCorePipelineInput = CompilePresetInput

export const compileFunctionalCorePipeline = (
  input: CompileFunctionalCorePipelineInput,
  dependencies: Partial<FunctionalCorePipelineDependencies> = {},
): Result<CompileFunctionalCorePipelineSuccess, StructuredError> => {
  const compile = dependencies.compilePreset ?? compilePreset
  const planBuilder = dependencies.createLayoutPlan ?? createLayoutPlan
  const emitter = dependencies.emitPlan ?? emitPlan

  const compiled = compile(input)
  if (!compiled.ok) {
    return compiled
  }

  const planResult = planBuilder({ preset: compiled.value.preset })
  if (!planResult.ok) {
    return planResult
  }

  const emissionResult = emitter({ plan: planResult.value.plan })
  if (!emissionResult.ok) {
    return emissionResult
  }

  return success({
    preset: compiled.value.preset,
    plan: planResult.value.plan,
    emission: emissionResult.value,
  })
}

const success = <T>(value: T): Result<T, StructuredError> => ({
  ok: true,
  value,
})
