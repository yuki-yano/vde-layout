import type { CompilePresetInput, CompilePresetSuccess, FunctionalPreset } from "./compile.ts"
import { compilePreset } from "./compile.ts"
import type { CreateLayoutPlanSuccess, LayoutPlan } from "./planner.ts"
import { createLayoutPlan } from "./planner.ts"
import type { PlanEmission } from "./emitter.ts"
import { emitPlan } from "./emitter.ts"

export type CompileFunctionalCorePipelineSuccess = {
  readonly preset: FunctionalPreset
  readonly plan: LayoutPlan
  readonly emission: PlanEmission
}

export type FunctionalCorePipelineDependencies = {
  readonly compilePreset: typeof compilePreset
  readonly createLayoutPlan: typeof createLayoutPlan
  readonly emitPlan: typeof emitPlan
}

export type CompileFunctionalCorePipelineInput = CompilePresetInput

export const compileFunctionalCorePipeline = (
  input: CompileFunctionalCorePipelineInput,
  dependencies: Partial<FunctionalCorePipelineDependencies> = {},
): CompileFunctionalCorePipelineSuccess => {
  const compile = dependencies.compilePreset ?? compilePreset
  const planBuilder = dependencies.createLayoutPlan ?? createLayoutPlan
  const emitter = dependencies.emitPlan ?? emitPlan

  const compileResult: CompilePresetSuccess = compile(input)
  const planResult: CreateLayoutPlanSuccess = planBuilder({ preset: compileResult.preset })
  const emission: PlanEmission = emitter({ plan: planResult.plan })

  return {
    preset: compileResult.preset,
    plan: planResult.plan,
    emission,
  }
}
