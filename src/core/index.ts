export { runDiagnostics } from "./diagnostics.ts"
export { compilePreset } from "./compile.ts"
export { createLayoutPlan } from "./planner.ts"
export { emitPlan } from "./emitter.ts"
export { compileFunctionalCorePipeline } from "./pipeline.ts"

export type {
  DiagnosticsBacklogItem,
  DiagnosticsFinding,
  DiagnosticsReport,
  DiagnosticsSeverity,
} from "./diagnostics.ts"

export type {
  CompilePresetInput,
  CompilePresetSuccess,
  FunctionalLayoutNode,
  FunctionalPreset,
  FunctionalSplitPane,
  FunctionalTerminalPane,
  Result,
  StructuredError,
} from "./compile.ts"

export type {
  CreateLayoutPlanInput,
  CreateLayoutPlanSuccess,
  LayoutPlan,
  PlanNode,
  PlanSplit,
  PlanTerminal,
} from "./planner.ts"

export type { CommandStep, PlanEmission, PlanEmissionSummary } from "./emitter.ts"

export type {
  CompileFunctionalCorePipelineSuccess,
  CompileFunctionalCorePipelineInput,
  FunctionalCorePipelineDependencies,
} from "./pipeline.ts"
