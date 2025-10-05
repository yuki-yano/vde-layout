export { runDiagnostics } from "./diagnostics"
export { compilePreset } from "./compile"
export { createLayoutPlan } from "./planner"
export { emitPlan } from "./emitter"
export { compileFunctionalCorePipeline } from "./pipeline"

export type {
  DiagnosticsBacklogItem,
  DiagnosticsFinding,
  DiagnosticsReport,
  DiagnosticsSeverity,
} from "./diagnostics"

export type {
  CompilePresetInput,
  CompilePresetSuccess,
  FunctionalLayoutNode,
  FunctionalPreset,
  FunctionalSplitPane,
  FunctionalTerminalPane,
  Result,
  StructuredError,
} from "./compile"

export type {
  CreateLayoutPlanInput,
  CreateLayoutPlanSuccess,
  LayoutPlan,
  PlanNode,
  PlanSplit,
  PlanTerminal,
} from "./planner"

export type {
  CommandStep,
  PlanEmission,
  PlanEmissionSummary,
} from "./emitter"

export type {
  CompileFunctionalCorePipelineSuccess,
  CompileFunctionalCorePipelineInput,
  FunctionalCorePipelineDependencies,
} from "./pipeline"
