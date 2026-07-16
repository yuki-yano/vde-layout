use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeztermPaneSize {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeztermListPane {
    pub pane_id: String,
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<WeztermPaneSize>,
    pub raw_pane_record: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeztermListTab {
    pub tab_id: String,
    pub is_active: bool,
    pub panes: Vec<WeztermListPane>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WeztermListWindow {
    pub window_id: String,
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    pub tabs: Vec<WeztermListTab>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WeztermListResult {
    pub windows: Vec<WeztermListWindow>,
}

struct MutableTab {
    tab_id: String,
    is_active: bool,
    panes: Vec<WeztermListPane>,
}

struct MutableWindow {
    window_id: String,
    is_active: bool,
    workspace: Option<String>,
    tabs: IndexMap<String, MutableTab>,
}

struct ArrayEntry {
    window_id: String,
    tab_id: String,
    pane_id: String,
    workspace: Option<String>,
    is_active: bool,
    size: Option<WeztermPaneSize>,
}

pub fn parse_wezterm_list_result(stdout: &str) -> Option<WeztermListResult> {
    let parsed: Value = serde_json::from_str(stdout).ok()?;
    match parsed {
        Value::Array(entries) => Some(parse_array(entries)),
        Value::Object(object) => Some(parse_object(&object)),
        _ => None,
    }
}

fn parse_array(entries: Vec<Value>) -> WeztermListResult {
    let mut windows = IndexMap::<String, MutableWindow>::new();
    for value in &entries {
        let Some(entry) = normalize_array_entry(value) else {
            continue;
        };
        let window = windows
            .entry(entry.window_id.clone())
            .or_insert_with(|| MutableWindow {
                window_id: entry.window_id.clone(),
                is_active: false,
                workspace: entry.workspace.clone(),
                tabs: IndexMap::new(),
            });
        if window.workspace.is_none() && entry.workspace.is_some() {
            window.workspace.clone_from(&entry.workspace);
        }
        window.is_active |= entry.is_active;
        let tab = window
            .tabs
            .entry(entry.tab_id.clone())
            .or_insert_with(|| MutableTab {
                tab_id: entry.tab_id.clone(),
                is_active: false,
                panes: Vec::new(),
            });
        tab.is_active |= entry.is_active;
        tab.panes.push(WeztermListPane {
            pane_id: entry.pane_id.clone(),
            is_active: entry.is_active,
            size: entry.size,
            raw_pane_record: raw_pane_record(
                &entry.window_id,
                &entry.tab_id,
                &entry.pane_id,
                Some(entry.is_active),
                entry.size,
                "wezterm-array",
            ),
        });
    }
    WeztermListResult {
        windows: windows
            .into_values()
            .map(|window| WeztermListWindow {
                window_id: window.window_id,
                is_active: window.is_active,
                workspace: window.workspace,
                tabs: window
                    .tabs
                    .into_values()
                    .map(|tab| WeztermListTab {
                        tab_id: tab.tab_id,
                        is_active: tab.is_active,
                        panes: tab.panes,
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn normalize_array_entry(value: &Value) -> Option<ArrayEntry> {
    let object = value.as_object()?;
    let window_id = id_string(object.get("window_id")?)?;
    let pane_id = id_string(object.get("pane_id")?)?;
    if window_id.is_empty() || pane_id.is_empty() {
        return None;
    }
    let tab_id = object
        .get("tab_id")
        .and_then(id_string)
        .unwrap_or_else(|| window_id.clone());
    if tab_id.is_empty() {
        return None;
    }
    Some(ArrayEntry {
        window_id,
        tab_id,
        pane_id,
        workspace: non_empty_string(object.get("workspace")),
        is_active: object.get("is_active") == Some(&Value::Bool(true)),
        size: pane_size(object.get("size")),
    })
}

fn parse_object(object: &Map<String, Value>) -> WeztermListResult {
    let windows = object
        .get("windows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(parse_object_window)
        .collect();
    WeztermListResult { windows }
}

fn parse_object_window(value: &Value) -> Option<WeztermListWindow> {
    let object = value.as_object()?;
    let window_id = id_string(object.get("window_id")?)?;
    if window_id.is_empty() {
        return None;
    }
    let tabs = object
        .get("tabs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tab| parse_object_tab(tab, &window_id))
        .collect();
    Some(WeztermListWindow {
        window_id,
        is_active: object.get("is_active") == Some(&Value::Bool(true)),
        workspace: non_empty_string(object.get("workspace")),
        tabs,
    })
}

fn parse_object_tab(value: &Value, window_id: &str) -> Option<WeztermListTab> {
    let object = value.as_object()?;
    let tab_id = id_string(object.get("tab_id")?)?;
    if tab_id.is_empty() {
        return None;
    }
    let panes = object
        .get("panes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|pane| parse_object_pane(pane, window_id, &tab_id))
        .collect();
    Some(WeztermListTab {
        tab_id,
        is_active: object.get("is_active") == Some(&Value::Bool(true)),
        panes,
    })
}

fn parse_object_pane(value: &Value, window_id: &str, tab_id: &str) -> Option<WeztermListPane> {
    let object = value.as_object()?;
    let pane_id = id_string(object.get("pane_id")?)?;
    if pane_id.is_empty() {
        return None;
    }
    let size = pane_size(object.get("size"));
    let is_active = object.get("is_active") == Some(&Value::Bool(true));
    Some(WeztermListPane {
        raw_pane_record: raw_pane_record(
            window_id,
            tab_id,
            &pane_id,
            Some(is_active),
            size,
            "wezterm-object",
        ),
        pane_id,
        is_active,
        size,
    })
}

fn raw_pane_record(
    window_id: &str,
    tab_id: &str,
    pane_id: &str,
    is_active: Option<bool>,
    size: Option<WeztermPaneSize>,
    source_format: &str,
) -> Value {
    let mut record = Map::new();
    record.insert("backend".to_owned(), json!("wezterm"));
    record.insert("windowId".to_owned(), json!(window_id));
    record.insert("tabId".to_owned(), json!(tab_id));
    record.insert("paneId".to_owned(), json!(pane_id));
    if let Some(active) = is_active {
        record.insert("isActive".to_owned(), json!(active));
    }
    if let Some(size) = size {
        record.insert("size".to_owned(), json!(size));
    }
    record.insert("sourceFormat".to_owned(), json!(source_format));
    Value::Object(record)
}

fn id_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn pane_size(value: Option<&Value>) -> Option<WeztermPaneSize> {
    let object = value?.as_object()?;
    let cols = object.get("cols").and_then(positive_integer);
    let rows = object.get("rows").and_then(positive_integer);
    (cols.is_some() || rows.is_some()).then_some(WeztermPaneSize { cols, rows })
}

fn positive_integer(value: &Value) -> Option<u64> {
    let number = value.as_f64()?;
    if !number.is_finite() || number.fract() != 0.0 || number <= 0.0 || number > u64::MAX as f64 {
        return None;
    }
    Some(number as u64)
}
