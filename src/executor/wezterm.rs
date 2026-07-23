use std::collections::HashSet;
use std::thread;
use std::time::Duration;

use indexmap::IndexMap;
use regex::Regex;
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
use super::tmux::PaneDimensions;
use super::wezterm_list::{WeztermListPane, WeztermListResult, parse_wezterm_list_result};

pub const WEZTERM_MINIMUM_VERSION: &str = "20220624-141144-bd1b7c5d";
const PANE_REGISTRATION_RETRIES: usize = 5;
const PANE_REGISTRATION_DELAY: Duration = Duration::from_millis(100);

pub type ConfirmWeztermKillCallback<'a> = dyn FnMut(&[String], bool) -> bool + 'a;

pub struct ExecuteWeztermPlanOptions<'a> {
    pub window_mode: WindowMode,
    pub cwd: Option<&'a str>,
    pub pane_id: Option<&'a str>,
    pub detected_version: Option<&'a str>,
    pub on_confirm_kill: Option<&'a mut ConfirmWeztermKillCallback<'a>>,
}

struct InitialPaneResolutionOptions<'a> {
    window_mode: WindowMode,
    initial_cwd: Option<String>,
    workspace_hint: Option<String>,
    initial_list: Option<WeztermListResult>,
    preferred_pane_id: Option<String>,
    dry_run: bool,
    on_confirm_kill: Option<&'a mut ConfirmWeztermKillCallback<'a>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyWeztermPlanResult {
    pub executed_steps: usize,
    pub pane_map: IndexMap<String, String>,
    pub focus_pane_id: Option<String>,
    pub pane_name_to_real_id: IndexMap<String, String>,
    pub window_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeztermDryRunStep {
    pub summary: String,
    pub command: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WeztermDryRunOptions {
    pub initial_pane_id: Option<String>,
    pub initial_pane_size: Option<PaneDimensions>,
    pub detected_version: Option<String>,
}

pub fn verify_wezterm_environment(
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
                    "wezterm is not installed",
                    None,
                    json!({ "backend": "wezterm", "binary": "wezterm" }),
                );
            }
            let mut details = (*error.details).clone();
            details.insert("backend".to_owned(), json!("wezterm"));
            details.insert("binary".to_owned(), json!("wezterm"));
            CoreError::new(
                CoreErrorKind::Execution,
                "WEZTERM_NOT_FOUND",
                "Failed to execute wezterm --version",
            )
            .with_details(details)
        })?;
    let detected = extract_version(&raw).ok_or_else(|| {
        execution_error(
            "UNSUPPORTED_WEZTERM_VERSION",
            "Unable to determine wezterm version",
            None,
            json!({
                "requiredVersion": WEZTERM_MINIMUM_VERSION,
                "detectedVersion": raw.trim(),
            }),
        )
    })?;
    if !is_version_supported(&detected, WEZTERM_MINIMUM_VERSION) {
        return Err(execution_error(
            "UNSUPPORTED_WEZTERM_VERSION",
            "Unsupported wezterm version",
            None,
            json!({
                "requiredVersion": WEZTERM_MINIMUM_VERSION,
                "detectedVersion": detected,
            }),
        ));
    }
    Ok(Some(detected))
}

pub fn run_wezterm_cli(
    executor: &mut dyn CommandExecutor,
    args: &[String],
    message: &str,
    path: Option<&str>,
    extra_details: Option<Map<String, Value>>,
) -> Result<String, CoreError> {
    let command = std::iter::once("cli".to_owned())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>();
    executor.execute(&command).map_err(|error| {
        let mut details = (*error.details).clone();
        details.insert("backend".to_owned(), json!("wezterm"));
        details.insert(
            "command".to_owned(),
            json!(
                std::iter::once("wezterm")
                    .chain(std::iter::once("cli"))
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

pub fn list_wezterm_windows(
    executor: &mut dyn CommandExecutor,
) -> Result<WeztermListResult, CoreError> {
    let output = run_wezterm_cli(
        executor,
        &strings(&["list", "--format", "json"]),
        "Failed to list wezterm panes",
        None,
        None,
    )?;
    parse_wezterm_list_result(&output).ok_or_else(|| {
        execution_error(
            "TERMINAL_COMMAND_FAILED",
            "Invalid wezterm list output",
            None,
            json!({ "stdout": output }),
        )
    })
}

pub fn resolve_initial_wezterm_pane_size(
    executor: &mut dyn CommandExecutor,
    pane_id: Option<&str>,
) -> Option<PaneDimensions> {
    let pane_id = pane_id.map(str::trim).filter(|pane| !pane.is_empty())?;
    let list = list_wezterm_windows(executor).ok()?;
    let pane = find_pane_by_id(&list, pane_id)?;
    Some(PaneDimensions {
        cols: pane.size?.cols?,
        rows: pane.size?.rows?,
    })
}

pub fn execute_wezterm_plan(
    emission: &PlanEmission,
    executor: &mut dyn CommandExecutor,
    mut options: ExecuteWeztermPlanOptions<'_>,
) -> Result<ApplyWeztermPlanResult, CoreError> {
    let initial_virtual = emission.summary.initial_pane_id.trim().to_owned();
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
        .or(options.cwd);

    let preferred = options.pane_id.filter(|pane| !pane.is_empty());
    let mut initial_list = None;
    let mut workspace_hint = None;
    if let Some(pane_id) = preferred
        && let Ok(list) = list_wezterm_windows(executor)
    {
        workspace_hint = find_workspace_for_pane(&list, pane_id);
        initial_list = Some(list);
    }

    let dry_run = executor.is_dry_run();
    let (initial_real, window_id) = resolve_initial_pane(
        executor,
        InitialPaneResolutionOptions {
            window_mode: options.window_mode,
            initial_cwd: initial_cwd.map(str::to_owned),
            workspace_hint,
            initial_list,
            preferred_pane_id: preferred.map(str::to_owned),
            dry_run,
            on_confirm_kill: options.on_confirm_kill.take(),
        },
    )?;
    let mut pane_map = IndexMap::new();
    register_pane_with_ancestors(&mut pane_map, &initial_virtual, &initial_real);

    let mut executed_steps = 0;
    for step in &emission.steps {
        match step.kind {
            CommandStepKind::Split => apply_split_step(
                step,
                executor,
                &mut pane_map,
                &window_id,
                options.detected_version,
            )?,
            CommandStepKind::Focus => apply_focus_step(step, executor, &mut pane_map)?,
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
    Ok(ApplyWeztermPlanResult {
        executed_steps,
        pane_map,
        focus_pane_id,
        pane_name_to_real_id,
        window_id,
    })
}

pub fn build_wezterm_dry_run_steps(
    emission: &PlanEmission,
    options: &WeztermDryRunOptions,
) -> Result<Vec<WeztermDryRunStep>, CoreError> {
    let mut steps = Vec::new();
    let mut sizes = IndexMap::new();
    if let (Some(initial_id), Some(initial_size)) =
        (options.initial_pane_id.as_ref(), options.initial_pane_size)
    {
        sizes.insert(initial_id.clone(), initial_size);
    }
    for step in &emission.steps {
        match step.kind {
            CommandStepKind::Split => {
                let target = required_target(step, "MISSING_TARGET")?;
                let orientation = resolve_split_orientation(step)?;
                let size = resolve_dry_run_split_size(
                    step,
                    target,
                    orientation,
                    &mut sizes,
                    options.detected_version.as_deref(),
                )?;
                let args = build_split_arguments(target, orientation, &size);
                steps.push(WeztermDryRunStep {
                    summary: if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. }))
                    {
                        format!("{} [dynamic-cells]", step.summary)
                    } else {
                        step.summary.clone()
                    },
                    command: format!("wezterm cli {}", args.join(" ")),
                });
            }
            CommandStepKind::Focus => {
                let target = required_target(step, "MISSING_TARGET")?;
                steps.push(WeztermDryRunStep {
                    summary: step.summary.clone(),
                    command: format!("wezterm cli activate-pane --pane-id {target}"),
                });
            }
        }
    }

    let mut virtual_map = IndexMap::new();
    virtual_map.insert(
        emission.summary.focus_pane_id.clone(),
        emission.summary.focus_pane_id.clone(),
    );
    for terminal in &emission.terminals {
        virtual_map.insert(
            terminal.virtual_pane_id.clone(),
            terminal.virtual_pane_id.clone(),
        );
    }
    let prepared = prepare_terminal_commands(
        &emission.terminals,
        &emission.summary.focus_pane_id,
        &virtual_map,
    )?;
    for set in prepared.commands {
        let pane = &set.terminal.virtual_pane_id;
        if let Some(cwd) = set.cwd_command {
            steps.push(send_text_preview(format!("set cwd for {pane}"), pane, &cwd));
        }
        for env in set.env_commands {
            steps.push(send_text_preview(
                format!("set env {} for {pane}", env.key),
                pane,
                &env.command,
            ));
        }
        if let Some(command) = set.command {
            wait_for_terminal_delay(command.delay_ms, true, pane)?;
            steps.push(send_text_preview(
                format!("run command for {pane}"),
                pane,
                &command.text,
            ));
        }
    }
    Ok(steps)
}

fn resolve_initial_pane(
    executor: &mut dyn CommandExecutor,
    options: InitialPaneResolutionOptions<'_>,
) -> Result<(String, String), CoreError> {
    let snapshot = match options.initial_list {
        Some(list) => list,
        None => list_wezterm_windows(executor)?,
    };
    let scoped = filter_windows_by_workspace(&snapshot, options.workspace_hint.as_deref());
    if options.window_mode == WindowMode::CurrentWindow {
        return resolve_current_window(
            executor,
            &scoped,
            options.preferred_pane_id.as_deref(),
            options.dry_run,
            options.on_confirm_kill,
        );
    }

    let active_window = options
        .preferred_pane_id
        .as_deref()
        .and_then(|pane| find_window_containing_pane(&scoped, pane))
        .and_then(|window_id| {
            scoped
                .windows
                .iter()
                .find(|window| window.window_id == window_id)
        })
        .or_else(|| scoped.windows.iter().find(|window| window.is_active))
        .or_else(|| scoped.windows.first());
    let mut args = if let Some(window) = active_window {
        strings(&["spawn", "--window-id", &window.window_id])
    } else {
        strings(&["spawn", "--new-window"])
    };
    if let Some(cwd) = options.initial_cwd.as_deref().filter(|cwd| !cwd.is_empty()) {
        args.extend(["--cwd".to_owned(), cwd.to_owned()]);
    }
    if active_window.is_none()
        && let Some(workspace) = options
            .workspace_hint
            .as_deref()
            .filter(|workspace| !workspace.is_empty())
    {
        args.extend(["--workspace".to_owned(), workspace.to_owned()]);
    }
    let message = if active_window.is_some() {
        "Failed to spawn wezterm tab"
    } else {
        "Failed to spawn wezterm window"
    };
    let output = run_wezterm_cli(executor, &args, message, None, None)?;
    let pane_id = extract_spawn_pane_id(&output);
    if pane_id.is_empty() {
        return Err(execution_error(
            "TERMINAL_COMMAND_FAILED",
            "wezterm spawn did not return a pane id",
            None,
            json!({ "stdout": output }),
        ));
    }
    let window_hint = active_window.map(|window| window.window_id.as_str());
    let window_id = wait_for_pane_registration(executor, &pane_id, window_hint)?;
    Ok((pane_id, window_id))
}

fn resolve_current_window(
    executor: &mut dyn CommandExecutor,
    list: &WeztermListResult,
    preferred_pane_id: Option<&str>,
    dry_run: bool,
    on_confirm_kill: Option<&mut ConfirmWeztermKillCallback<'_>>,
) -> Result<(String, String), CoreError> {
    let window = preferred_pane_id
        .and_then(|pane| find_window_containing_pane(list, pane))
        .and_then(|id| list.windows.iter().find(|window| window.window_id == id))
        .or_else(|| list.windows.iter().find(|window| window.is_active))
        .or_else(|| list.windows.first())
        .ok_or_else(|| {
            execution_error(
                "TERMINAL_COMMAND_FAILED",
                "No active wezterm window detected",
                None,
                json!({
                    "hint": "Launch wezterm and ensure a window is focused, or run with --new-window.",
                }),
            )
        })?;
    let tab = preferred_pane_id
        .and_then(|pane| {
            window
                .tabs
                .iter()
                .find(|tab| tab.panes.iter().any(|candidate| candidate.pane_id == pane))
        })
        .or_else(|| window.tabs.iter().find(|tab| tab.is_active))
        .or_else(|| window.tabs.first())
        .ok_or_else(|| {
            execution_error(
                "TERMINAL_COMMAND_FAILED",
                "No active wezterm tab detected",
                Some(&window.window_id),
                json!({ "hint": "Ensure a wezterm tab is focused before using --current-window." }),
            )
        })?;
    let pane = preferred_pane_id
        .and_then(|pane| tab.panes.iter().find(|candidate| candidate.pane_id == pane))
        .or_else(|| tab.panes.iter().find(|pane| pane.is_active))
        .or_else(|| tab.panes.first())
        .ok_or_else(|| {
            execution_error(
                "TERMINAL_COMMAND_FAILED",
                "No active wezterm pane detected",
                Some(&tab.tab_id),
                json!({ "hint": "Ensure a wezterm pane is active before using --current-window." }),
            )
        })?;
    let close = tab
        .panes
        .iter()
        .filter(|candidate| candidate.pane_id != pane.pane_id)
        .map(|candidate| candidate.pane_id.clone())
        .collect::<Vec<_>>();
    if !close.is_empty() {
        let confirmed = on_confirm_kill.is_none_or(|confirm| confirm(&close, dry_run));
        if !confirmed {
            return Err(execution_error(
                "USER_CANCELLED",
                "Aborted layout application for current wezterm window",
                Some(&pane.pane_id),
                json!({ "panes": close }),
            ));
        }
        for pane_id in close {
            run_wezterm_cli(
                executor,
                &strings(&["kill-pane", "--pane-id", &pane_id]),
                &format!("Failed to kill wezterm pane {pane_id}"),
                Some(&pane_id),
                None,
            )?;
        }
    }
    Ok((pane.pane_id.clone(), window.window_id.clone()))
}

fn wait_for_pane_registration(
    executor: &mut dyn CommandExecutor,
    pane_id: &str,
    window_hint: Option<&str>,
) -> Result<String, CoreError> {
    for attempt in 0..PANE_REGISTRATION_RETRIES {
        let snapshot = list_wezterm_windows(executor)?;
        if let Some(window_hint) = window_hint
            && collect_pane_ids_for_window(&snapshot, window_hint)
                .is_ok_and(|panes| panes.contains(pane_id))
        {
            return Ok(window_hint.to_owned());
        }
        if let Some(window) = find_window_containing_pane(&snapshot, pane_id) {
            return Ok(window);
        }
        if attempt + 1 < PANE_REGISTRATION_RETRIES {
            thread::sleep(PANE_REGISTRATION_DELAY);
        }
    }
    Err(execution_error(
        "TERMINAL_COMMAND_FAILED",
        "Unable to locate spawned wezterm window",
        None,
        json!({
            "paneId": pane_id,
            "hint": "Verify that wezterm is running and the CLI client can connect.",
        }),
    ))
}

fn apply_split_step(
    step: &CommandStep,
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
    window_id: &str,
    detected_version: Option<&str>,
) -> Result<(), CoreError> {
    let target_virtual = required_target(step, "INVALID_PANE")?;
    let target_real = resolve_real_pane_id(pane_map, target_virtual, &step.id)?;
    let before = list_wezterm_windows(executor)?;
    let before_ids = collect_pane_ids_for_window(&before, window_id)?;
    let orientation = resolve_split_orientation(step)?;
    let target_pane = find_pane_by_id(&before, &target_real);
    let pane_cells = target_pane.and_then(|pane| match orientation {
        Orientation::Horizontal => pane.size.and_then(|size| size.cols),
        Orientation::Vertical => pane.size.and_then(|size| size.rows),
    });
    let size = resolve_split_size(
        step,
        &SplitSizeResolutionContext {
            pane_cells,
            pane_id: Some(target_real.clone()),
            required_version: Some(WEZTERM_MINIMUM_VERSION.to_owned()),
            detected_version: detected_version.map(str::to_owned),
            raw_pane_record: target_pane.map(|pane| pane.raw_pane_record.clone()),
        },
    )?;
    let args = build_split_arguments(&target_real, orientation, &size);
    run_wezterm_cli(
        executor,
        &args,
        &format!("Failed to execute split step {}", step.id),
        Some(&step.id),
        None,
    )?;
    let after = list_wezterm_windows(executor)?;
    let after_ids = collect_pane_ids_for_window(&after, window_id)?;
    let new_pane = after_ids
        .into_iter()
        .find(|pane| !before_ids.contains(pane))
        .ok_or_else(|| {
            execution_error(
                "TERMINAL_COMMAND_FAILED",
                "Unable to determine newly created wezterm pane",
                Some(&step.id),
                json!({}),
            )
        })?;
    if let Some(created) = step.created_pane_id.as_deref().filter(|id| !id.is_empty()) {
        register_pane_with_ancestors(pane_map, created, &new_pane);
    }
    Ok(())
}

fn apply_focus_step(
    step: &CommandStep,
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
) -> Result<(), CoreError> {
    let target_virtual = required_target(step, "INVALID_PANE")?;
    let target_real = resolve_real_pane_id(pane_map, target_virtual, &step.id)?;
    run_wezterm_cli(
        executor,
        &strings(&["activate-pane", "--pane-id", &target_real]),
        &format!("Failed to execute focus step {}", step.id),
        Some(&step.id),
        None,
    )?;
    Ok(())
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
        if let Some(cwd) = set.cwd_command.as_deref() {
            send_text(
                executor,
                &set.real_pane_id,
                cwd,
                &format!(
                    "Failed to change directory for pane {}",
                    set.terminal.virtual_pane_id
                ),
                &set.terminal.virtual_pane_id,
                json!({ "cwd": set.terminal.cwd }),
            )?;
        }
        for env in set.env_commands {
            send_text(
                executor,
                &set.real_pane_id,
                &env.command,
                &format!("Failed to set environment variable {}", env.key),
                &set.terminal.virtual_pane_id,
                json!({}),
            )?;
        }
        if let Some(command) = set.command {
            wait_for_terminal_delay(
                command.delay_ms,
                executor.is_dry_run(),
                &set.terminal.virtual_pane_id,
            )?;
            send_text(
                executor,
                &set.real_pane_id,
                &command.text,
                &format!(
                    "Failed to execute command for pane {}",
                    set.terminal.virtual_pane_id
                ),
                &set.terminal.virtual_pane_id,
                json!({ "command": set.terminal.command }),
            )?;
        }
    }
    Ok(())
}

fn send_text(
    executor: &mut dyn CommandExecutor,
    pane_id: &str,
    text: &str,
    message: &str,
    path: &str,
    details: Value,
) -> Result<(), CoreError> {
    let text = if text.ends_with('\r') {
        text.to_owned()
    } else {
        format!("{text}\r")
    };
    run_wezterm_cli(
        executor,
        &[
            "send-text".to_owned(),
            "--pane-id".to_owned(),
            pane_id.to_owned(),
            "--no-paste".to_owned(),
            "--".to_owned(),
            text,
        ],
        message,
        Some(path),
        details.as_object().cloned(),
    )?;
    Ok(())
}

fn resolve_dry_run_split_size(
    step: &CommandStep,
    target: &str,
    orientation: Orientation,
    sizes: &mut IndexMap<String, PaneDimensions>,
    detected_version: Option<&str>,
) -> Result<DryRunSplitSize, CoreError> {
    if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. })) {
        let Some(base) = sizes.get(target).copied() else {
            return Ok(DryRunSplitSize::Placeholder);
        };
        let pane_cells = match orientation {
            Orientation::Horizontal => base.cols,
            Orientation::Vertical => base.rows,
        };
        let resolved = match resolve_split_size(
            step,
            &SplitSizeResolutionContext {
                pane_cells: Some(pane_cells),
                pane_id: Some(target.to_owned()),
                detected_version: detected_version.map(str::to_owned),
                raw_pane_record: Some(json!({
                    "backend": "wezterm",
                    "paneId": target,
                    "sourceFormat": "unknown",
                    "size": { "cols": base.cols, "rows": base.rows },
                })),
                ..Default::default()
            },
        ) {
            Ok(resolved) => resolved,
            Err(error) if error.code == "SPLIT_SIZE_RESOLUTION_FAILED" => {
                return Ok(DryRunSplitSize::Placeholder);
            }
            Err(error) => return Err(error),
        };
        let ResolvedSplitSize::Cells {
            cells,
            target_cells,
            created_cells,
        } = resolved
        else {
            return Ok(DryRunSplitSize::Placeholder);
        };
        if let Some(created) = step.created_pane_id.as_ref().filter(|id| !id.is_empty()) {
            update_pane_sizes(
                sizes,
                target,
                created,
                orientation,
                target_cells,
                created_cells,
            );
        }
        Ok(DryRunSplitSize::Resolved(ResolvedSplitSize::Cells {
            cells,
            target_cells,
            created_cells,
        }))
    } else {
        resolve_split_size(step, &Default::default()).map(DryRunSplitSize::Resolved)
    }
}

enum DryRunSplitSize {
    Resolved(ResolvedSplitSize),
    Placeholder,
}

fn build_split_arguments(
    target: &str,
    orientation: Orientation,
    size: &impl SplitArgument,
) -> Vec<String> {
    let direction = match orientation {
        Orientation::Horizontal => "--right",
        Orientation::Vertical => "--bottom",
    };
    let (size_flag, size_value) = size.arguments();
    strings(&[
        "split-pane",
        direction,
        size_flag,
        &size_value,
        "--pane-id",
        target,
    ])
}

trait SplitArgument {
    fn arguments(&self) -> (&'static str, String);
}

impl SplitArgument for ResolvedSplitSize {
    fn arguments(&self) -> (&'static str, String) {
        match self {
            Self::Percent { percentage } => ("--percent", percentage.clone()),
            Self::Cells { cells, .. } => ("--cells", cells.clone()),
        }
    }
}

impl SplitArgument for DryRunSplitSize {
    fn arguments(&self) -> (&'static str, String) {
        match self {
            Self::Resolved(size) => size.arguments(),
            Self::Placeholder => ("--cells", "<dynamic>".to_owned()),
        }
    }
}

fn send_text_preview(summary: String, pane_id: &str, text: &str) -> WeztermDryRunStep {
    WeztermDryRunStep {
        summary,
        command: format!(
            "wezterm cli send-text --pane-id {pane_id} --no-paste -- {}",
            shell_quote_literal(text)
        ),
    }
}

fn update_pane_sizes(
    sizes: &mut IndexMap<String, PaneDimensions>,
    target: &str,
    created: &str,
    orientation: Orientation,
    target_cells: u64,
    created_cells: u64,
) {
    let Some(base) = sizes.get(target).copied() else {
        return;
    };
    match orientation {
        Orientation::Horizontal => {
            sizes.insert(
                target.to_owned(),
                PaneDimensions {
                    cols: target_cells,
                    rows: base.rows,
                },
            );
            sizes.insert(
                created.to_owned(),
                PaneDimensions {
                    cols: created_cells,
                    rows: base.rows,
                },
            );
        }
        Orientation::Vertical => {
            sizes.insert(
                target.to_owned(),
                PaneDimensions {
                    cols: base.cols,
                    rows: target_cells,
                },
            );
            sizes.insert(
                created.to_owned(),
                PaneDimensions {
                    cols: base.cols,
                    rows: created_cells,
                },
            );
        }
    }
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
            format!("Unknown wezterm pane mapping for {virtual_id}"),
            Some(path),
            json!({}),
        )
    })
}

pub fn collect_pane_ids_for_window(
    list: &WeztermListResult,
    window_id: &str,
) -> Result<HashSet<String>, CoreError> {
    let window = list
        .windows
        .iter()
        .find(|window| window.window_id == window_id)
        .ok_or_else(|| {
            execution_error(
                "TERMINAL_COMMAND_FAILED",
                format!("Wezterm window {window_id} not found"),
                None,
                json!({ "windowId": window_id }),
            )
        })?;
    Ok(window
        .tabs
        .iter()
        .flat_map(|tab| tab.panes.iter().map(|pane| pane.pane_id.clone()))
        .collect())
}

fn find_pane_by_id<'a>(list: &'a WeztermListResult, pane_id: &str) -> Option<&'a WeztermListPane> {
    list.windows
        .iter()
        .flat_map(|window| &window.tabs)
        .flat_map(|tab| &tab.panes)
        .find(|pane| pane.pane_id == pane_id)
}

fn find_window_containing_pane(list: &WeztermListResult, pane_id: &str) -> Option<String> {
    list.windows
        .iter()
        .find(|window| {
            window
                .tabs
                .iter()
                .any(|tab| tab.panes.iter().any(|pane| pane.pane_id == pane_id))
        })
        .map(|window| window.window_id.clone())
}

fn find_workspace_for_pane(list: &WeztermListResult, pane_id: &str) -> Option<String> {
    list.windows
        .iter()
        .find(|window| {
            window
                .tabs
                .iter()
                .any(|tab| tab.panes.iter().any(|pane| pane.pane_id == pane_id))
        })
        .and_then(|window| window.workspace.clone())
}

fn filter_windows_by_workspace(
    list: &WeztermListResult,
    workspace: Option<&str>,
) -> WeztermListResult {
    let Some(workspace) = workspace.filter(|workspace| !workspace.is_empty()) else {
        return list.clone();
    };
    let windows = list
        .windows
        .iter()
        .filter(|window| window.workspace.as_deref() == Some(workspace))
        .cloned()
        .collect::<Vec<_>>();
    if windows.is_empty() {
        list.clone()
    } else {
        WeztermListResult { windows }
    }
}

fn extract_spawn_pane_id(output: &str) -> String {
    output
        .trim()
        .lines()
        .next_back()
        .and_then(|line| line.split_whitespace().next())
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn required_target<'a>(step: &'a CommandStep, code: &str) -> Result<&'a str, CoreError> {
    step.target_pane_id
        .as_deref()
        .filter(|target| !target.is_empty())
        .ok_or_else(|| {
            execution_error(
                code,
                match step.kind {
                    CommandStepKind::Split => "Split step missing target pane metadata",
                    CommandStepKind::Focus => "Focus step missing target pane metadata",
                },
                Some(&step.id),
                json!({}),
            )
        })
}

fn extract_version(raw: &str) -> Option<String> {
    let captures = version_pattern().captures(raw)?;
    Some(format!(
        "{}-{}-{}",
        captures.get(1)?.as_str(),
        captures.get(2)?.as_str(),
        captures.get(3)?.as_str().to_ascii_lowercase()
    ))
}

fn is_version_supported(detected: &str, minimum: &str) -> bool {
    let parse = |version: &str| -> Option<(u64, String)> {
        let captures = version_pattern().captures(version)?;
        let build = format!("{}{}", captures.get(1)?.as_str(), captures.get(2)?.as_str())
            .parse::<u64>()
            .ok()?;
        Some((build, captures.get(3)?.as_str().to_ascii_lowercase()))
    };
    parse(detected).zip(parse(minimum)).is_some_and(
        |((detected_build, detected_commit), (minimum_build, minimum_commit))| {
            detected_build > minimum_build
                || (detected_build == minimum_build && detected_commit >= minimum_commit)
        },
    )
}

fn version_pattern() -> &'static Regex {
    use std::sync::OnceLock;
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)(\d{8})-(\d{6})-([0-9a-f]+)").expect("wezterm version regex must compile")
    })
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
