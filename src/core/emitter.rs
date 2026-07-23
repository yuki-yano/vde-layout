use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value, json};
use sha2::{Digest, Sha256};

use super::compile::CompiledRatioEntry;
use super::error::{CoreError, CoreErrorKind};
use super::planner::{LayoutPlan, PlanNode, PlanSplit};
use crate::model::Orientation;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandStepKind {
    Split,
    Focus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum SplitSizing {
    Percent {
        percentage: u8,
    },
    DynamicCells {
        target: CompiledRatioEntry,
        #[serde(rename = "remainingFixedCells")]
        remaining_fixed_cells: f64,
        #[serde(rename = "remainingWeight")]
        remaining_weight: f64,
        #[serde(rename = "remainingWeightPaneCount")]
        remaining_weight_pane_count: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandStep {
    pub id: String,
    pub kind: CommandStepKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<Vec<String>>,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_pane_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_pane_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<Orientation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percentage: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_sizing: Option<SplitSizing>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmittedTerminal {
    pub virtual_pane_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub focus: bool,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close_on_error: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEmissionSummary {
    pub steps_count: usize,
    pub focus_pane_id: String,
    pub initial_pane_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanEmission {
    pub steps: Vec<CommandStep>,
    pub summary: PlanEmissionSummary,
    pub terminals: Vec<EmittedTerminal>,
    pub hash: String,
}

pub fn emit_plan(plan: &LayoutPlan) -> Result<PlanEmission, CoreError> {
    validate_plan_for_emission(&plan.root)?;
    let mut steps = Vec::new();
    collect_split_steps(&plan.root, &mut steps);
    steps.push(CommandStep {
        id: format!("{}:focus", plan.focus_pane_id),
        kind: CommandStepKind::Focus,
        command: None,
        summary: format!("select pane {}", plan.focus_pane_id),
        target_pane_id: Some(plan.focus_pane_id.clone()),
        created_pane_id: None,
        orientation: None,
        percentage: None,
        split_sizing: None,
    });

    let initial_pane_id = determine_initial_pane_id(&plan.root).ok_or_else(|| {
        CoreError::new(
            CoreErrorKind::Emit,
            "NO_TERMINAL_PANES",
            "No terminal panes are defined",
        )
        .with_path("plan.root")
    })?;
    let hash = create_plan_hash(plan, &steps)?;
    Ok(PlanEmission {
        summary: PlanEmissionSummary {
            steps_count: steps.len(),
            focus_pane_id: plan.focus_pane_id.clone(),
            initial_pane_id,
        },
        terminals: collect_terminals(&plan.root),
        steps,
        hash,
    })
}

fn validate_plan_for_emission(node: &PlanNode) -> Result<(), CoreError> {
    let PlanNode::Split(split) = node else {
        return Ok(());
    };
    if split.ratio.len() != split.panes.len() {
        return Err(CoreError::new(
            CoreErrorKind::Emit,
            "LAYOUT_RATIO_MISMATCH",
            "ratio and panes arrays must have the same length",
        )
        .with_path(format!("plan.{}", split.id))
        .with_details(
            json!({
                "ratioLength": split.ratio.len(),
                "panesLength": split.panes.len(),
            })
            .as_object()
            .cloned()
            .unwrap_or_default(),
        ));
    }
    let mut fixed_cells = 0.0_f64;
    for entry in &split.ratio {
        if let CompiledRatioEntry::FixedCells { cells } = entry {
            fixed_cells += cells;
            if !fixed_cells.is_finite() || fixed_cells.fract() != 0.0 {
                return Err(CoreError::new(
                    CoreErrorKind::Emit,
                    "RATIO_INVALID_VALUE",
                    "fixed-cell ratio total must be a finite integer",
                )
                .with_path(format!("plan.{}.ratio", split.id)));
            }
        }
    }
    for pane in &split.panes {
        validate_plan_for_emission(pane)?;
    }
    Ok(())
}

fn collect_split_steps(node: &PlanNode, steps: &mut Vec<CommandStep>) {
    let PlanNode::Split(split) = node else {
        return;
    };
    append_split_steps(split, steps);
    for pane in &split.panes {
        collect_split_steps(pane, steps);
    }
}

fn append_split_steps(node: &PlanSplit, steps: &mut Vec<CommandStep>) {
    let direction_flag = match node.orientation {
        Orientation::Horizontal => "-h",
        Orientation::Vertical => "-v",
    };
    let has_fixed_cells = node
        .ratio
        .iter()
        .any(|entry| matches!(entry, CompiledRatioEntry::FixedCells { .. }));
    for index in 1..node.panes.len() {
        let target_pane_id = node
            .panes
            .get(index - 1)
            .map(PlanNode::id)
            .unwrap_or(&node.id)
            .to_owned();
        let created_pane_id = node.panes.get(index).map(PlanNode::id).map(str::to_owned);
        let split_sizing = if has_fixed_cells {
            build_dynamic_split_sizing(&node.ratio, index)
        } else {
            build_percent_split_sizing(&node.ratio, index)
        };
        let percentage = match &split_sizing {
            SplitSizing::Percent { percentage } => Some(*percentage),
            SplitSizing::DynamicCells { .. } => None,
        };
        steps.push(CommandStep {
            id: format!("{}:split:{index}", node.id),
            kind: CommandStepKind::Split,
            command: None,
            summary: format!("split {target_pane_id} ({direction_flag})"),
            target_pane_id: Some(target_pane_id),
            created_pane_id,
            orientation: Some(node.orientation),
            percentage,
            split_sizing: Some(split_sizing),
        });
    }
}

fn build_percent_split_sizing(ratio: &[CompiledRatioEntry], index: usize) -> SplitSizing {
    let remaining_including_target = ratio[index.saturating_sub(1)..]
        .iter()
        .map(weight_value)
        .sum::<f64>();
    let remaining_after_target = ratio[index..].iter().map(weight_value).sum::<f64>();
    let desired = if remaining_including_target <= 0.0 {
        0.0
    } else {
        remaining_after_target / remaining_including_target * 100.0
    };
    SplitSizing::Percent {
        percentage: clamp_percent(desired),
    }
}

fn build_dynamic_split_sizing(ratio: &[CompiledRatioEntry], index: usize) -> SplitSizing {
    let target = ratio[index.saturating_sub(1)].clone();
    let remaining = &ratio[index..];
    let remaining_fixed_cells = remaining
        .iter()
        .filter_map(|entry| match entry {
            CompiledRatioEntry::FixedCells { cells } => Some(*cells),
            CompiledRatioEntry::Weight { .. } => None,
        })
        .sum::<f64>();
    let remaining_weight = remaining.iter().map(weight_value).sum();
    let remaining_weight_pane_count = remaining
        .iter()
        .filter(|entry| matches!(entry, CompiledRatioEntry::Weight { .. }))
        .count();
    SplitSizing::DynamicCells {
        target,
        remaining_fixed_cells,
        remaining_weight,
        remaining_weight_pane_count,
    }
}

fn weight_value(entry: &CompiledRatioEntry) -> f64 {
    match entry {
        CompiledRatioEntry::Weight { weight } => *weight,
        CompiledRatioEntry::FixedCells { .. } => 0.0,
    }
}

fn clamp_percent(value: f64) -> u8 {
    value.round().clamp(1.0, 99.0) as u8
}

fn collect_terminals(node: &PlanNode) -> Vec<EmittedTerminal> {
    match node {
        PlanNode::Terminal(terminal) => vec![EmittedTerminal {
            virtual_pane_id: terminal.id.clone(),
            command: terminal.command.clone(),
            cwd: terminal.cwd.clone(),
            env: terminal.env.clone(),
            delay: terminal.delay,
            title: terminal.title.clone(),
            focus: terminal.focus,
            name: terminal.name.clone(),
            ephemeral: terminal.ephemeral,
            close_on_error: terminal.close_on_error,
        }],
        PlanNode::Split(split) => split.panes.iter().flat_map(collect_terminals).collect(),
    }
}

fn determine_initial_pane_id(node: &PlanNode) -> Option<String> {
    match node {
        PlanNode::Terminal(terminal) => Some(terminal.id.clone()),
        PlanNode::Split(split) => split.panes.first().and_then(determine_initial_pane_id),
    }
}

fn create_plan_hash(plan: &LayoutPlan, steps: &[CommandStep]) -> Result<String, CoreError> {
    let normalized = json!({
        "focusPaneId": plan.focus_pane_id,
        "root": plan.root,
        "steps": steps,
    });
    let bytes = serde_json::to_vec(&canonicalize_json(normalized)).map_err(|error| {
        CoreError::new(
            CoreErrorKind::Emit,
            "PLAN_SERIALIZATION_FAILED",
            format!("Failed to serialize plan: {error}"),
        )
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub fn canonical_json_value<T: Serialize>(value: &T) -> Result<Value, CoreError> {
    serde_json::to_value(value)
        .map(canonicalize_json)
        .map_err(|error| {
            CoreError::new(
                CoreErrorKind::Emit,
                "PLAN_SERIALIZATION_FAILED",
                format!("Failed to serialize plan: {error}"),
            )
        })
}

fn canonicalize_json(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| (key, canonicalize_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize_json).collect()),
        Value::Number(number) => Value::Number(canonicalize_number(number)),
        other => other,
    }
}

fn canonicalize_number(number: Number) -> Number {
    if number.is_i64() || number.is_u64() {
        return number;
    }
    let Some(value) = number.as_f64() else {
        return number;
    };
    if value.fract() == 0.0 {
        if (0.0..18_446_744_073_709_551_616.0).contains(&value) {
            return Number::from(value as u64);
        }
        if value >= i64::MIN as f64 && value < 9_223_372_036_854_775_808.0 {
            return Number::from(value as i64);
        }
    }
    Number::from_f64(value).unwrap_or(number)
}
