use std::sync::OnceLock;

use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::core::{
    CommandStep, CommandStepKind, CoreError, CoreErrorKind, EmittedTerminal, PlanEmission,
    SplitSizing,
};
use crate::model::{Orientation, WindowMode};

use super::command::CommandExecutor;
use super::split::{
    ResolvedSplitSize, SplitSizeResolutionContext, resolve_split_orientation, resolve_split_size,
};
use super::template::build_name_to_real_id_map;
use super::terminal::{
    prepare_terminal_commands, resolve_pane_mapping, shell_quote_literal, wait_for_terminal_delay,
};

pub const HERDR_MINIMUM_VERSION: &str = "0.7.4";
const MIN_HERDR_RATIO: f64 = 0.1;
const MAX_HERDR_RATIO: f64 = 0.9;

pub type ConfirmHerdrKillCallback<'a> = dyn FnMut(&[String], bool) -> bool + 'a;
pub type HerdrWarningCallback<'a> = dyn FnMut(&str) + 'a;

pub struct ExecuteHerdrPlanOptions<'a> {
    pub window_mode: WindowMode,
    pub cwd: Option<&'a str>,
    pub pane_id: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
    pub window_name: Option<&'a str>,
    pub on_confirm_kill: Option<&'a mut ConfirmHerdrKillCallback<'a>>,
    pub on_warning: Option<&'a mut HerdrWarningCallback<'a>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyHerdrPlanResult {
    pub executed_steps: usize,
    pub pane_map: IndexMap<String, String>,
    pub focus_pane_id: Option<String>,
    pub pane_name_to_real_id: IndexMap<String, String>,
    pub window_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HerdrDryRunStep {
    pub summary: String,
    pub command: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct HerdrPaneInfo {
    pub pane_id: String,
    pub workspace_id: String,
    pub tab_id: String,
    pub focused: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct HerdrLayoutPane {
    pane_id: String,
    rect: HerdrRect,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct HerdrRect {
    width: u64,
    height: u64,
}

pub fn verify_herdr_environment(
    executor: &mut dyn CommandExecutor,
    dry_run: bool,
) -> Result<Option<String>, CoreError> {
    if dry_run {
        return Ok(None);
    }
    let raw = executor
        .execute(&strings(&["--version"]))
        .map_err(|error| {
            if error.details.get("ioErrorKind").and_then(Value::as_str) == Some("NotFound") {
                return execution_error(
                    "BACKEND_NOT_FOUND",
                    "herdr is not installed",
                    None,
                    json!({ "backend": "herdr", "binary": "herdr" }),
                );
            }
            let mut details = (*error.details).clone();
            details.insert("backend".to_owned(), json!("herdr"));
            details.insert("binary".to_owned(), json!("herdr"));
            CoreError::new(
                CoreErrorKind::Execution,
                "HERDR_NOT_FOUND",
                "Failed to execute herdr --version",
            )
            .with_details(details)
        })?;
    let detected = extract_version(&raw).ok_or_else(|| {
        execution_error(
            "UNSUPPORTED_HERDR_VERSION",
            "Unable to determine herdr version",
            None,
            json!({
                "requiredVersion": HERDR_MINIMUM_VERSION,
                "detectedVersion": raw.trim(),
            }),
        )
    })?;
    if !is_version_supported(&detected, HERDR_MINIMUM_VERSION) {
        return Err(execution_error(
            "UNSUPPORTED_HERDR_VERSION",
            "Unsupported herdr version",
            None,
            json!({
                "requiredVersion": HERDR_MINIMUM_VERSION,
                "detectedVersion": detected,
            }),
        ));
    }
    Ok(Some(detected))
}

pub fn run_herdr_cli(
    executor: &mut dyn CommandExecutor,
    args: &[String],
    message: &str,
    path: Option<&str>,
    extra_details: Option<Map<String, Value>>,
) -> Result<String, CoreError> {
    executor.execute(args).map_err(|error| {
        let mut details = (*error.details).clone();
        details.insert("backend".to_owned(), json!("herdr"));
        details.insert(
            "command".to_owned(),
            json!(
                std::iter::once("herdr")
                    .chain(args.iter().map(String::as_str))
                    .collect::<Vec<_>>()
            ),
        );
        if let Some(extra) = extra_details {
            details.extend(extra);
        }
        let mut wrapped =
            CoreError::new(CoreErrorKind::Execution, "TERMINAL_COMMAND_FAILED", message)
                .with_details(details);
        if let Some(path) = path {
            wrapped.path = Some(path.to_owned());
        }
        wrapped
    })
}

pub fn execute_herdr_plan(
    emission: &PlanEmission,
    executor: &mut dyn CommandExecutor,
    mut options: ExecuteHerdrPlanOptions<'_>,
) -> Result<ApplyHerdrPlanResult, CoreError> {
    let initial_virtual = emission.summary.initial_pane_id.trim();
    if initial_virtual.is_empty() {
        return Err(execution_error(
            "INVALID_PLAN",
            "Plan emission is missing initial pane metadata",
            Some("plan.initialPaneId"),
            json!({}),
        ));
    }
    let initial_cwd = emission
        .terminals
        .iter()
        .find(|terminal| terminal.virtual_pane_id == initial_virtual)
        .and_then(|terminal| terminal.cwd.as_deref())
        .filter(|cwd| !cwd.is_empty())
        .or(options.cwd)
        .unwrap_or(".");

    let (initial_real, tab_id) = resolve_initial_pane(
        executor,
        options.window_mode,
        initial_cwd,
        options.window_name,
        options.pane_id,
        options.workspace_id,
        options.on_confirm_kill.take(),
    )?;
    let mut pane_map = IndexMap::new();
    register_pane_with_ancestors(&mut pane_map, initial_virtual, &initial_real);

    let mut executed_steps = 0;
    for step in &emission.steps {
        match step.kind {
            CommandStepKind::Split => apply_split_step(
                step,
                emission,
                executor,
                &mut pane_map,
                &mut options.on_warning,
            )?,
            CommandStepKind::Focus => {
                let target = required_target(step)?;
                resolve_real_pane_id(&mut pane_map, target, &step.id)?;
            }
        }
        executed_steps += 1;
    }
    apply_terminal_commands(
        &emission.terminals,
        executor,
        &mut pane_map,
        &emission.summary.focus_pane_id,
    )?;

    let focus_pane_id = resolve_pane_mapping(&mut pane_map, &emission.summary.focus_pane_id);
    let pane_name_to_real_id = build_name_to_real_id_map(&emission.terminals, &pane_map);
    Ok(ApplyHerdrPlanResult {
        executed_steps,
        pane_map,
        focus_pane_id,
        pane_name_to_real_id,
        window_id: tab_id,
    })
}

pub fn build_herdr_dry_run_steps(
    emission: &PlanEmission,
) -> Result<Vec<HerdrDryRunStep>, CoreError> {
    let mut steps = Vec::new();
    for step in &emission.steps {
        let target = required_target(step)?;
        match step.kind {
            CommandStepKind::Split => {
                let orientation = resolve_split_orientation(step)?;
                let ratio = dry_run_ratio(step)?;
                let focus = if created_pane_contains_focus(
                    step.created_pane_id.as_deref(),
                    &emission.summary.focus_pane_id,
                ) {
                    "--focus"
                } else {
                    "--no-focus"
                };
                let direction = match orientation {
                    Orientation::Horizontal => "right",
                    Orientation::Vertical => "down",
                };
                steps.push(HerdrDryRunStep {
                    summary: if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. }))
                    {
                        format!("{} [dynamic-cells]", step.summary)
                    } else {
                        step.summary.clone()
                    },
                    command: format!(
                        "herdr pane split {target} --direction {direction} --ratio {} {focus}",
                        ratio.value
                    ),
                    warning: ratio.warning,
                });
            }
            CommandStepKind::Focus => steps.push(HerdrDryRunStep {
                summary: step.summary.clone(),
                command: format!("# herdr focus for {target} is selected during pane creation"),
                warning: None,
            }),
        }
    }

    let virtual_map = emission
        .terminals
        .iter()
        .map(|terminal| {
            (
                terminal.virtual_pane_id.clone(),
                terminal.virtual_pane_id.clone(),
            )
        })
        .collect::<IndexMap<_, _>>();
    let prepared = prepare_terminal_commands(
        &emission.terminals,
        &emission.summary.focus_pane_id,
        &virtual_map,
    )?;
    for set in prepared.commands {
        let pane = &set.terminal.virtual_pane_id;
        if let Some(title) = set.title.as_deref() {
            steps.push(preview(
                format!("set title for {pane}"),
                &["pane", "rename", pane, title],
            ));
        }
        if let Some(cwd) = set.cwd_command.as_deref() {
            steps.push(preview(
                format!("set cwd for {pane}"),
                &["pane", "run", pane, cwd],
            ));
        }
        for env in set.env_commands {
            steps.push(preview(
                format!("set env {} for {pane}", env.key),
                &["pane", "run", pane, &env.command],
            ));
        }
        if let Some(command) = set.command {
            wait_for_terminal_delay(command.delay_ms, true, pane)?;
            steps.push(preview(
                format!("run command for {pane}"),
                &["pane", "run", pane, &command.text],
            ));
        }
    }
    Ok(steps)
}

fn resolve_initial_pane(
    executor: &mut dyn CommandExecutor,
    window_mode: WindowMode,
    initial_cwd: &str,
    window_name: Option<&str>,
    preferred_pane_id: Option<&str>,
    workspace_id: Option<&str>,
    on_confirm_kill: Option<&mut ConfirmHerdrKillCallback<'_>>,
) -> Result<(String, String), CoreError> {
    if window_mode == WindowMode::NewWindow {
        let mut args = strings(&["tab", "create"]);
        if let Some(workspace) = workspace_id.filter(|value| !value.is_empty()) {
            args.extend(["--workspace".to_owned(), workspace.to_owned()]);
        }
        args.extend(["--cwd".to_owned(), initial_cwd.to_owned()]);
        if let Some(name) = window_name.filter(|value| !value.is_empty()) {
            args.extend(["--label".to_owned(), name.to_owned()]);
        }
        args.push("--focus".to_owned());
        let output = run_herdr_cli(executor, &args, "Failed to create herdr tab", None, None)?;
        let result = result_object(&output)?;
        let pane = parse_pane(result.get("root_pane"), &output, "root_pane")?;
        let tab_id = result
            .get("tab")
            .and_then(Value::as_object)
            .and_then(|tab| tab.get("tab_id"))
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                invalid_response(
                    "Herdr tab creation response is missing tab metadata",
                    &output,
                )
            })?;
        return Ok((pane.pane_id, tab_id.to_owned()));
    }

    let mut current_args = strings(&["pane", "current"]);
    if let Some(pane) = preferred_pane_id.filter(|value| !value.is_empty()) {
        current_args.extend(["--pane".to_owned(), pane.to_owned()]);
    }
    let current_output = run_herdr_cli(
        executor,
        &current_args,
        "Failed to resolve current herdr pane",
        None,
        None,
    )?;
    let current = parse_pane(
        result_object(&current_output)?.get("pane"),
        &current_output,
        "pane",
    )?;
    let list_output = run_herdr_cli(
        executor,
        &strings(&["pane", "list", "--workspace", &current.workspace_id]),
        "Failed to list herdr panes",
        None,
        None,
    )?;
    let panes = result_object(&list_output)?
        .get("panes")
        .cloned()
        .ok_or_else(|| {
            invalid_response("Herdr pane list response is missing panes", &list_output)
        })?;
    let panes = serde_json::from_value::<Vec<HerdrPaneInfo>>(panes)
        .map_err(|_| invalid_response("Herdr pane list response is invalid", &list_output))?;
    let close = panes
        .into_iter()
        .filter(|pane| pane.tab_id == current.tab_id && pane.pane_id != current.pane_id)
        .map(|pane| pane.pane_id)
        .collect::<Vec<_>>();
    if !close.is_empty() {
        let confirmed =
            on_confirm_kill.is_none_or(|confirm| confirm(&close, executor.is_dry_run()));
        if !confirmed {
            return Err(execution_error(
                "USER_CANCELLED",
                "Aborted layout application for current herdr tab",
                Some(&current.pane_id),
                json!({ "panes": close }),
            ));
        }
        for pane_id in close {
            run_herdr_cli(
                executor,
                &strings(&["pane", "close", &pane_id]),
                &format!("Failed to close herdr pane {pane_id}"),
                Some(&pane_id),
                None,
            )?;
        }
    }
    Ok((current.pane_id, current.tab_id))
}

fn apply_split_step(
    step: &CommandStep,
    emission: &PlanEmission,
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
    on_warning: &mut Option<&mut HerdrWarningCallback<'_>>,
) -> Result<(), CoreError> {
    let target_virtual = required_target(step)?;
    let target_real = resolve_real_pane_id(pane_map, target_virtual, &step.id)?;
    let orientation = resolve_split_orientation(step)?;
    let resolved_ratio = resolve_herdr_ratio(step, executor, &target_real, orientation)?;
    if let Some(warning) = resolved_ratio.warning.as_deref()
        && let Some(callback) = on_warning.as_deref_mut()
    {
        callback(warning);
    }
    let ratio = resolved_ratio.value;
    let direction = match orientation {
        Orientation::Horizontal => "right",
        Orientation::Vertical => "down",
    };
    let focus = if created_pane_contains_focus(
        step.created_pane_id.as_deref(),
        &emission.summary.focus_pane_id,
    ) {
        "--focus"
    } else {
        "--no-focus"
    };
    let output = run_herdr_cli(
        executor,
        &strings(&[
            "pane",
            "split",
            &target_real,
            "--direction",
            direction,
            "--ratio",
            &format_ratio(ratio),
            focus,
        ]),
        &format!("Failed to split herdr pane {target_real}"),
        Some(&step.id),
        None,
    )?;
    let created = parse_pane(result_object(&output)?.get("pane"), &output, "pane")?;
    if let Some(virtual_id) = step.created_pane_id.as_deref().filter(|id| !id.is_empty()) {
        register_pane_with_ancestors(pane_map, virtual_id, &created.pane_id);
    }
    Ok(())
}

fn resolve_herdr_ratio(
    step: &CommandStep,
    executor: &mut dyn CommandExecutor,
    pane_id: &str,
    orientation: Orientation,
) -> Result<ResolvedHerdrRatio, CoreError> {
    if !matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. })) {
        return match resolve_split_size(step, &Default::default())? {
            ResolvedSplitSize::Percent { percentage } => {
                let percentage = percentage.parse::<f64>().map_err(|_| {
                    execution_error(
                        "INVALID_PLAN",
                        "Invalid split percentage",
                        Some(&step.id),
                        json!({ "percentage": percentage }),
                    )
                })?;
                clamp_herdr_ratio(step, round_ratio(1.0 - percentage / 100.0))
            }
            ResolvedSplitSize::Cells { .. } => Err(execution_error(
                "INVALID_PLAN",
                "Unexpected cell split",
                Some(&step.id),
                json!({}),
            )),
        };
    }

    let output = run_herdr_cli(
        executor,
        &strings(&["pane", "layout", "--pane", pane_id]),
        &format!("Failed to resolve herdr pane layout for {pane_id}"),
        Some(pane_id),
        None,
    )?;
    let result = result_object(&output)?;
    let layout = result
        .get("layout")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid_response("Herdr pane layout response is missing layout", &output))?;
    let panes = layout
        .get("panes")
        .cloned()
        .ok_or_else(|| invalid_response("Herdr pane layout response is missing panes", &output))?;
    let panes = serde_json::from_value::<Vec<HerdrLayoutPane>>(panes)
        .map_err(|_| invalid_response("Herdr pane layout response is invalid", &output))?;
    let pane = panes.iter().find(|pane| pane.pane_id == pane_id);
    let pane_cells = pane.map(|pane| match orientation {
        Orientation::Horizontal => pane.rect.width,
        Orientation::Vertical => pane.rect.height,
    });
    let size = resolve_split_size(
        step,
        &SplitSizeResolutionContext {
            pane_cells,
            pane_id: Some(pane_id.to_owned()),
            required_version: Some(HERDR_MINIMUM_VERSION.to_owned()),
            raw_pane_record: pane.and_then(|pane| serde_json::to_value(pane).ok()),
            ..Default::default()
        },
    )?;
    match size {
        ResolvedSplitSize::Cells {
            target_cells,
            created_cells,
            ..
        } => clamp_herdr_ratio(
            step,
            round_ratio(target_cells as f64 / (target_cells + created_cells) as f64),
        ),
        ResolvedSplitSize::Percent { .. } => Err(execution_error(
            "INVALID_PLAN",
            "Unexpected percent split",
            Some(&step.id),
            json!({}),
        )),
    }
}

fn apply_terminal_commands(
    terminals: &[EmittedTerminal],
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
    focus_virtual: &str,
) -> Result<(), CoreError> {
    resolve_pane_mapping(pane_map, focus_virtual).ok_or_else(|| {
        execution_error(
            "INVALID_PANE",
            format!("Unknown focus pane: {focus_virtual}"),
            Some(focus_virtual),
            json!({}),
        )
    })?;
    for terminal in terminals {
        resolve_pane_mapping(pane_map, &terminal.virtual_pane_id).ok_or_else(|| {
            execution_error(
                "INVALID_PANE",
                format!("Unknown terminal pane: {}", terminal.virtual_pane_id),
                Some(&terminal.virtual_pane_id),
                json!({}),
            )
        })?;
    }
    let prepared = prepare_terminal_commands(terminals, focus_virtual, pane_map)?;
    for set in prepared.commands {
        let pane = &set.real_pane_id;
        if let Some(title) = set.title.as_deref() {
            run_herdr_cli(
                executor,
                &strings(&["pane", "rename", pane, title]),
                &format!("Failed to rename herdr pane {pane}"),
                Some(&set.terminal.virtual_pane_id),
                None,
            )?;
        }
        if let Some(cwd) = set.cwd_command.as_deref() {
            run_in_pane(executor, pane, cwd, &set.terminal.virtual_pane_id)?;
        }
        for env in set.env_commands {
            run_in_pane(executor, pane, &env.command, &set.terminal.virtual_pane_id)?;
        }
        if let Some(command) = set.command {
            wait_for_terminal_delay(
                command.delay_ms,
                executor.is_dry_run(),
                &set.terminal.virtual_pane_id,
            )?;
            run_in_pane(executor, pane, &command.text, &set.terminal.virtual_pane_id)?;
        }
    }
    Ok(())
}

fn run_in_pane(
    executor: &mut dyn CommandExecutor,
    pane_id: &str,
    command: &str,
    path: &str,
) -> Result<(), CoreError> {
    run_herdr_cli(
        executor,
        &strings(&["pane", "run", pane_id, command]),
        &format!("Failed to run command in herdr pane {pane_id}"),
        Some(path),
        None,
    )?;
    Ok(())
}

fn dry_run_ratio(step: &CommandStep) -> Result<ResolvedHerdrRatio<String>, CoreError> {
    if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. })) {
        return Ok(ResolvedHerdrRatio {
            value: "<dynamic>".to_owned(),
            warning: None,
        });
    }
    let ResolvedSplitSize::Percent { percentage } = resolve_split_size(step, &Default::default())?
    else {
        return Ok(ResolvedHerdrRatio {
            value: "<dynamic>".to_owned(),
            warning: None,
        });
    };
    let percentage = percentage.parse::<f64>().map_err(|_| {
        execution_error(
            "INVALID_PLAN",
            "Invalid split percentage",
            Some(&step.id),
            json!({ "percentage": percentage }),
        )
    })?;
    let ratio = round_ratio(1.0 - percentage / 100.0);
    let ratio = clamp_herdr_ratio(step, ratio)?;
    Ok(ResolvedHerdrRatio {
        value: format_ratio(ratio.value),
        warning: ratio.warning,
    })
}

#[derive(Debug, Clone, PartialEq)]
struct ResolvedHerdrRatio<T = f64> {
    value: T,
    warning: Option<String>,
}

fn clamp_herdr_ratio(
    step: &CommandStep,
    requested_ratio: f64,
) -> Result<ResolvedHerdrRatio, CoreError> {
    if !requested_ratio.is_finite() {
        return Err(execution_error(
            "INVALID_PLAN",
            "Herdr split ratio must be finite",
            Some(&step.id),
            json!({ "ratio": requested_ratio }),
        ));
    }
    let applied_ratio = requested_ratio.clamp(MIN_HERDR_RATIO, MAX_HERDR_RATIO);
    let warning = (applied_ratio != requested_ratio).then(|| {
        format!(
            "Herdr adjusted split {} from ratio {} to {} because both sides must occupy at least 10%",
            step.id,
            format_ratio(requested_ratio),
            format_ratio(applied_ratio),
        )
    });
    Ok(ResolvedHerdrRatio {
        value: applied_ratio,
        warning,
    })
}

fn result_object(output: &str) -> Result<Map<String, Value>, CoreError> {
    let value = serde_json::from_str::<Value>(output)
        .map_err(|_| invalid_response("Herdr response is not valid JSON", output))?;
    value
        .get("result")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| invalid_response("Herdr response is missing result", output))
}

fn parse_pane(
    value: Option<&Value>,
    output: &str,
    field: &str,
) -> Result<HerdrPaneInfo, CoreError> {
    value
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .ok_or_else(|| {
            invalid_response(
                &format!("Herdr response is missing {field} metadata"),
                output,
            )
        })
}

fn invalid_response(message: &str, output: &str) -> CoreError {
    execution_error(
        "TERMINAL_COMMAND_FAILED",
        message,
        None,
        json!({ "stdout": output, "backend": "herdr" }),
    )
}

fn required_target(step: &CommandStep) -> Result<&str, CoreError> {
    step.target_pane_id
        .as_deref()
        .filter(|target| !target.is_empty())
        .ok_or_else(|| {
            execution_error(
                "INVALID_PANE",
                match step.kind {
                    CommandStepKind::Split => "Split step missing target pane metadata",
                    CommandStepKind::Focus => "Focus step missing target pane metadata",
                },
                Some(&step.id),
                json!({}),
            )
        })
}

fn register_pane_with_ancestors(
    pane_map: &mut IndexMap<String, String>,
    virtual_id: &str,
    real_id: &str,
) {
    pane_map.insert(virtual_id.to_owned(), real_id.to_owned());
    let mut ancestor = virtual_id;
    while let Some((parent, _)) = ancestor.rsplit_once('.') {
        ancestor = parent;
        if pane_map.contains_key(ancestor) {
            break;
        }
        pane_map.insert(ancestor.to_owned(), real_id.to_owned());
    }
}

fn resolve_real_pane_id(
    pane_map: &mut IndexMap<String, String>,
    virtual_id: &str,
    path: &str,
) -> Result<String, CoreError> {
    resolve_pane_mapping(pane_map, virtual_id).ok_or_else(|| {
        execution_error(
            "INVALID_PANE",
            format!("Unknown herdr pane mapping for {virtual_id}"),
            Some(path),
            json!({}),
        )
    })
}

fn preview(summary: String, args: &[&str]) -> HerdrDryRunStep {
    HerdrDryRunStep {
        summary,
        command: format!(
            "herdr {}",
            args.iter()
                .map(|arg| quote_for_display(arg))
                .collect::<Vec<_>>()
                .join(" ")
        ),
        warning: None,
    }
}

fn quote_for_display(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "_./:=<>-".contains(character))
    {
        value.to_owned()
    } else {
        shell_quote_literal(value)
    }
}

fn extract_version(raw: &str) -> Option<String> {
    let captures = version_pattern().captures(raw)?;
    Some(format!(
        "{}.{}.{}",
        captures.get(1)?.as_str(),
        captures.get(2)?.as_str(),
        captures.get(3)?.as_str()
    ))
}

fn is_version_supported(detected: &str, minimum: &str) -> bool {
    let parse = |version: &str| -> Option<(u64, u64, u64)> {
        let captures = version_pattern().captures(version)?;
        Some((
            captures.get(1)?.as_str().parse().ok()?,
            captures.get(2)?.as_str().parse().ok()?,
            captures.get(3)?.as_str().parse().ok()?,
        ))
    };
    parse(detected)
        .zip(parse(minimum))
        .is_some_and(|(left, right)| left >= right)
}

fn version_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)")
            .expect("herdr version regex must compile")
    })
}

fn round_ratio(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

fn created_pane_contains_focus(created_pane_id: Option<&str>, focus_pane_id: &str) -> bool {
    created_pane_id.is_some_and(|created| {
        created == focus_pane_id
            || focus_pane_id
                .strip_prefix(created)
                .is_some_and(|suffix| suffix.starts_with('.'))
    })
}

fn format_ratio(ratio: f64) -> String {
    let rendered = format!("{ratio:.6}");
    rendered
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

fn execution_error(
    code: &str,
    message: impl Into<String>,
    path: Option<&str>,
    details: Value,
) -> CoreError {
    let mut error = CoreError::new(CoreErrorKind::Execution, code, message)
        .with_details(details.as_object().cloned().unwrap_or_default());
    if let Some(path) = path {
        error.path = Some(path.to_owned());
    }
    error
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}
