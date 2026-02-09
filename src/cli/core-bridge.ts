import {
  compilePreset as defaultCompilePreset,
  compilePresetFromValue as defaultCompilePresetFromValue,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "../core/index"
import type { CompilePresetFromValueInput, CompilePresetInput } from "../core/index"

export type CoreBridge = {
  readonly compilePreset: (input: CompilePresetInput) => ReturnType<typeof defaultCompilePreset>
  readonly compilePresetFromValue: (
    input: CompilePresetFromValueInput,
  ) => ReturnType<typeof defaultCompilePresetFromValue>
  readonly createLayoutPlan: (
    input: Parameters<typeof defaultCreateLayoutPlan>[0],
  ) => ReturnType<typeof defaultCreateLayoutPlan>
  readonly emitPlan: (input: Parameters<typeof defaultEmitPlan>[0]) => ReturnType<typeof defaultEmitPlan>
}
