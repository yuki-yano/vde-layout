mod compile;
mod emitter;
mod error;
mod planner;

pub use compile::{
    CompiledLayoutNode, CompiledPreset, CompiledPresetHooks, CompiledPresetMetadata,
    CompiledRatioEntry, CompiledSplitPane, CompiledTerminalPane, compile_preset,
    compile_preset_from_value,
};
pub use emitter::{
    CommandStep, CommandStepKind, EmittedTerminal, PlanEmission, PlanEmissionSummary, SplitSizing,
    canonical_json_value, emit_plan,
};
pub use error::{CoreError, CoreErrorKind};
pub use planner::{LayoutPlan, PlanNode, PlanSplit, PlanTerminal, create_layout_plan};

#[derive(Debug, Clone, PartialEq)]
pub struct CorePipelineResult {
    pub preset: CompiledPreset,
    pub plan: LayoutPlan,
    pub emission: PlanEmission,
}

pub fn compile_core_pipeline(
    document: &str,
    source: impl Into<String>,
) -> Result<CorePipelineResult, CoreError> {
    let preset = compile_preset(document, source)?;
    let plan = create_layout_plan(&preset)?;
    let emission = emit_plan(&plan)?;
    Ok(CorePipelineResult {
        preset,
        plan,
        emission,
    })
}
