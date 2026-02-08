import type { CompilePresetInput, CompilePresetSuccess, CompiledPreset } from "./compile"
import { compilePreset } from "./compile"
import type { CreateLayoutPlanSuccess, LayoutPlan } from "./planner"
import { createLayoutPlan } from "./planner"
import type { PlanEmission } from "./emitter"
import { emitPlan } from "./emitter"

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
