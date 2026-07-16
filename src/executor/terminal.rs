use std::sync::OnceLock;

use regex::Regex;
use serde_json::json;

use crate::core::{CoreError, CoreErrorKind, EmittedTerminal};

use super::template::{build_name_to_real_id_map, replace_template_tokens};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedEnvCommand {
    pub key: String,
    pub command: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedCommand {
    pub text: String,
    pub delay_ms: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedTerminalCommand {
    pub terminal: EmittedTerminal,
    pub real_pane_id: String,
    pub cwd_command: Option<String>,
    pub env_commands: Vec<PreparedEnvCommand>,
    pub title: Option<String>,
    pub command: Option<PreparedCommand>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedTerminalCommands {
    pub focus_pane_real_id: String,
    pub commands: Vec<PreparedTerminalCommand>,
}

pub fn prepare_terminal_commands(
    terminals: &[EmittedTerminal],
    focus_pane_virtual_id: &str,
    pane_map: &indexmap::IndexMap<String, String>,
) -> Result<PreparedTerminalCommands, CoreError> {
    let focus_pane_real_id = resolve_pane(pane_map, focus_pane_virtual_id, focus_pane_virtual_id)?;
    let names = build_name_to_real_id_map(terminals, pane_map);
    let mut commands = Vec::with_capacity(terminals.len());
    for terminal in terminals {
        let real_pane_id = resolve_pane(
            pane_map,
            &terminal.virtual_pane_id,
            &terminal.virtual_pane_id,
        )?;
        let cwd_command = terminal
            .cwd
            .as_deref()
            .filter(|cwd| !cwd.is_empty())
            .map(|cwd| format!("cd -- {}", shell_quote_literal(cwd)));
        let mut env_commands = Vec::new();
        if let Some(env) = terminal.env.as_ref() {
            for (key, value) in env {
                if !env_key_pattern().is_match(key) {
                    return Err(CoreError::new(
                        CoreErrorKind::Execution,
                        "INVALID_PANE",
                        format!("Invalid environment variable name: {key}"),
                    )
                    .with_path(&terminal.virtual_pane_id));
                }
                env_commands.push(PreparedEnvCommand {
                    key: key.clone(),
                    command: format!("export {key}={}", shell_quote_literal(value)),
                });
            }
        }
        let title = terminal.title.clone().filter(|title| !title.is_empty());
        let command = terminal
            .command
            .as_deref()
            .filter(|command| !command.is_empty())
            .map(|command| {
                replace_template_tokens(
                    command,
                    &real_pane_id,
                    if command.contains("{{focus_pane}}") {
                        &focus_pane_real_id
                    } else {
                        ""
                    },
                    &names,
                    None,
                )
                .map(|replaced| PreparedCommand {
                    text: apply_ephemeral_suffix(replaced, terminal),
                    delay_ms: terminal
                        .delay
                        .filter(|delay| delay.is_finite() && *delay > 0.0)
                        .unwrap_or(0.0),
                })
                .map_err(|error| {
                    CoreError::new(
                        CoreErrorKind::Execution,
                        "TEMPLATE_TOKEN_ERROR",
                        format!(
                            "Template token resolution failed for pane {}: {}",
                            terminal.virtual_pane_id, error.message
                        ),
                    )
                    .with_path(&terminal.virtual_pane_id)
                    .with_details(
                        json!({
                            "command": terminal.command,
                            "tokenType": error.token_type,
                            "availablePanes": error.available_panes,
                        })
                        .as_object()
                        .cloned()
                        .unwrap_or_default(),
                    )
                })
            })
            .transpose()?;
        commands.push(PreparedTerminalCommand {
            terminal: terminal.clone(),
            real_pane_id,
            cwd_command,
            env_commands,
            title,
            command,
        });
    }
    Ok(PreparedTerminalCommands {
        focus_pane_real_id,
        commands,
    })
}

pub fn shell_quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn apply_ephemeral_suffix(command: String, terminal: &EmittedTerminal) -> String {
    if terminal.ephemeral != Some(true) {
        return command;
    }
    if terminal.close_on_error == Some(true) {
        format!("{command}; exit")
    } else {
        format!("{command}; [ $? -eq 0 ] && exit")
    }
}

fn resolve_pane(
    pane_map: &indexmap::IndexMap<String, String>,
    virtual_id: &str,
    path: &str,
) -> Result<String, CoreError> {
    pane_map
        .get(virtual_id)
        .filter(|id| !id.is_empty())
        .cloned()
        .ok_or_else(|| {
            CoreError::new(
                CoreErrorKind::Execution,
                "INVALID_PANE",
                format!("Unknown terminal pane: {virtual_id}"),
            )
            .with_path(path)
        })
}

fn env_key_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$").expect("environment key regex must compile")
    })
}
