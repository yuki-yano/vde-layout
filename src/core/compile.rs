use std::collections::HashSet;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use serde_saphyr::{DuplicateKeyPolicy, MergeKeyPolicy};

use super::error::{CoreError, CoreErrorKind};
use crate::model::Orientation;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CompiledRatioEntry {
    Weight { weight: f64 },
    FixedCells { cells: f64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledTerminalPane {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close_on_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledSplitPane {
    pub orientation: Orientation,
    pub ratio: Vec<CompiledRatioEntry>,
    pub panes: Vec<CompiledLayoutNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CompiledLayoutNode {
    Terminal(Box<CompiledTerminalPane>),
    Split(CompiledSplitPane),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompiledPresetHooks {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_apply: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompiledPresetMetadata {
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledPreset {
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<CompiledLayoutNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hooks: Option<CompiledPresetHooks>,
    pub metadata: CompiledPresetMetadata,
}

pub fn compile_preset(
    document: &str,
    source: impl Into<String>,
) -> Result<CompiledPreset, CoreError> {
    let source = source.into();
    let options = serde_saphyr::options! {
        duplicate_keys: DuplicateKeyPolicy::Error,
        merge_keys: MergeKeyPolicy::AsOrdinary,
        strict_booleans: true,
    };
    let value = serde_saphyr::from_str_with_options(document, options).map_err(|error| {
        core_error(
            CoreErrorKind::Compile,
            "PRESET_PARSE_ERROR",
            format!("Failed to parse YAML: {error}"),
            Some(&source),
            None,
            json!({ "reason": error.to_string() }),
        )
    })?;

    compile_preset_from_value(&value, source)
}

pub fn compile_preset_from_value(
    value: &Value,
    source: impl Into<String>,
) -> Result<CompiledPreset, CoreError> {
    let source = source.into();
    if !matches!(value, Value::Object(_) | Value::Array(_)) {
        return Err(core_error(
            CoreErrorKind::Compile,
            "PRESET_INVALID_DOCUMENT",
            "Preset definition is not an object",
            Some(&source),
            Some("preset"),
            Value::Null,
        ));
    }

    let name = property(value, "name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Unnamed preset")
        .to_owned();
    let command = property(value, "command")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let layout_value = property(value, "layout");
    validate_layout_definition(layout_value, &source, "preset.layout")?;
    let layout = match layout_value {
        None | Some(Value::Null) => None,
        Some(layout) => Some(parse_layout_node(layout, &source, "preset.layout")?),
    };

    Ok(CompiledPreset {
        name,
        version: "legacy".to_owned(),
        command,
        layout,
        hooks: parse_hooks(property(value, "hooks")),
        metadata: CompiledPresetMetadata { source },
    })
}

fn property<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object()?.get(key)
}

fn parse_hooks(value: Option<&Value>) -> Option<CompiledPresetHooks> {
    let object = value?.as_object()?;
    let after_apply = object
        .get("afterApply")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())?;
    Some(CompiledPresetHooks {
        after_apply: Some(after_apply.to_owned()),
    })
}

fn validate_layout_definition(
    layout: Option<&Value>,
    source: &str,
    path: &str,
) -> Result<(), CoreError> {
    let Some(layout) = layout else {
        return Ok(());
    };
    if layout.is_null() {
        return Ok(());
    }
    let Some(object) = layout.as_object() else {
        return Ok(());
    };
    if !looks_split_like(object) {
        return Ok(());
    }
    validate_split_schema(object, source, path, true)
}

fn validate_split_schema(
    object: &Map<String, Value>,
    source: &str,
    path: &str,
    root: bool,
) -> Result<(), CoreError> {
    if !matches!(
        object.get("type").and_then(Value::as_str),
        Some("horizontal" | "vertical")
    ) {
        return Err(core_error(
            CoreErrorKind::Compile,
            "LAYOUT_INVALID_ORIENTATION",
            "layout.type must be horizontal or vertical",
            Some(source),
            Some(&format!("{path}.type")),
            json!({ "type": object.get("type") }),
        ));
    }

    let ratio = match object.get("ratio").and_then(Value::as_array) {
        Some(ratio) if !ratio.is_empty() => ratio,
        _ if root => {
            return Err(core_error(
                CoreErrorKind::Compile,
                "LAYOUT_RATIO_MISSING",
                "ratio array is missing or empty",
                Some(source),
                Some(&format!("{path}.ratio")),
                Value::Null,
            ));
        }
        _ => return Err(invalid_node(source, path, object)),
    };

    for (index, value) in ratio.iter().enumerate() {
        if parse_ratio_entry(value, source, &format!("{path}.ratio[{index}]")).is_err() {
            return Err(core_error(
                CoreErrorKind::Compile,
                "RATIO_INVALID_VALUE",
                "ratio value must be a positive number or \"<positive-integer>c\"",
                Some(source),
                Some(&format!("{path}.ratio[{index}]")),
                json!({ "value": value }),
            ));
        }
    }

    let panes = match object.get("panes").and_then(Value::as_array) {
        Some(panes) if !panes.is_empty() => panes,
        _ if root => {
            return Err(core_error(
                CoreErrorKind::Compile,
                "LAYOUT_PANES_MISSING",
                "panes array is missing or empty",
                Some(source),
                Some(&format!("{path}.panes")),
                Value::Null,
            ));
        }
        _ => return Err(invalid_node(source, path, object)),
    };

    for (index, pane) in panes.iter().enumerate() {
        validate_pane_schema(pane, source, &format!("{path}.panes[{index}]"))?;
    }

    if ratio.len() != panes.len() {
        return Err(core_error(
            CoreErrorKind::Compile,
            "LAYOUT_RATIO_MISMATCH",
            "ratio and panes arrays must have the same length",
            Some(source),
            Some(path),
            json!({ "ratioLength": ratio.len(), "panesLength": panes.len() }),
        ));
    }

    if !ratio.iter().any(|entry| entry.as_f64().is_some()) {
        return Err(core_error(
            CoreErrorKind::Compile,
            "RATIO_WEIGHT_MISSING",
            "ratio must include at least one numeric weight",
            Some(source),
            Some(&format!("{path}.ratio")),
            json!({ "ratio": ratio }),
        ));
    }
    Ok(())
}

fn validate_pane_schema(value: &Value, source: &str, path: &str) -> Result<(), CoreError> {
    let Some(object) = value.as_object() else {
        return Err(core_error(
            CoreErrorKind::Compile,
            "LAYOUT_INVALID_NODE",
            "Layout node is invalid",
            Some(source),
            Some(path),
            json!({ "node": value }),
        ));
    };
    if looks_split_like(object) {
        return validate_split_schema(object, source, path, false)
            .map_err(|_| invalid_node(source, path, object));
    }

    let valid_name = object
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|name| !name.is_empty());
    let valid = valid_name
        && optional_string_is_valid(object, "command", false)
        && optional_string_is_valid(object, "cwd", false)
        && optional_string_is_valid(object, "title", false)
        && optional_bool_is_valid(object, "focus")
        && optional_bool_is_valid(object, "ephemeral")
        && optional_bool_is_valid(object, "closeOnError")
        && optional_delay_is_valid(object.get("delay"));
    if valid {
        Ok(())
    } else {
        Err(invalid_node(source, path, object))
    }
}

fn optional_string_is_valid(object: &Map<String, Value>, key: &str, nonempty: bool) -> bool {
    match object.get(key) {
        None => true,
        Some(Value::String(value)) => !nonempty || !value.is_empty(),
        Some(_) => false,
    }
}

fn optional_bool_is_valid(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none_or(Value::is_boolean)
}

fn optional_delay_is_valid(value: Option<&Value>) -> bool {
    value.is_none_or(|value| {
        value
            .as_f64()
            .is_some_and(|value| value.is_finite() && value > 0.0 && value.fract() == 0.0)
    })
}

fn invalid_node(source: &str, path: &str, node: &Map<String, Value>) -> CoreError {
    core_error(
        CoreErrorKind::Compile,
        "LAYOUT_INVALID_NODE",
        "Layout node is invalid",
        Some(source),
        Some(path),
        json!({ "node": node }),
    )
}

fn parse_layout_node(
    value: &Value,
    source: &str,
    path: &str,
) -> Result<CompiledLayoutNode, CoreError> {
    let object = value.as_object().ok_or_else(|| {
        core_error(
            CoreErrorKind::Compile,
            "LAYOUT_INVALID_NODE",
            "Layout node is invalid",
            Some(source),
            Some(path),
            json!({ "node": value }),
        )
    })?;

    if looks_split_like(object) {
        parse_split_pane(object, source, path).map(CompiledLayoutNode::Split)
    } else if object.get("name").is_some_and(Value::is_string) {
        Ok(CompiledLayoutNode::Terminal(Box::new(parse_terminal_pane(
            object,
        ))))
    } else {
        Err(invalid_node(source, path, object))
    }
}

fn looks_split_like(object: &Map<String, Value>) -> bool {
    object.contains_key("type") || object.contains_key("ratio") || object.contains_key("panes")
}

fn parse_split_pane(
    object: &Map<String, Value>,
    source: &str,
    path: &str,
) -> Result<CompiledSplitPane, CoreError> {
    let orientation = match object.get("type").and_then(Value::as_str) {
        Some("horizontal") => Orientation::Horizontal,
        Some("vertical") => Orientation::Vertical,
        _ => {
            return Err(core_error(
                CoreErrorKind::Compile,
                "LAYOUT_INVALID_NODE",
                "Layout node is invalid",
                Some(source),
                Some(path),
                json!({ "node": object }),
            ));
        }
    };
    let panes = object
        .get("panes")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_node(source, path, object))?
        .iter()
        .enumerate()
        .map(|(index, pane)| parse_layout_node(pane, source, &format!("{path}.panes[{index}]")))
        .collect::<Result<Vec<_>, _>>()?;
    let ratio = object
        .get("ratio")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_node(source, path, object))?
        .iter()
        .enumerate()
        .map(|(index, entry)| parse_ratio_entry(entry, source, &format!("{path}.ratio[{index}]")))
        .collect::<Result<Vec<_>, _>>()?;

    if !ratio
        .iter()
        .any(|entry| matches!(entry, CompiledRatioEntry::Weight { .. }))
    {
        return Err(core_error(
            CoreErrorKind::Compile,
            "RATIO_WEIGHT_MISSING",
            "ratio must include at least one numeric weight",
            Some(source),
            Some(&format!("{path}.ratio")),
            json!({ "ratio": object.get("ratio") }),
        ));
    }

    Ok(CompiledSplitPane {
        orientation,
        ratio,
        panes,
    })
}

fn parse_ratio_entry(
    value: &Value,
    source: &str,
    path: &str,
) -> Result<CompiledRatioEntry, CoreError> {
    if let Some(weight) = value.as_f64()
        && weight.is_finite()
        && weight > 0.0
    {
        return Ok(CompiledRatioEntry::Weight { weight });
    }
    if let Some(fixed) = value.as_str()
        && let Some(cells) = fixed.strip_suffix('c')
        && !cells.is_empty()
        && !cells.starts_with('0')
        && cells.bytes().all(|byte| byte.is_ascii_digit())
        && let Ok(cells) = cells.parse::<f64>()
        && cells.is_finite()
        && cells.fract() == 0.0
        && cells > 0.0
    {
        return Ok(CompiledRatioEntry::FixedCells { cells });
    }
    Err(core_error(
        CoreErrorKind::Compile,
        "RATIO_INVALID_VALUE",
        "ratio value must be a positive number or \"<positive-integer>c\"",
        Some(source),
        Some(path),
        json!({ "value": value }),
    ))
}

fn parse_terminal_pane(object: &Map<String, Value>) -> CompiledTerminalPane {
    const KNOWN_KEYS: [&str; 10] = [
        "name",
        "command",
        "cwd",
        "env",
        "focus",
        "ephemeral",
        "closeOnError",
        "options",
        "title",
        "delay",
    ];
    let known = KNOWN_KEYS.into_iter().collect::<HashSet<_>>();
    let options = object
        .iter()
        .filter(|(key, _)| !known.contains(key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Map<_, _>>();

    CompiledTerminalPane {
        name: object
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        command: string_value(object, "command"),
        cwd: string_value(object, "cwd"),
        env: normalize_env(object.get("env")),
        delay: object
            .get("delay")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0),
        title: object
            .get("title")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        focus: object
            .get("focus")
            .is_some_and(|value| value == true)
            .then_some(true),
        ephemeral: object
            .get("ephemeral")
            .is_some_and(|value| value == true)
            .then_some(true),
        close_on_error: object
            .get("closeOnError")
            .is_some_and(|value| value == true)
            .then_some(true),
        options: (!options.is_empty()).then_some(options),
    }
}

fn string_value(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn normalize_env(value: Option<&Value>) -> Option<IndexMap<String, String>> {
    let env = match value? {
        Value::Object(values) => values
            .iter()
            .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_owned())))
            .collect::<IndexMap<_, _>>(),
        Value::Array(values) => values
            .iter()
            .enumerate()
            .filter_map(|(index, value)| {
                value
                    .as_str()
                    .map(|value| (index.to_string(), value.to_owned()))
            })
            .collect::<IndexMap<_, _>>(),
        _ => return None,
    };
    (!env.is_empty()).then_some(env)
}

fn core_error(
    kind: CoreErrorKind,
    code: &str,
    message: impl Into<String>,
    source: Option<&str>,
    path: Option<&str>,
    details: Value,
) -> CoreError {
    let mut error = CoreError::new(kind, code, message);
    error.source = source.map(str::to_owned);
    error.path = path.map(str::to_owned);
    error.details = Box::new(details.as_object().cloned().unwrap_or_default());
    error
}
