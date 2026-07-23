use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::compile::{
    CompiledLayoutNode, CompiledPreset, CompiledRatioEntry, CompiledSplitPane, CompiledTerminalPane,
};
use super::error::{CoreError, CoreErrorKind};
use crate::model::Orientation;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTerminal {
    pub id: String,
    pub name: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close_on_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanSplit {
    pub id: String,
    pub orientation: Orientation,
    pub ratio: Vec<CompiledRatioEntry>,
    pub panes: Vec<PlanNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PlanNode {
    Terminal(Box<PlanTerminal>),
    Split(PlanSplit),
}

impl PlanNode {
    pub fn id(&self) -> &str {
        match self {
            Self::Terminal(node) => &node.id,
            Self::Split(node) => &node.id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPlan {
    pub root: PlanNode,
    pub focus_pane_id: String,
}

pub fn create_layout_plan(preset: &CompiledPreset) -> Result<LayoutPlan, CoreError> {
    let Some(layout) = preset.layout.as_ref() else {
        let terminal = create_terminal_node(
            "root",
            &CompiledTerminalPane {
                name: preset.name.clone(),
                command: preset.command.clone(),
                cwd: None,
                env: None,
                delay: None,
                title: None,
                focus: None,
                ephemeral: None,
                close_on_error: None,
                options: None,
            },
            true,
        );
        return Ok(LayoutPlan {
            focus_pane_id: terminal.id.clone(),
            root: PlanNode::Terminal(Box::new(terminal)),
        });
    };

    let result = build_layout_node(layout, "root", "preset.layout", &preset.metadata.source)?;
    if result.focus_pane_ids.len() > 1 {
        return Err(plan_error(
            "FOCUS_CONFLICT",
            "Multiple panes specify focus=true",
            Some(&preset.metadata.source),
            Some("preset.layout"),
            json!({ "focusPaneIds": result.focus_pane_ids }),
        ));
    }
    let focus_pane_id = result
        .focus_pane_ids
        .first()
        .or_else(|| result.terminal_pane_ids.first())
        .cloned()
        .ok_or_else(|| {
            plan_error(
                "NO_TERMINAL_PANES",
                "No terminal panes are defined",
                Some(&preset.metadata.source),
                Some("preset.layout"),
                Value::Null,
            )
        })?;
    let mut root = result.node;
    ensure_focus(&mut root, &focus_pane_id);
    Ok(LayoutPlan {
        root,
        focus_pane_id,
    })
}

struct BuildResult {
    node: PlanNode,
    focus_pane_ids: Vec<String>,
    terminal_pane_ids: Vec<String>,
}

fn build_layout_node(
    node: &CompiledLayoutNode,
    parent_id: &str,
    path: &str,
    source: &str,
) -> Result<BuildResult, CoreError> {
    match node {
        CompiledLayoutNode::Terminal(terminal) => Ok(BuildResult {
            node: PlanNode::Terminal(Box::new(create_terminal_node(parent_id, terminal, false))),
            focus_pane_ids: terminal
                .focus
                .is_some_and(|focus| focus)
                .then(|| parent_id.to_owned())
                .into_iter()
                .collect(),
            terminal_pane_ids: vec![parent_id.to_owned()],
        }),
        CompiledLayoutNode::Split(split) => build_split_node(split, parent_id, path, source),
    }
}

fn build_split_node(
    node: &CompiledSplitPane,
    parent_id: &str,
    path: &str,
    source: &str,
) -> Result<BuildResult, CoreError> {
    validate_ratio_entries(&node.ratio, path, source)?;
    let mut panes = Vec::with_capacity(node.panes.len());
    let mut focus_pane_ids = Vec::new();
    let mut terminal_pane_ids = Vec::new();
    for (index, pane) in node.panes.iter().enumerate() {
        let child_id = format!("{parent_id}.{index}");
        let child_path = format!("{path}.panes[{index}]");
        let child = build_layout_node(pane, &child_id, &child_path, source)?;
        panes.push(child.node);
        focus_pane_ids.extend(child.focus_pane_ids);
        terminal_pane_ids.extend(child.terminal_pane_ids);
    }
    Ok(BuildResult {
        node: PlanNode::Split(PlanSplit {
            id: parent_id.to_owned(),
            orientation: node.orientation,
            ratio: node.ratio.clone(),
            panes,
        }),
        focus_pane_ids,
        terminal_pane_ids,
    })
}

fn create_terminal_node(
    id: &str,
    terminal: &CompiledTerminalPane,
    focus_override: bool,
) -> PlanTerminal {
    PlanTerminal {
        id: id.to_owned(),
        name: terminal.name.clone(),
        command: terminal.command.clone(),
        cwd: terminal.cwd.clone(),
        env: terminal.env.clone(),
        delay: terminal.delay,
        title: terminal.title.clone(),
        focus: focus_override || terminal.focus.is_some_and(|focus| focus),
        ephemeral: terminal.ephemeral,
        close_on_error: terminal.close_on_error,
        options: terminal.options.clone(),
    }
}

fn ensure_focus(node: &mut PlanNode, focus_pane_id: &str) {
    match node {
        PlanNode::Terminal(terminal) => terminal.focus = terminal.id == focus_pane_id,
        PlanNode::Split(split) => {
            for pane in &mut split.panes {
                ensure_focus(pane, focus_pane_id);
            }
        }
    }
}

fn validate_ratio_entries(
    ratio: &[CompiledRatioEntry],
    path: &str,
    source: &str,
) -> Result<(), CoreError> {
    let mut has_weight = false;
    for (index, value) in ratio.iter().enumerate() {
        let valid = match value {
            CompiledRatioEntry::Weight { weight } => {
                has_weight = true;
                weight.is_finite() && *weight > 0.0
            }
            CompiledRatioEntry::FixedCells { cells } => {
                cells.is_finite() && cells.fract() == 0.0 && *cells > 0.0
            }
        };
        if !valid {
            return Err(plan_error(
                "RATIO_INVALID_VALUE",
                "ratio value must be a positive number or \"<positive-integer>c\"",
                Some(source),
                Some(&format!("{path}.ratio[{index}]")),
                json!({ "value": value }),
            ));
        }
    }
    if !has_weight {
        return Err(plan_error(
            "RATIO_WEIGHT_MISSING",
            "ratio must include at least one numeric weight",
            Some(source),
            Some(&format!("{path}.ratio")),
            json!({ "ratio": ratio }),
        ));
    }
    Ok(())
}

fn plan_error(
    code: &str,
    message: &str,
    source: Option<&str>,
    path: Option<&str>,
    details: Value,
) -> CoreError {
    let mut error = CoreError::new(CoreErrorKind::Plan, code, message);
    error.source = source.map(str::to_owned);
    error.path = path.map(str::to_owned);
    error.details = Box::new(details.as_object().cloned().unwrap_or_default());
    error
}
