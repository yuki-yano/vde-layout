use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use indexmap::IndexMap;
use unicode_width::UnicodeWidthStr;
use wait_timeout::ChildExt;

use crate::error::{ErrorCode, ErrorKind, VdeError, object_details};
use crate::model::{Config, Preset, SelectSurfaceMode, SelectUiMode};
use crate::preset::PresetManager;

use super::logger::CliLogger;

const FZF_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_PREVIEW_BASE64_LENGTH: usize = 64 * 1024;
const RESERVED_FZF_ARGS: [&str; 6] = [
    "delimiter",
    "with-nth",
    "ansi",
    "preview",
    "preview-window",
    "tmux",
];

#[derive(Debug)]
pub enum SelectorError {
    Message(String),
    Vde(VdeError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectPresetResult {
    Selected(String),
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct SelectorOptions {
    pub ui_mode: SelectUiMode,
    pub surface_mode: SelectSurfaceMode,
    pub tmux_popup_options: Option<String>,
    pub fzf_extra_args: Vec<String>,
    pub cwd: PathBuf,
    pub current_exe: PathBuf,
    pub in_tmux: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetSelectorRow {
    pub key: String,
    pub display: String,
    pub preview_base64: String,
}

pub fn build_preset_preview_yaml(key: &str, preset: &Preset) -> Result<String, SelectorError> {
    let mut presets = IndexMap::new();
    presets.insert(key.to_owned(), preset.clone());
    serde_saphyr::to_string(&Config {
        defaults: None,
        presets,
    })
    .map_err(|error| SelectorError::Message(format!("Failed to serialize preset preview: {error}")))
}

pub fn build_fzf_args(options: &SelectorOptions) -> Result<Vec<String>, SelectorError> {
    validate_extra_fzf_args(&options.fzf_extra_args)?;
    let surface = match options.surface_mode {
        SelectSurfaceMode::Auto if options.in_tmux => SelectSurfaceMode::TmuxPopup,
        SelectSurfaceMode::Auto => SelectSurfaceMode::Inline,
        surface => surface,
    };
    if surface == SelectSurfaceMode::TmuxPopup && !options.in_tmux {
        return Err(SelectorError::Message(
            "tmux popup selector surface requires running inside tmux".to_owned(),
        ));
    }
    let executable = options.current_exe.to_string_lossy();
    let quoted = shlex::try_quote(&executable).map_err(|error| {
        SelectorError::Message(format!("Failed to quote preview executable: {error}"))
    })?;
    let mut args = vec![
        "--delimiter=\\t".to_owned(),
        "--ansi".to_owned(),
        "--with-nth=2".to_owned(),
        "--prompt=preset> ".to_owned(),
        "--layout=reverse".to_owned(),
        "--height=80%".to_owned(),
        "--border".to_owned(),
        format!("--preview={quoted} __preview {{3}}"),
        "--preview-window=right,60%,border-left,wrap".to_owned(),
    ];
    if surface == SelectSurfaceMode::TmuxPopup {
        args.push(match options.tmux_popup_options.as_deref() {
            Some(value) => format!("--tmux={value}"),
            None => "--tmux".to_owned(),
        });
    }
    args.extend(options.fzf_extra_args.clone());
    Ok(args)
}

pub fn build_selector_rows(
    preset_manager: &PresetManager,
) -> Result<Vec<PresetSelectorRow>, SelectorError> {
    let infos = preset_manager.list_presets();
    let mut values = Vec::with_capacity(infos.len());
    for info in infos {
        let preset = preset_manager
            .get_preset(&info.key)
            .map_err(SelectorError::Vde)?;
        let preview = build_preset_preview_yaml(&info.key, preset)?;
        let encoded = STANDARD.encode(preview.as_bytes());
        if encoded.len() > MAX_PREVIEW_BASE64_LENGTH {
            return Err(SelectorError::Message(format!(
                "Preset preview is too large for fzf inline preview payload: \"{}\" ({} bytes)",
                info.key,
                encoded.len()
            )));
        }
        values.push((
            sanitize(&info.key),
            sanitize(&info.name),
            sanitize(info.description.as_deref().unwrap_or_default()),
            encoded,
        ));
    }
    let key_width = values
        .iter()
        .map(|(key, _, _, _)| UnicodeWidthStr::width(key.as_str()))
        .max()
        .unwrap_or(0);
    let name_width = values
        .iter()
        .map(|(_, name, _, _)| UnicodeWidthStr::width(name.as_str()))
        .max()
        .unwrap_or(0);
    Ok(values
        .into_iter()
        .map(|(key, name, description, preview_base64)| {
            let key_padding = " ".repeat(key_width.saturating_sub(UnicodeWidthStr::width(key.as_str())));
            let name_padding = " ".repeat(name_width.saturating_sub(UnicodeWidthStr::width(name.as_str())));
            let description = if description.is_empty() {
                "\x1b[90m(no description)\x1b[0m".to_owned()
            } else {
                format!("\x1b[2m{description}\x1b[0m")
            };
            let display = format!(
                "\x1b[36m{key}{key_padding}\x1b[0m  \x1b[1m{name}{name_padding}\x1b[0m  {description}"
            );
            PresetSelectorRow {
                key,
                display,
                preview_base64,
            }
        })
        .collect())
}

pub fn select_preset(
    preset_manager: &PresetManager,
    options: &SelectorOptions,
    logger: &CliLogger,
) -> Result<SelectPresetResult, SelectorError> {
    if !(std::io::stdin().is_terminal()
        && std::io::stdout().is_terminal()
        && std::io::stderr().is_terminal())
    {
        return Err(SelectorError::Message(
            "Preset selection requires an interactive terminal".to_owned(),
        ));
    }
    let fzf = Path::new("fzf");
    ensure_fzf_available(fzf)?;
    let rows = build_selector_rows(preset_manager)?;
    if rows.is_empty() {
        return Err(SelectorError::Message("No presets defined".to_owned()));
    }
    let args = build_fzf_args(options)?;
    logger.debug(format!("Preset selection UI: {:?}", options.ui_mode).to_lowercase());
    run_fzf_selector(&rows, options, &args, fzf)
}

fn run_fzf_selector(
    rows: &[PresetSelectorRow],
    options: &SelectorOptions,
    args: &[String],
    executable: &Path,
) -> Result<SelectPresetResult, SelectorError> {
    let input = rows
        .iter()
        .enumerate()
        .map(|(index, row)| format!("{index}\t{}\t{}", row.display, row.preview_base64))
        .collect::<Vec<_>>()
        .join("\n");
    let mut child = Command::new(executable)
        .args(args)
        .current_dir(&options.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| SelectorError::Message(format!("Failed to run fzf: {error}")))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).map_err(|error| {
            SelectorError::Message(format!("Failed to write fzf input: {error}"))
        })?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| SelectorError::Message(format!("Failed to wait for fzf: {error}")))?;
    if output.status.code() == Some(130) {
        return Ok(SelectPresetResult::Cancelled);
    }
    if !output.status.success() {
        return Err(SelectorError::Message(format!(
            "fzf exited with status {}",
            output.status
        )));
    }
    let selected = String::from_utf8_lossy(&output.stdout);
    let trimmed = selected.trim();
    if trimmed.is_empty() {
        return Ok(SelectPresetResult::Cancelled);
    }
    let id = trimmed
        .split('\t')
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|id| *id < rows.len())
        .ok_or_else(|| SelectorError::Message("Invalid selection returned from fzf".to_owned()))?;
    Ok(SelectPresetResult::Selected(rows[id].key.clone()))
}

pub fn decode_preview_payload(payload: &str) -> Result<Vec<u8>, SelectorError> {
    STANDARD
        .decode(payload)
        .map_err(|error| SelectorError::Message(format!("Invalid preview payload: {error}")))
}

fn validate_extra_fzf_args(args: &[String]) -> Result<(), SelectorError> {
    for argument in args {
        if argument.is_empty() {
            return Err(SelectorError::Message(
                "Empty value is not allowed for --fzf-arg".to_owned(),
            ));
        }
        let Some(value) = argument.strip_prefix("--") else {
            continue;
        };
        let name = value.split('=').next().unwrap_or_default();
        if RESERVED_FZF_ARGS.contains(&name) {
            return Err(SelectorError::Message(format!(
                "--fzf-arg cannot override reserved fzf option: --{name}"
            )));
        }
    }
    Ok(())
}

fn ensure_fzf_available(executable: &Path) -> Result<(), SelectorError> {
    let mut child = match Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(SelectorError::Vde(VdeError::new(
                ErrorKind::Environment,
                ErrorCode::BackendNotFound,
                "fzf is required for preset selection UI",
                object_details(serde_json::json!({ "backend": "fzf", "binary": "fzf" })),
            )));
        }
        Err(error) => return Err(SelectorError::Message(error.to_string())),
    };
    match child.wait_timeout(FZF_CHECK_TIMEOUT) {
        Ok(Some(status)) if status.success() => Ok(()),
        Ok(Some(_)) => Err(fzf_not_found_error()),
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(fzf_not_found_error())
        }
        Err(error) => Err(SelectorError::Message(error.to_string())),
    }
}

fn fzf_not_found_error() -> SelectorError {
    SelectorError::Vde(VdeError::new(
        ErrorKind::Environment,
        ErrorCode::BackendNotFound,
        "fzf is required for preset selection UI",
        object_details(serde_json::json!({ "backend": "fzf", "binary": "fzf" })),
    ))
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\t' | '\r' | '\n' => ' ',
            character => character,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn fake_fzf_process_selects_a_preset_row() {
        let directory = TempDir::new().unwrap();
        let executable = directory.path().join("fzf");
        fs::write(
            &executable,
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '0.60.0\n'
  exit 0
fi
IFS= read -r line
printf '%s\n' "$line"
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();

        ensure_fzf_available(&executable).unwrap();
        let rows = vec![
            PresetSelectorRow {
                key: "dev".to_owned(),
                display: "Development".to_owned(),
                preview_base64: "ZGV2".to_owned(),
            },
            PresetSelectorRow {
                key: "logs".to_owned(),
                display: "Logs".to_owned(),
                preview_base64: "bG9ncw==".to_owned(),
            },
        ];
        let options = SelectorOptions {
            ui_mode: SelectUiMode::Fzf,
            surface_mode: SelectSurfaceMode::Inline,
            tmux_popup_options: None,
            fzf_extra_args: Vec::new(),
            cwd: directory.path().to_owned(),
            current_exe: PathBuf::from("/bin/true"),
            in_tmux: false,
        };
        let args = build_fzf_args(&options).unwrap();
        let selected = run_fzf_selector(&rows, &options, &args, &executable).unwrap();
        assert_eq!(selected, SelectPresetResult::Selected("dev".to_owned()));
    }
}
