use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    ConfigNotFound,
    ConfigParseError,
    ConfigPermissionError,
    InvalidPreset,
    PresetNotFound,
    InvalidLayout,
    InvalidPane,
    InvalidPlan,
    MissingTarget,
    TmuxNotRunning,
    TmuxCommandFailed,
    NotInTmuxSession,
    TmuxNotFound,
    TmuxNotInstalled,
    UnsupportedTmuxVersion,
    BackendNotFound,
    TerminalCommandFailed,
    TemplateTokenError,
    WeztermNotFound,
    UnsupportedWeztermVersion,
    HerdrNotFound,
    UnsupportedHerdrVersion,
    UserCancelled,
    SplitSizeResolutionFailed,
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let serialized = serde_json::to_value(self).map_err(|_| std::fmt::Error)?;
        formatter.write_str(serialized.as_str().ok_or(std::fmt::Error)?)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Config,
    Validation,
    Tmux,
    Environment,
    Execution,
}

impl std::fmt::Display for ErrorKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Config => "ConfigError",
            Self::Validation => "ValidationError",
            Self::Tmux => "TmuxError",
            Self::Environment => "EnvironmentError",
            Self::Execution => "ExecutionError",
        })
    }
}

#[derive(Debug, Clone, Error)]
#[error("{message}")]
pub struct VdeError {
    pub kind: ErrorKind,
    pub code: ErrorCode,
    pub message: String,
    pub details: Map<String, Value>,
}

impl VdeError {
    pub fn new(
        kind: ErrorKind,
        code: ErrorCode,
        message: impl Into<String>,
        details: Map<String, Value>,
    ) -> Self {
        Self {
            kind,
            code,
            message: message.into(),
            details,
        }
    }

    pub fn config(
        code: ErrorCode,
        message: impl Into<String>,
        details: Map<String, Value>,
    ) -> Self {
        Self::new(ErrorKind::Config, code, message, details)
    }

    pub fn validation(
        code: ErrorCode,
        message: impl Into<String>,
        details: Map<String, Value>,
    ) -> Self {
        Self::new(ErrorKind::Validation, code, message, details)
    }
}

pub fn empty_details() -> Map<String, Value> {
    Map::new()
}

pub fn object_details(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

pub fn format_error(error: &VdeError) -> String {
    let mut message = format!("Error: {}", error.message);

    match error.code {
        ErrorCode::ConfigNotFound => {
            if let Some(paths) = error.details.get("searchPaths").and_then(Value::as_array) {
                message.push_str("\n\nSearched in the following locations:");
                for path in paths.iter().filter_map(Value::as_str) {
                    message.push_str(&format!("\n  - {path}"));
                }
                message.push_str(
                    "\n\nTo create a configuration file, run:\n  mkdir -p ~/.config/vde\n  echo \"presets: {}\" > ~/.config/vde/layout.yml",
                );
            }
        }
        ErrorCode::NotInTmuxSession => {
            message.push_str(
                "\n\nThis command must be run inside a tmux session.\nStart tmux first with: tmux\n",
            );
        }
        ErrorCode::TmuxNotFound | ErrorCode::TmuxNotInstalled => {
            message.push_str(
                "\n\ntmux is required but not installed.\nInstall tmux using your package manager:\n  - macOS: brew install tmux\n  - Ubuntu/Debian: sudo apt-get install tmux\n  - Fedora: sudo dnf install tmux\n",
            );
        }
        ErrorCode::UnsupportedTmuxVersion => {
            if let Some(required) = error.details.get("requiredVersion").and_then(Value::as_str) {
                message.push_str(&format!(
                    "\n\nRequired tmux version: {required} or higher\n"
                ));
            }
        }
        ErrorCode::BackendNotFound => {
            let backend = error
                .details
                .get("backend")
                .and_then(Value::as_str)
                .unwrap_or("terminal backend");
            let binary = error
                .details
                .get("binary")
                .and_then(Value::as_str)
                .unwrap_or(backend);
            message.push_str(&format!("\n\nMissing binary: {binary}"));
            if backend == "wezterm" {
                message.push_str(
                    "\nwezterm is required but not installed.\nInstall wezterm using your package manager:\n  - macOS: brew install --cask wezterm\n  - Ubuntu/Debian: sudo apt-get install wezterm\n  - Fedora: sudo dnf install wezterm",
                );
            } else if backend == "herdr" {
                message.push_str(
                    "\nherdr is required but not installed.\nInstall herdr 0.7.4 or higher and ensure it is on $PATH.",
                );
            }
        }
        ErrorCode::WeztermNotFound => {
            message.push_str(
                "\n\nwezterm command was not found.\nInstall wezterm using your package manager:\n  - macOS: brew install --cask wezterm\n  - Ubuntu/Debian: sudo apt-get install wezterm\n  - Fedora: sudo dnf install wezterm\n",
            );
        }
        ErrorCode::UnsupportedWeztermVersion => {
            message.push_str("\n\nUnsupported wezterm version detected.");
            append_string_detail(
                &mut message,
                &error.details,
                "detectedVersion",
                "Detected version",
            );
            if let Some(required) = error.details.get("requiredVersion").and_then(Value::as_str) {
                message.push_str(&format!("\nRequired version: {required} or higher"));
            }
        }
        ErrorCode::HerdrNotFound => {
            message.push_str(
                "\n\nherdr command was not found.\nInstall herdr 0.7.4 or higher and ensure it is on $PATH.\n",
            );
        }
        ErrorCode::UnsupportedHerdrVersion => {
            message.push_str("\n\nUnsupported herdr version detected.");
            append_string_detail(
                &mut message,
                &error.details,
                "detectedVersion",
                "Detected version",
            );
            if let Some(required) = error.details.get("requiredVersion").and_then(Value::as_str) {
                message.push_str(&format!("\nRequired version: {required} or higher"));
            }
        }
        ErrorCode::SplitSizeResolutionFailed => {
            message.push_str("\n\nUnable to resolve split size from pane dimensions.");
            append_string_detail(&mut message, &error.details, "paneId", "Pane ID");
            if let Some(cells) = error.details.get("paneCells").and_then(Value::as_u64) {
                message.push_str(&format!("\nPane cells: {cells}"));
            }
            append_string_detail(
                &mut message,
                &error.details,
                "detectedVersion",
                "Detected version",
            );
            append_string_detail(
                &mut message,
                &error.details,
                "requiredVersion",
                "Required version",
            );
        }
        _ => {}
    }

    if let Some(command) = error.details.get("command") {
        message.push_str(&format!("\nCommand: {command}"));
    }
    if let Some(stderr) = error.details.get("stderr") {
        message.push_str(&format!("\nstderr: {}", value_to_text(stderr)));
    }
    if let Some(preset) = error.details.get("preset") {
        message.push_str(&format!("\npreset: {}", value_to_text(preset)));
    }
    if let Some(errors) = error.details.get("errors").and_then(Value::as_array)
        && !errors.is_empty()
    {
        message.push_str("\nValidation errors:\n");
        for nested in errors {
            message.push_str(&format!("  - {}\n", value_to_text(nested)));
        }
    }

    message
}

fn append_string_detail(output: &mut String, details: &Map<String, Value>, key: &str, label: &str) {
    if let Some(value) = details.get(key).and_then(Value::as_str) {
        output.push_str(&format!("\n{label}: {value}"));
    }
}

fn value_to_text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}
