use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;
use thiserror::Error;

use crate::core::EmittedTerminal;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{message}")]
pub struct TemplateTokenError {
    pub message: String,
    pub token_type: String,
    pub available_panes: Option<Vec<String>>,
}

pub fn replace_template_tokens(
    command: &str,
    current_pane_real_id: &str,
    focus_pane_real_id: &str,
    name_to_real_id: &IndexMap<String, String>,
    window_id: Option<&str>,
) -> Result<String, TemplateTokenError> {
    let regex = token_pattern();
    let mut result = String::with_capacity(command.len());
    let mut offset = 0;
    for captures in regex.captures_iter(command) {
        let matched = captures
            .get(0)
            .expect("token pattern always has a full match");
        result.push_str(&command[offset..matched.start()]);
        let token = captures
            .get(1)
            .map(|value| value.as_str())
            .unwrap_or_default();
        match token {
            "this_pane" => result.push_str(current_pane_real_id),
            "focus_pane" => result.push_str(focus_pane_real_id),
            "window_id" => result.push_str(window_id.ok_or_else(|| TemplateTokenError {
                message: "Window ID is not available. {{window_id}} can only be resolved in hooks.afterApply."
                    .to_owned(),
                token_type: "window_id".to_owned(),
                available_panes: None,
            })?),
            token if token.starts_with("pane_id:") => {
                let name = captures
                    .get(2)
                    .map(|value| value.as_str().trim())
                    .unwrap_or_default();
                let pane_id = name_to_real_id.get(name).ok_or_else(|| {
                    let available = name_to_real_id.keys().cloned().collect::<Vec<_>>();
                    TemplateTokenError {
                        message: format!(
                            "Pane name \"{name}\" not found. Available panes: {}",
                            available.join(", ")
                        ),
                        token_type: "pane_id".to_owned(),
                        available_panes: Some(available),
                    }
                })?;
                result.push_str(pane_id);
            }
            _ => result.push_str(matched.as_str()),
        }
        offset = matched.end();
    }
    result.push_str(&command[offset..]);
    Ok(result)
}

pub fn build_name_to_real_id_map(
    terminals: &[EmittedTerminal],
    pane_map: &IndexMap<String, String>,
) -> IndexMap<String, String> {
    let mut names = IndexMap::new();
    for terminal in terminals {
        if let Some(real_id) = pane_map.get(&terminal.virtual_pane_id) {
            names.insert(terminal.name.clone(), real_id.clone());
        }
    }
    names
}

fn token_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"\{\{(this_pane|focus_pane|window_id|pane_id:([^}]+))\}\}")
            .expect("template token regex must compile")
    })
}
