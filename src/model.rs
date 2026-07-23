use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WindowMode {
    NewWindow,
    CurrentWindow,
}

impl std::fmt::Display for WindowMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::NewWindow => "new-window",
            Self::CurrentWindow => "current-window",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalBackendKind {
    Tmux,
    Wezterm,
    Herdr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Orientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectUiMode {
    Auto,
    Fzf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectSurfaceMode {
    Auto,
    Inline,
    TmuxPopup,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RatioValue {
    Weight(f64),
    FixedCells(String),
}

impl RatioValue {
    pub fn is_weight(&self) -> bool {
        matches!(self, Self::Weight(_))
    }

    pub fn fixed_cells(&self) -> Option<u32> {
        match self {
            Self::Weight(_) => None,
            Self::FixedCells(value) => value.strip_suffix('c')?.parse().ok(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SelectorFzfDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SelectorDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<SelectUiMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<SelectSurfaceMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_popup_opts: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fzf: Option<SelectorFzfDefaults>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_mode: Option<WindowMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<SelectorDefaults>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Hooks {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_apply: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPane {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<IndexMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close_on_error: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SplitPane {
    #[serde(rename = "type")]
    pub orientation: Orientation,
    pub ratio: Vec<RatioValue>,
    pub panes: Vec<Pane>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Pane {
    Split(SplitPane),
    Terminal(TerminalPane),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    #[serde(rename = "type")]
    pub orientation: Orientation,
    pub ratio: Vec<RatioValue>,
    pub panes: Vec<Pane>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_mode: Option<WindowMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<TerminalBackendKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hooks: Option<Hooks>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defaults: Option<ConfigDefaults>,
    pub presets: IndexMap<String, Preset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetInfo {
    pub key: String,
    pub name: String,
    pub description: Option<String>,
}
