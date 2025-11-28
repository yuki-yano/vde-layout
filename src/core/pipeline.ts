import type { CompilePresetInput, CompilePresetSuccess, CompiledPreset } from "./compile.ts"
import { compilePreset } from "./compile.ts"
import type { CreateLayoutPlanSuccess, LayoutPlan } from "./planner.ts"
import { createLayoutPlan } from "./planner.ts"
import type { PlanEmission } from "./emitter.ts"
import { emitPlan } from "./emitter.ts"

type CompileCorePipelineSuccess = {
  readonly preset: CompiledPreset
  readonly plan: LayoutPlan
  readonly emission: PlanEmission
}

type CorePipelineDependencies = {
  readonly compilePreset: typeof compilePreset
  readonly createLayoutPlan: typeof createLayoutPlan
  readonly emitPlan: typeof emitPlan
}

type CompileCorePipelineInput = CompilePresetInput

export const compileCorePipeline = (
  input: CompileCorePipelineInput,
  dependencies: Partial<CorePipelineDependencies> = {},
): CompileCorePipelineSuccess => {
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
