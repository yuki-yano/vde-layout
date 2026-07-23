use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use serde_saphyr::{DuplicateKeyPolicy, MergeKeyPolicy};

use crate::error::{ErrorCode, VdeError, object_details};
use crate::model::{
    Config, ConfigDefaults, Hooks, Layout, Orientation, Pane, Preset, RatioValue,
    SelectSurfaceMode, SelectUiMode, SelectorDefaults, SelectorFzfDefaults, SplitPane,
    TerminalBackendKind, TerminalPane, WindowMode,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
    pub code: String,
}

impl ValidationIssue {
    fn new(path: impl Into<String>, message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
            code: code.into(),
        }
    }
}

#[derive(Default)]
struct Validator {
    issues: Vec<ValidationIssue>,
}

impl Validator {
    fn issue(&mut self, path: impl Into<String>, message: impl Into<String>, code: &str) {
        self.issues.push(ValidationIssue::new(path, message, code));
    }
}

pub fn validate_yaml(yaml_text: &str) -> Result<Config, VdeError> {
    if yaml_text.is_empty() {
        return Err(VdeError::validation(
            ErrorCode::ConfigParseError,
            "YAML text not provided",
            object_details(json!({ "received": "string" })),
        ));
    }

    let options = serde_saphyr::options! {
        duplicate_keys: DuplicateKeyPolicy::Error,
        merge_keys: MergeKeyPolicy::AsOrdinary,
        strict_booleans: true,
    };
    let parsed: Value =
        serde_saphyr::from_str_with_options(yaml_text, options).map_err(|error| {
            VdeError::validation(
                ErrorCode::ConfigParseError,
                "Failed to parse YAML",
                object_details(json!({
                    "parseError": error.to_string(),
                    "yamlSnippet": yaml_text.chars().take(200).collect::<String>(),
                })),
            )
        })?;

    let root = parsed.as_object().ok_or_else(|| {
        VdeError::validation(
            ErrorCode::ConfigParseError,
            "YAML is empty or invalid format",
            object_details(json!({ "parsed": parsed })),
        )
    })?;

    let presets_value = root
        .get("presets")
        .filter(|value| !value.is_null())
        .ok_or_else(|| {
            VdeError::validation(
                ErrorCode::InvalidPreset,
                "presets field is required",
                object_details(json!({
                    "availableFields": root.keys().collect::<Vec<_>>(),
                })),
            )
        })?;

    let presets_object = presets_value.as_object().ok_or_else(|| {
        VdeError::validation(
            ErrorCode::InvalidPreset,
            "At least one preset is required",
            object_details(json!({ "presets": presets_value })),
        )
    })?;
    if presets_object.is_empty() {
        return Err(VdeError::validation(
            ErrorCode::InvalidPreset,
            "At least one preset is required",
            object_details(json!({ "presets": presets_value })),
        ));
    }

    validate_config_value(&parsed, true)
}

pub fn validate_config_value(value: &Value, require_presets: bool) -> Result<Config, VdeError> {
    let mut validator = Validator::default();
    let config = parse_config(value, require_presets, &mut validator);
    finish_validation(config, validator)
}

pub fn validate_preset_value(value: &Value) -> Result<Preset, VdeError> {
    let mut validator = Validator::default();
    let preset = parse_preset(value, "", &mut validator);
    finish_validation(preset, validator)
}

pub fn validate_pane_value(value: &Value) -> Result<Pane, VdeError> {
    let mut validator = Validator::default();
    let pane = parse_pane(value, "", &mut validator);
    finish_validation(pane, validator)
}

fn finish_validation<T>(value: Option<T>, validator: Validator) -> Result<T, VdeError> {
    match (value, validator.issues.first()) {
        (Some(value), None) => Ok(value),
        (_, first) => {
            let message = first
                .map(|issue| issue.message.clone())
                .unwrap_or_else(|| "Configuration validation failed".to_owned());
            Err(VdeError::validation(
                ErrorCode::ConfigParseError,
                message,
                object_details(json!({ "issues": validator.issues })),
            ))
        }
    }
}

fn parse_config(value: &Value, require_presets: bool, validator: &mut Validator) -> Option<Config> {
    let object = expect_object(value, "", validator)?;
    let defaults = match object.get("defaults") {
        None => None,
        Some(value) => parse_defaults(value, "defaults", validator),
    };

    let presets = match object.get("presets") {
        Some(Value::Object(presets)) => {
            if require_presets && presets.is_empty() {
                validator.issue("presets", "At least one preset is required", "too_small");
            }
            let mut parsed = IndexMap::new();
            for (key, value) in presets {
                if let Some(preset) = parse_preset(value, &format!("presets.{key}"), validator) {
                    parsed.insert(key.clone(), preset);
                }
            }
            Some(parsed)
        }
        Some(_) => {
            validator.issue("presets", "presets must be an object", "invalid_type");
            None
        }
        None => {
            validator.issue("presets", "presets field is required", "invalid_type");
            None
        }
    };

    Some(Config {
        defaults,
        presets: presets?,
    })
}

fn parse_defaults(value: &Value, path: &str, validator: &mut Validator) -> Option<ConfigDefaults> {
    let object = expect_object(value, path, validator)?;
    let window_mode = optional_enum(
        object,
        "windowMode",
        path,
        validator,
        parse_window_mode,
        "Invalid enum value. Expected 'new-window' | 'current-window'",
    );
    let selector = match object.get("selector") {
        None => None,
        Some(value) => parse_selector_defaults(value, &child_path(path, "selector"), validator),
    };
    Some(ConfigDefaults {
        window_mode,
        selector,
    })
}

fn parse_selector_defaults(
    value: &Value,
    path: &str,
    validator: &mut Validator,
) -> Option<SelectorDefaults> {
    let object = expect_object(value, path, validator)?;
    reject_unknown_fields(
        object,
        &["ui", "surface", "tmuxPopupOpts", "fzf"],
        path,
        validator,
    );

    let ui = optional_enum(
        object,
        "ui",
        path,
        validator,
        parse_select_ui,
        "Invalid enum value. Expected 'auto' | 'fzf'",
    );
    let surface = optional_enum(
        object,
        "surface",
        path,
        validator,
        parse_select_surface,
        "Invalid enum value. Expected 'auto' | 'inline' | 'tmux-popup'",
    );
    let tmux_popup_opts = optional_nonempty_string(object, "tmuxPopupOpts", path, validator);
    let fzf = match object.get("fzf") {
        None => None,
        Some(value) => parse_selector_fzf(value, &child_path(path, "fzf"), validator),
    };

    Some(SelectorDefaults {
        ui,
        surface,
        tmux_popup_opts,
        fzf,
    })
}

fn parse_selector_fzf(
    value: &Value,
    path: &str,
    validator: &mut Validator,
) -> Option<SelectorFzfDefaults> {
    let object = expect_object(value, path, validator)?;
    reject_unknown_fields(object, &["extraArgs"], path, validator);
    let extra_args = match object.get("extraArgs") {
        None => None,
        Some(Value::Array(values)) => {
            let mut result = Vec::with_capacity(values.len());
            for (index, value) in values.iter().enumerate() {
                match value.as_str() {
                    Some(value) if !value.is_empty() => result.push(value.to_owned()),
                    Some(_) => validator.issue(
                        format!("{}.extraArgs.{index}", path),
                        "String must contain at least 1 character(s)",
                        "too_small",
                    ),
                    None => validator.issue(
                        format!("{}.extraArgs.{index}", path),
                        "Expected string",
                        "invalid_type",
                    ),
                }
            }
            Some(result)
        }
        Some(_) => {
            validator.issue(
                child_path(path, "extraArgs"),
                "Expected array",
                "invalid_type",
            );
            None
        }
    };
    Some(SelectorFzfDefaults { extra_args })
}

fn parse_preset(value: &Value, path: &str, validator: &mut Validator) -> Option<Preset> {
    let object = expect_object(value, path, validator)?;
    let name = required_nonempty_string(object, "name", path, validator);
    let description = optional_string(object, "description", path, validator);
    let command = optional_string(object, "command", path, validator);
    let layout = match object.get("layout") {
        None => None,
        Some(value) => parse_layout(value, &child_path(path, "layout"), validator),
    };
    let window_mode = optional_enum(
        object,
        "windowMode",
        path,
        validator,
        parse_window_mode,
        "Invalid enum value. Expected 'new-window' | 'current-window'",
    );
    let backend = optional_enum(
        object,
        "backend",
        path,
        validator,
        parse_backend,
        "Invalid enum value. Expected 'tmux' | 'wezterm' | 'herdr'",
    );
    let hooks = match object.get("hooks") {
        None => None,
        Some(value) => parse_hooks(value, &child_path(path, "hooks"), validator),
    };

    Some(Preset {
        name: name?,
        description,
        layout,
        command,
        window_mode,
        backend,
        hooks,
    })
}

fn parse_hooks(value: &Value, path: &str, validator: &mut Validator) -> Option<Hooks> {
    let object = expect_object(value, path, validator)?;
    reject_unknown_fields(object, &["afterApply"], path, validator);
    Some(Hooks {
        after_apply: optional_nonempty_string(object, "afterApply", path, validator),
    })
}

fn parse_layout(value: &Value, path: &str, validator: &mut Validator) -> Option<Layout> {
    let split = parse_split(value, path, false, validator)?;
    Some(Layout {
        orientation: split.orientation,
        ratio: split.ratio,
        panes: split.panes,
    })
}

fn parse_pane(value: &Value, path: &str, validator: &mut Validator) -> Option<Pane> {
    let object = expect_object(value, path, validator)?;
    if object.contains_key("type") {
        parse_split(value, path, true, validator).map(Pane::Split)
    } else {
        parse_terminal(object, path, validator).map(Pane::Terminal)
    }
}

fn parse_split(
    value: &Value,
    path: &str,
    strict: bool,
    validator: &mut Validator,
) -> Option<SplitPane> {
    let object = expect_object(value, path, validator)?;
    if strict {
        reject_unknown_fields(object, &["type", "ratio", "panes"], path, validator);
    }

    let orientation = required_enum(
        object,
        "type",
        path,
        validator,
        parse_orientation,
        "Invalid enum value. Expected 'horizontal' | 'vertical'",
    );
    let ratio = parse_ratio(object.get("ratio"), &child_path(path, "ratio"), validator);
    let panes = match object.get("panes") {
        Some(Value::Array(values)) if !values.is_empty() => {
            let mut panes = Vec::with_capacity(values.len());
            for (index, value) in values.iter().enumerate() {
                if let Some(pane) = parse_pane(value, &format!("{}.panes.{index}", path), validator)
                {
                    panes.push(pane);
                }
            }
            Some(panes)
        }
        Some(Value::Array(_)) => {
            validator.issue(
                child_path(path, "panes"),
                "Array must contain at least 1 element(s)",
                "too_small",
            );
            None
        }
        Some(_) => {
            validator.issue(child_path(path, "panes"), "Expected array", "invalid_type");
            None
        }
        None => {
            validator.issue(child_path(path, "panes"), "Required", "invalid_type");
            None
        }
    };

    if let (Some(ratio), Some(panes)) = (&ratio, &panes)
        && ratio.len() != panes.len()
    {
        validator.issue(
            path,
            "Number of elements in ratio array does not match number of elements in panes array",
            "custom",
        );
    }

    Some(SplitPane {
        orientation: orientation?,
        ratio: ratio?,
        panes: panes?,
    })
}

fn parse_terminal(
    object: &Map<String, Value>,
    path: &str,
    validator: &mut Validator,
) -> Option<TerminalPane> {
    reject_unknown_fields(
        object,
        &[
            "name",
            "command",
            "cwd",
            "env",
            "delay",
            "title",
            "focus",
            "ephemeral",
            "closeOnError",
        ],
        path,
        validator,
    );

    let name = required_nonempty_string(object, "name", path, validator);
    let env = match object.get("env") {
        None => None,
        Some(Value::Object(values)) => {
            let mut env = IndexMap::new();
            for (key, value) in values {
                match value.as_str() {
                    Some(value) => {
                        env.insert(key.clone(), value.to_owned());
                    }
                    None => validator.issue(
                        format!("{}.env.{key}", path),
                        "Expected string",
                        "invalid_type",
                    ),
                }
            }
            Some(env)
        }
        Some(_) => {
            validator.issue(child_path(path, "env"), "Expected object", "invalid_type");
            None
        }
    };
    let delay = match object.get("delay") {
        None => None,
        Some(value) => match positive_integer(value) {
            Some(value) => Some(value),
            None => {
                validator.issue(
                    child_path(path, "delay"),
                    "Number must be a positive integer",
                    "too_small",
                );
                None
            }
        },
    };

    Some(TerminalPane {
        name: name?,
        command: optional_string(object, "command", path, validator),
        cwd: optional_string(object, "cwd", path, validator),
        env,
        delay,
        title: optional_string(object, "title", path, validator),
        focus: optional_bool(object, "focus", path, validator),
        ephemeral: optional_bool(object, "ephemeral", path, validator),
        close_on_error: optional_bool(object, "closeOnError", path, validator),
    })
}

fn positive_integer(value: &Value) -> Option<u64> {
    const U64_EXCLUSIVE_MAX_AS_F64: f64 = 18_446_744_073_709_551_616.0;

    value.as_u64().or_else(|| {
        let value = value.as_f64()?;
        (value.is_finite()
            && value > 0.0
            && value.fract() == 0.0
            && value < U64_EXCLUSIVE_MAX_AS_F64)
            .then_some(value as u64)
    })
}

fn parse_ratio(
    value: Option<&Value>,
    path: &str,
    validator: &mut Validator,
) -> Option<Vec<RatioValue>> {
    let values = match value {
        Some(Value::Array(values)) if !values.is_empty() => values,
        Some(Value::Array(_)) => {
            validator.issue(
                path,
                "Array must contain at least 1 element(s)",
                "too_small",
            );
            return None;
        }
        Some(_) => {
            validator.issue(path, "Expected array", "invalid_type");
            return None;
        }
        None => {
            validator.issue(path, "Required", "invalid_type");
            return None;
        }
    };

    let fixed_cells_pattern = fixed_cells_pattern();
    let mut ratio = Vec::with_capacity(values.len());
    let mut has_weight = false;
    for (index, value) in values.iter().enumerate() {
        if let Some(weight) = value.as_f64() {
            if weight.is_finite() && weight > 0.0 {
                has_weight = true;
                ratio.push(RatioValue::Weight(weight));
            } else {
                validator.issue(
                    format!("{path}.{index}"),
                    "ratio value must be a positive number or \"<positive-integer>c\"",
                    "custom",
                );
            }
        } else if let Some(fixed) = value.as_str() {
            if fixed_cells_pattern.is_match(fixed) {
                ratio.push(RatioValue::FixedCells(fixed.to_owned()));
            } else {
                validator.issue(
                    format!("{path}.{index}"),
                    "ratio value must be a positive number or \"<positive-integer>c\"",
                    "custom",
                );
            }
        } else {
            validator.issue(
                format!("{path}.{index}"),
                "ratio value must be a positive number or \"<positive-integer>c\"",
                "invalid_union",
            );
        }
    }
    if !has_weight {
        validator.issue(
            path,
            "ratio must include at least one numeric weight",
            "custom",
        );
    }
    Some(ratio)
}

fn fixed_cells_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[1-9][0-9]*c$").expect("valid fixed-cell regex"))
}

fn expect_object<'a>(
    value: &'a Value,
    path: &str,
    validator: &mut Validator,
) -> Option<&'a Map<String, Value>> {
    match value.as_object() {
        Some(object) => Some(object),
        None => {
            validator.issue(path, "Expected object", "invalid_type");
            None
        }
    }
}

fn reject_unknown_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
    path: &str,
    validator: &mut Validator,
) {
    for key in object.keys().filter(|key| !allowed.contains(&key.as_str())) {
        validator.issue(
            child_path(path, key),
            format!("Unrecognized key(s) in object: '{key}'"),
            "unrecognized_keys",
        );
    }
}

fn required_nonempty_string(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
    validator: &mut Validator,
) -> Option<String> {
    let full_path = child_path(path, key);
    match object.get(key) {
        Some(Value::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(Value::String(_)) => {
            validator.issue(
                full_path,
                "String must contain at least 1 character(s)",
                "too_small",
            );
            None
        }
        Some(_) => {
            validator.issue(full_path, "Expected string", "invalid_type");
            None
        }
        None => {
            validator.issue(full_path, "Required", "invalid_type");
            None
        }
    }
}

fn optional_string(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
    validator: &mut Validator,
) -> Option<String> {
    match object.get(key) {
        None => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(_) => {
            validator.issue(child_path(path, key), "Expected string", "invalid_type");
            None
        }
    }
}

fn optional_nonempty_string(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
    validator: &mut Validator,
) -> Option<String> {
    match object.get(key) {
        None => None,
        Some(Value::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(Value::String(_)) => {
            validator.issue(
                child_path(path, key),
                "String must contain at least 1 character(s)",
                "too_small",
            );
            None
        }
        Some(_) => {
            validator.issue(child_path(path, key), "Expected string", "invalid_type");
            None
        }
    }
}

fn optional_bool(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
    validator: &mut Validator,
) -> Option<bool> {
    match object.get(key) {
        None => None,
        Some(Value::Bool(value)) => Some(*value),
        Some(_) => {
            validator.issue(child_path(path, key), "Expected boolean", "invalid_type");
            None
        }
    }
}

fn required_enum<T>(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
    validator: &mut Validator,
    parser: fn(&str) -> Option<T>,
    error_message: &str,
) -> Option<T> {
    let full_path = child_path(path, key);
    match object.get(key).and_then(Value::as_str) {
        Some(value) => match parser(value) {
            Some(value) => Some(value),
            None => {
                validator.issue(full_path, error_message, "invalid_enum_value");
                None
            }
        },
        None => {
            validator.issue(full_path, "Required", "invalid_type");
            None
        }
    }
}

fn optional_enum<T>(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
    validator: &mut Validator,
    parser: fn(&str) -> Option<T>,
    error_message: &str,
) -> Option<T> {
    match object.get(key) {
        None => None,
        Some(Value::String(value)) => match parser(value) {
            Some(value) => Some(value),
            None => {
                validator.issue(child_path(path, key), error_message, "invalid_enum_value");
                None
            }
        },
        Some(_) => {
            validator.issue(child_path(path, key), "Expected string", "invalid_type");
            None
        }
    }
}

fn child_path(path: &str, child: &str) -> String {
    if path.is_empty() {
        child.to_owned()
    } else {
        format!("{path}.{child}")
    }
}

fn parse_window_mode(value: &str) -> Option<WindowMode> {
    match value {
        "new-window" => Some(WindowMode::NewWindow),
        "current-window" => Some(WindowMode::CurrentWindow),
        _ => None,
    }
}

fn parse_backend(value: &str) -> Option<TerminalBackendKind> {
    match value {
        "tmux" => Some(TerminalBackendKind::Tmux),
        "wezterm" => Some(TerminalBackendKind::Wezterm),
        "herdr" => Some(TerminalBackendKind::Herdr),
        _ => None,
    }
}

fn parse_orientation(value: &str) -> Option<Orientation> {
    match value {
        "horizontal" => Some(Orientation::Horizontal),
        "vertical" => Some(Orientation::Vertical),
        _ => None,
    }
}

fn parse_select_ui(value: &str) -> Option<SelectUiMode> {
    match value {
        "auto" => Some(SelectUiMode::Auto),
        "fzf" => Some(SelectUiMode::Fzf),
        _ => None,
    }
}

fn parse_select_surface(value: &str) -> Option<SelectSurfaceMode> {
    match value {
        "auto" => Some(SelectSurfaceMode::Auto),
        "inline" => Some(SelectSurfaceMode::Inline),
        "tmux-popup" => Some(SelectSurfaceMode::TmuxPopup),
        _ => None,
    }
}

pub type WarningHandler = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigEnvironment {
    pub home_dir: PathBuf,
    pub xdg_config_home: Option<PathBuf>,
    pub vde_config_path: Option<PathBuf>,
}

impl ConfigEnvironment {
    pub fn from_process() -> Self {
        let home_dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            home_dir,
            xdg_config_home: std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from),
            vde_config_path: std::env::var_os("VDE_CONFIG_PATH").map(PathBuf::from),
        }
    }
}

#[derive(Clone, Default)]
pub struct ConfigLoaderOptions {
    pub config_paths: Option<Vec<PathBuf>>,
    pub current_dir: Option<PathBuf>,
    pub environment: Option<ConfigEnvironment>,
    pub on_warning: Option<WarningHandler>,
}

#[derive(Clone)]
pub struct ConfigLoader {
    options: ConfigLoaderOptions,
    environment: ConfigEnvironment,
    current_dir: PathBuf,
    warning_handler: WarningHandler,
}

impl ConfigLoader {
    pub fn new(options: ConfigLoaderOptions) -> Self {
        let environment = options
            .environment
            .clone()
            .unwrap_or_else(ConfigEnvironment::from_process);
        let current_dir = options
            .current_dir
            .clone()
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."));
        let warning_handler = options
            .on_warning
            .clone()
            .unwrap_or_else(|| Arc::new(|message| eprintln!("{message}")));
        Self {
            options,
            environment,
            current_dir,
            warning_handler,
        }
    }

    pub fn get_search_paths(&self) -> Vec<PathBuf> {
        if let Some(paths) = self.explicit_paths() {
            return paths;
        }

        let mut candidates = Vec::new();
        if let Some(project) = self.find_project_config_candidate() {
            candidates.push(project);
        }
        candidates.extend(flatten_groups(&self.default_search_path_groups()));
        dedupe_paths(candidates)
    }

    pub fn find_config_file(&self) -> Option<PathBuf> {
        self.get_search_paths()
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    pub fn load_config(&self) -> Result<Config, VdeError> {
        if let Some(paths) = self.explicit_paths() {
            let file_path = find_first_existing(&paths).ok_or_else(|| not_found_error(&paths))?;
            return self.read_and_validate(&file_path);
        }

        let search_paths = self.get_search_paths();
        let global_paths = resolve_first_existing_paths(&self.default_search_path_groups());
        let project_path = self
            .find_project_config_candidate()
            .filter(|path| path.exists());
        if global_paths.is_empty() && project_path.is_none() {
            return Err(not_found_error(&search_paths));
        }

        let mut merged = Config {
            defaults: None,
            presets: IndexMap::new(),
        };
        for path in global_paths {
            merged = merge_configs(
                merged,
                self.read_and_validate(&path)?,
                &self.warning_handler,
            );
        }
        if let Some(path) = project_path {
            merged = merge_configs(
                merged,
                self.read_and_validate(&path)?,
                &self.warning_handler,
            );
        }
        Ok(merged)
    }

    pub fn load_yaml(&self) -> Result<String, VdeError> {
        let config = self.load_config()?;
        serde_saphyr::to_string(&config).map_err(|error| {
            VdeError::config(
                ErrorCode::ConfigParseError,
                "Failed to serialize configuration",
                object_details(json!({ "error": error.to_string() })),
            )
        })
    }

    fn explicit_paths(&self) -> Option<Vec<PathBuf>> {
        self.options
            .config_paths
            .as_ref()
            .filter(|paths| !paths.is_empty())
            .cloned()
    }

    fn default_search_path_groups(&self) -> Vec<Vec<PathBuf>> {
        let mut groups = Vec::new();
        if let Some(base) = &self.environment.vde_config_path {
            groups.push(vec![base.join("layout.yml")]);
        }
        let xdg = self
            .environment
            .xdg_config_home
            .clone()
            .unwrap_or_else(|| self.environment.home_dir.join(".config"));
        groups.push(dedupe_paths(vec![
            xdg.join("vde/layout/config.yml"),
            xdg.join("vde/layout.yml"),
        ]));
        groups
    }

    fn find_project_config_candidate(&self) -> Option<PathBuf> {
        let mut current = self.current_dir.as_path();
        loop {
            let nested = current.join(".vde/layout/config.yml");
            if nested.exists() {
                return Some(nested);
            }
            let legacy = current.join(".vde/layout.yml");
            if legacy.exists() {
                return Some(legacy);
            }
            current = current.parent()?;
        }
    }

    fn read_and_validate(&self, path: &Path) -> Result<Config, VdeError> {
        let content = fs::read_to_string(path).map_err(|error| {
            VdeError::config(
                ErrorCode::ConfigPermissionError,
                "Failed to read configuration file",
                object_details(json!({
                    "filePath": path,
                    "error": error.to_string(),
                })),
            )
        })?;
        validate_yaml(&content)
    }
}

impl Default for ConfigLoader {
    fn default() -> Self {
        Self::new(ConfigLoaderOptions::default())
    }
}

pub fn merge_configs(base: Config, override_config: Config, warn: &WarningHandler) -> Config {
    let mut presets = base.presets;
    for (key, override_preset) in override_config.presets {
        if let Some(base_preset) = presets.get(&key)
            && let (Some(base_mode), Some(override_mode)) =
                (base_preset.window_mode, override_preset.window_mode)
            && base_mode != override_mode
        {
            warn(&format!(
                "[vde-layout] Preset \"{key}\" windowMode conflict: \"{base_mode}\" overridden by \"{override_mode}\""
            ));
        }
        presets.insert(key, override_preset);
    }

    let defaults = merge_defaults(base.defaults, override_config.defaults, warn);
    Config { defaults, presets }
}

fn merge_defaults(
    base: Option<ConfigDefaults>,
    override_defaults: Option<ConfigDefaults>,
    warn: &WarningHandler,
) -> Option<ConfigDefaults> {
    if base.is_none() && override_defaults.is_none() {
        return None;
    }
    let base = base.unwrap_or_default();
    let override_defaults = override_defaults.unwrap_or_default();
    if let (Some(base_mode), Some(override_mode)) =
        (base.window_mode, override_defaults.window_mode)
        && base_mode != override_mode
    {
        warn(&format!(
            "[vde-layout] defaults.windowMode conflict: \"{base_mode}\" overridden by \"{override_mode}\""
        ));
    }

    Some(ConfigDefaults {
        window_mode: override_defaults.window_mode.or(base.window_mode),
        selector: merge_selector_defaults(base.selector, override_defaults.selector, warn),
    })
}

fn merge_selector_defaults(
    base: Option<SelectorDefaults>,
    override_selector: Option<SelectorDefaults>,
    warn: &WarningHandler,
) -> Option<SelectorDefaults> {
    if base.is_none() && override_selector.is_none() {
        return None;
    }
    let base = base.unwrap_or_default();
    let override_selector = override_selector.unwrap_or_default();
    warn_selector_conflict("ui", base.ui, override_selector.ui, warn);
    warn_selector_conflict("surface", base.surface, override_selector.surface, warn);
    if let (Some(base_value), Some(override_value)) =
        (&base.tmux_popup_opts, &override_selector.tmux_popup_opts)
        && base_value != override_value
    {
        warn(&format!(
            "[vde-layout] defaults.selector.tmuxPopupOpts conflict: \"{base_value}\" overridden by \"{override_value}\""
        ));
    }

    let fzf = match (base.fzf, override_selector.fzf) {
        (None, None) => None,
        (base_fzf, override_fzf) => {
            let base_args = base_fzf
                .as_ref()
                .and_then(|value| value.extra_args.as_ref());
            let override_args = override_fzf
                .as_ref()
                .and_then(|value| value.extra_args.as_ref());
            if let (Some(base_args), Some(override_args)) = (base_args, override_args)
                && base_args != override_args
            {
                warn(
                    "[vde-layout] defaults.selector.fzf.extraArgs conflict: global value overridden by project value",
                );
            }
            Some(SelectorFzfDefaults {
                extra_args: override_fzf
                    .and_then(|value| value.extra_args)
                    .or_else(|| base_fzf.and_then(|value| value.extra_args)),
            })
        }
    };

    Some(SelectorDefaults {
        ui: override_selector.ui.or(base.ui),
        surface: override_selector.surface.or(base.surface),
        tmux_popup_opts: override_selector.tmux_popup_opts.or(base.tmux_popup_opts),
        fzf,
    })
}

fn warn_selector_conflict<T: Copy + PartialEq + std::fmt::Debug>(
    key: &str,
    base: Option<T>,
    override_value: Option<T>,
    warn: &WarningHandler,
) {
    if let (Some(base), Some(override_value)) = (base, override_value)
        && base != override_value
    {
        warn(&format!(
            "[vde-layout] defaults.selector.{key} conflict: \"{}\" overridden by \"{}\"",
            enum_debug_name(base),
            enum_debug_name(override_value),
        ));
    }
}

fn enum_debug_name<T: std::fmt::Debug>(value: T) -> String {
    let debug = format!("{value:?}");
    let mut output = String::new();
    for (index, character) in debug.chars().enumerate() {
        if character.is_uppercase() && index > 0 {
            output.push('-');
        }
        output.extend(character.to_lowercase());
    }
    output
}

fn not_found_error(paths: &[PathBuf]) -> VdeError {
    VdeError::config(
        ErrorCode::ConfigNotFound,
        "Configuration file not found",
        object_details(json!({ "searchPaths": paths })),
    )
}

fn find_first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.exists()).cloned()
}

fn resolve_first_existing_paths(groups: &[Vec<PathBuf>]) -> Vec<PathBuf> {
    dedupe_paths(
        groups
            .iter()
            .filter_map(|group| find_first_existing(group))
            .collect(),
    )
}

fn flatten_groups(groups: &[Vec<PathBuf>]) -> Vec<PathBuf> {
    groups.iter().flatten().cloned().collect()
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}
