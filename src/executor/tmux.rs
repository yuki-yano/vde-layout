use indexmap::IndexMap;
use serde_json::json;

use crate::core::{
    CommandStep, CommandStepKind, CoreError, CoreErrorKind, PlanEmission, SplitSizing,
};
use crate::model::{Orientation, WindowMode};

use super::command::CommandExecutor;
use super::split::{
    ResolvedSplitSize, SplitSizeResolutionContext, resolve_split_orientation, resolve_split_size,
};
use super::terminal::{prepare_terminal_commands, resolve_pane_mapping, wait_for_terminal_delay};

pub const SIDEBAR_LIST_PANES_FORMAT: &str = "#{pane_id}\t#{@vde_sidebar}";
const CURRENT_PANE_SIZE_FORMAT: &str = "#{pane_width} #{pane_height} #{@vde_sidebar}";
const PANE_SIZE_FORMAT: &str = "#{pane_width} #{pane_height}";
pub type ConfirmKillCallback<'a> = dyn FnMut(&[String], bool) -> bool + 'a;

pub struct ExecuteTmuxPlanOptions<'a> {
    pub window_mode: WindowMode,
    pub window_name: Option<&'a str>,
    pub tmux_pane: Option<&'a str>,
    pub detected_version: Option<&'a str>,
    pub on_confirm_kill: Option<&'a mut ConfirmKillCallback<'a>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecuteTmuxPlanResult {
    pub executed_steps: usize,
    pub pane_map: IndexMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyTmuxPlanResult {
    pub executed_steps: usize,
    pub pane_map: IndexMap<String, String>,
    pub focus_pane_id: Option<String>,
    pub pane_name_to_real_id: IndexMap<String, String>,
    pub window_id: Option<String>,
}

pub fn apply_tmux_plan(
    emission: &PlanEmission,
    executor: &mut dyn CommandExecutor,
    options: ExecuteTmuxPlanOptions<'_>,
) -> Result<ApplyTmuxPlanResult, CoreError> {
    let execution = execute_tmux_plan(emission, executor, options)?;
    let focus_pane_id = execution
        .pane_map
        .get(&emission.summary.focus_pane_id)
        .cloned();
    let pane_name_to_real_id =
        super::template::build_name_to_real_id_map(&emission.terminals, &execution.pane_map);
    let window_id = focus_pane_id.as_deref().and_then(|focus| {
        executor
            .execute(&strings(&[
                "display-message",
                "-p",
                "-t",
                focus,
                "#{window_id}",
            ]))
            .ok()
            .map(|output| output.trim().to_owned())
            .filter(|output| !output.is_empty())
    });
    Ok(ApplyTmuxPlanResult {
        executed_steps: execution.executed_steps,
        pane_map: execution.pane_map,
        focus_pane_id,
        pane_name_to_real_id,
        window_id,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaneDimensions {
    pub cols: u64,
    pub rows: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TmuxDryRunStep {
    pub summary: String,
    pub command: String,
}

pub fn verify_tmux_environment(
    executor: &mut dyn CommandExecutor,
    in_tmux_session: bool,
) -> Result<Option<String>, CoreError> {
    if !in_tmux_session {
        return Err(execution_error(
            "NOT_IN_TMUX_SESSION",
            "Must be run inside a tmux session",
            "environment.tmux",
        ));
    }
    if executor.is_dry_run() {
        return Ok(None);
    }
    let raw = executor.execute(&strings(&["-V"])).map_err(|_| {
        execution_error(
            "TMUX_NOT_FOUND",
            "tmux is not installed",
            "environment.tmux",
        )
    })?;
    Ok(raw
        .trim()
        .strip_prefix("tmux ")
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_owned))
}

pub fn resolve_initial_tmux_pane_size(
    executor: &mut dyn CommandExecutor,
    tmux_session: Option<&str>,
    tmux_pane: Option<&str>,
) -> Option<PaneDimensions> {
    tmux_session
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let current_pane = tmux_pane.map(str::trim).filter(|value| !value.is_empty())?;
    let (current_size, sidebar_flag) = query_pane_size(executor, current_pane, true)?;
    let is_sidebar = sidebar_flag?;
    if !is_sidebar {
        return Some(current_size);
    }

    let (_, normal) =
        classify_window_panes(executor, "dryRun.initialPane", Some(current_pane)).ok()?;
    let origin = normal.first()?;
    query_pane_size(executor, origin, false).map(|(size, _)| size)
}

pub fn build_tmux_dry_run_steps(
    emission: &PlanEmission,
    initial_size: Option<PaneDimensions>,
    detected_version: Option<&str>,
) -> Result<Vec<TmuxDryRunStep>, CoreError> {
    validate_terminal_commands_for_dry_run(emission)?;
    let mut sizes = IndexMap::new();
    if let Some(size) = initial_size {
        sizes.insert(emission.summary.initial_pane_id.clone(), size);
    }
    emission
        .steps
        .iter()
        .map(|step| {
            let command = build_preview_command(step, &mut sizes, detected_version)?;
            Ok(TmuxDryRunStep {
                summary: step.summary.clone(),
                command: std::iter::once("tmux".to_owned())
                    .chain(command)
                    .collect::<Vec<_>>()
                    .join(" "),
            })
        })
        .collect()
}

fn validate_terminal_commands_for_dry_run(emission: &PlanEmission) -> Result<(), CoreError> {
    let mut virtual_map = emission
        .terminals
        .iter()
        .map(|terminal| {
            (
                terminal.virtual_pane_id.clone(),
                terminal.virtual_pane_id.clone(),
            )
        })
        .collect::<IndexMap<_, _>>();
    virtual_map.insert(
        emission.summary.focus_pane_id.clone(),
        emission.summary.focus_pane_id.clone(),
    );
    let prepared = prepare_terminal_commands(
        &emission.terminals,
        &emission.summary.focus_pane_id,
        &virtual_map,
    )?;
    for set in prepared.commands {
        if let Some(command) = set.command {
            wait_for_terminal_delay(command.delay_ms, true, &set.terminal.virtual_pane_id)?;
        }
    }
    Ok(())
}

pub fn execute_tmux_plan(
    emission: &PlanEmission,
    executor: &mut dyn CommandExecutor,
    mut options: ExecuteTmuxPlanOptions<'_>,
) -> Result<ExecuteTmuxPlanResult, CoreError> {
    let initial_virtual = &emission.summary.initial_pane_id;
    if initial_virtual.is_empty() {
        return Err(execution_error(
            "INVALID_PLAN",
            "Plan emission is missing initial pane metadata",
            "plan.initialPaneId",
        ));
    }
    let dry_run = executor.is_dry_run();
    let initial_real = match options.window_mode {
        WindowMode::CurrentWindow => {
            let current =
                resolve_current_pane(executor, options.tmux_pane, dry_run, initial_virtual)?;
            let (sidebars, normal) =
                classify_window_panes(executor, initial_virtual, Some(&current))?;
            let origin = if sidebars.iter().any(|pane| pane == &current) {
                match normal.first() {
                    Some(pane) => pane.clone(),
                    None => split_beside_sidebar(executor, &current, initial_virtual)?,
                }
            } else {
                current
            };
            let close = normal
                .into_iter()
                .filter(|pane| pane != &origin)
                .collect::<Vec<_>>();
            if !close.is_empty() {
                let confirmed = options
                    .on_confirm_kill
                    .as_mut()
                    .is_none_or(|confirm| confirm(&close, dry_run));
                if !confirmed {
                    return Err(execution_error(
                        "USER_CANCELLED",
                        "Aborted layout application for current window",
                        initial_virtual,
                    )
                    .with_details(
                        json!({ "panes": close })
                            .as_object()
                            .cloned()
                            .unwrap_or_default(),
                    ));
                }
                for pane in close {
                    execute_command(
                        executor,
                        vec!["kill-pane", "-t", &pane],
                        "TMUX_COMMAND_FAILED",
                        "Failed to close existing panes",
                        initial_virtual,
                    )?;
                }
            }
            normalize_pane_id(&origin)
        }
        WindowMode::NewWindow => {
            let mut command = strings(&["new-window", "-P", "-F", "#{pane_id}"]);
            if let Some(name) = options
                .window_name
                .map(str::trim)
                .filter(|name| !name.is_empty())
            {
                command.extend(["-n".to_owned(), name.to_owned()]);
            }
            let output = execute_command_owned(
                executor,
                &command,
                "TMUX_COMMAND_FAILED",
                "Failed to create tmux window",
                initial_virtual,
            )?;
            normalize_pane_id(&output)
        }
    };

    let mut pane_map = IndexMap::new();
    pane_map.insert(initial_virtual.clone(), initial_real);
    let mut executed_steps = 0;
    for step in &emission.steps {
        match step.kind {
            CommandStepKind::Split => {
                execute_split_step(step, executor, &mut pane_map, options.detected_version)?
            }
            CommandStepKind::Focus => execute_focus_step(step, executor, &mut pane_map)?,
        }
        executed_steps += 1;
    }
    execute_terminal_commands(
        &emission.terminals,
        executor,
        &mut pane_map,
        &emission.summary.focus_pane_id,
    )?;
    let focus = resolve_pane(
        &mut pane_map,
        &emission.summary.focus_pane_id,
        "Unknown focus pane",
    )?;
    execute_command(
        executor,
        vec!["select-pane", "-t", &focus],
        "TMUX_COMMAND_FAILED",
        "Failed to restore focus",
        &emission.summary.focus_pane_id,
    )?;
    Ok(ExecuteTmuxPlanResult {
        executed_steps,
        pane_map,
    })
}

pub fn classify_window_panes(
    executor: &mut dyn CommandExecutor,
    path: &str,
    target: Option<&str>,
) -> Result<(Vec<String>, Vec<String>), CoreError> {
    let mut command = strings(&["list-panes"]);
    if let Some(target) = target.filter(|target| !target.is_empty()) {
        command.extend(["-t".to_owned(), target.to_owned()]);
    }
    command.extend(["-F".to_owned(), SIDEBAR_LIST_PANES_FORMAT.to_owned()]);
    let output = execute_command_owned(
        executor,
        &command,
        "TMUX_COMMAND_FAILED",
        "Failed to list tmux panes for sidebar detection",
        path,
    )?;
    let mut sidebars = Vec::new();
    let mut normal = Vec::new();
    for line in output.lines() {
        let mut fields = line.splitn(2, '\t');
        let pane = fields.next().unwrap_or_default().trim();
        if pane.is_empty() {
            continue;
        }
        if fields.next().unwrap_or_default().trim() == "1" {
            sidebars.push(pane.to_owned());
        } else {
            normal.push(pane.to_owned());
        }
    }
    Ok((sidebars, normal))
}

fn execute_split_step(
    step: &CommandStep,
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
    detected_version: Option<&str>,
) -> Result<(), CoreError> {
    let target_virtual = step
        .target_pane_id
        .as_deref()
        .filter(|target| !target.is_empty())
        .ok_or_else(|| {
            execution_error(
                "MISSING_TARGET",
                "Split step missing target pane metadata",
                &step.id,
            )
        })?;
    let target_real = resolve_pane(pane_map, target_virtual, "Unknown target pane")?;
    let before = list_pane_ids(executor, &step.id)?;
    let command = build_split_command(step, executor, &target_real, detected_version)?;
    execute_command_owned(
        executor,
        &command,
        "TMUX_COMMAND_FAILED",
        &format!("Failed to execute split step {}", step.id),
        &step.id,
    )?;
    let after = list_pane_ids(executor, &step.id)?;
    let new_pane = after
        .into_iter()
        .find(|pane| !before.iter().any(|old| old == pane))
        .ok_or_else(|| {
            execution_error(
                "INVALID_PANE",
                "Unable to determine newly created pane",
                &step.id,
            )
        })?;
    if let Some(created) = step.created_pane_id.as_ref().filter(|id| !id.is_empty()) {
        pane_map.insert(created.clone(), new_pane);
    }
    Ok(())
}

fn execute_focus_step(
    step: &CommandStep,
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
) -> Result<(), CoreError> {
    let target_virtual = step
        .target_pane_id
        .as_deref()
        .filter(|target| !target.is_empty())
        .ok_or_else(|| {
            execution_error(
                "MISSING_TARGET",
                "Focus step missing target pane metadata",
                &step.id,
            )
        })?;
    let target = resolve_pane(pane_map, target_virtual, "Unknown focus pane")?;
    execute_command(
        executor,
        vec!["select-pane", "-t", &target],
        "TMUX_COMMAND_FAILED",
        &format!("Failed to execute focus step {}", step.id),
        &step.id,
    )?;
    Ok(())
}

fn build_split_command(
    step: &CommandStep,
    executor: &mut dyn CommandExecutor,
    target: &str,
    detected_version: Option<&str>,
) -> Result<Vec<String>, CoreError> {
    let orientation = resolve_split_orientation(step)?;
    let direction = match orientation {
        Orientation::Horizontal => "-h",
        Orientation::Vertical => "-v",
    };
    let context = if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. })) {
        let format = match orientation {
            Orientation::Horizontal => "#{pane_width}",
            Orientation::Vertical => "#{pane_height}",
        };
        let output = execute_command(
            executor,
            vec!["display-message", "-p", "-t", target, format],
            "TMUX_COMMAND_FAILED",
            "Failed to resolve tmux pane size",
            &step.id,
        )?;
        let pane_cells = parse_positive_integer_prefix(output.trim()).ok_or_else(|| {
            execution_error(
                "SPLIT_SIZE_RESOLUTION_FAILED",
                "Unable to parse tmux pane size",
                &step.id,
            )
            .with_details(
                json!({
                    "paneId": target,
                    "orientation": orientation,
                    "output": output,
                    "detectedVersion": detected_version,
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
            )
        })?;
        SplitSizeResolutionContext {
            pane_cells: Some(pane_cells),
            pane_id: Some(target.to_owned()),
            detected_version: detected_version.map(str::to_owned),
            raw_pane_record: Some(json!({
                "backend": "tmux",
                "paneId": target,
                "sourceFormat": "tmux-format",
            })),
            ..Default::default()
        }
    } else {
        SplitSizeResolutionContext {
            pane_id: Some(target.to_owned()),
            detected_version: detected_version.map(str::to_owned),
            ..Default::default()
        }
    };
    let size = resolve_split_size(step, &context)?;
    let mut command = strings(&["split-window", direction, "-t", target]);
    match size {
        ResolvedSplitSize::Percent { percentage } => {
            command.extend(["-l".to_owned(), format!("{percentage}%")]);
        }
        ResolvedSplitSize::Cells { cells, .. } => {
            command.extend(["-l".to_owned(), cells]);
        }
    }
    Ok(command)
}

fn build_preview_command(
    step: &CommandStep,
    sizes: &mut IndexMap<String, PaneDimensions>,
    detected_version: Option<&str>,
) -> Result<Vec<String>, CoreError> {
    match step.kind {
        CommandStepKind::Focus => {
            let target = step.target_pane_id.as_deref().ok_or_else(|| {
                execution_error(
                    "MISSING_TARGET",
                    "Focus step missing target pane metadata",
                    &step.id,
                )
            })?;
            Ok(strings(&["select-pane", "-t", target]))
        }
        CommandStepKind::Split => {
            let target = step.target_pane_id.as_deref().ok_or_else(|| {
                execution_error(
                    "MISSING_TARGET",
                    "Split step missing target pane metadata",
                    &step.id,
                )
            })?;
            let orientation = resolve_split_orientation(step)?;
            let direction = match orientation {
                Orientation::Horizontal => "-h",
                Orientation::Vertical => "-v",
            };
            if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. })) {
                let Some(size) = sizes.get(target).copied() else {
                    return Ok(strings(&[
                        "split-window",
                        direction,
                        "-t",
                        target,
                        "-l",
                        "<dynamic>",
                    ]));
                };
                let pane_cells = match orientation {
                    Orientation::Horizontal => size.cols,
                    Orientation::Vertical => size.rows,
                };
                let resolved = match resolve_split_size(
                    step,
                    &SplitSizeResolutionContext {
                        pane_cells: Some(pane_cells),
                        pane_id: Some(target.to_owned()),
                        detected_version: detected_version.map(str::to_owned),
                        raw_pane_record: Some(json!({
                            "backend": "tmux",
                            "paneId": target,
                            "sourceFormat": "tmux-format",
                            "size": { "cols": size.cols, "rows": size.rows },
                        })),
                        ..Default::default()
                    },
                ) {
                    Ok(resolved) => resolved,
                    Err(error) if error.code == "SPLIT_SIZE_RESOLUTION_FAILED" => {
                        return Ok(strings(&[
                            "split-window",
                            direction,
                            "-t",
                            target,
                            "-l",
                            "<dynamic>",
                        ]));
                    }
                    Err(error) => return Err(error),
                };
                let ResolvedSplitSize::Cells {
                    cells,
                    target_cells,
                    created_cells,
                } = resolved
                else {
                    return Err(execution_error(
                        "INVALID_PLAN",
                        "Dynamic split resolved to a non-cell sizing mode",
                        &step.id,
                    ));
                };
                if let Some(created) = step.created_pane_id.as_ref() {
                    match orientation {
                        Orientation::Horizontal => {
                            sizes.insert(
                                target.to_owned(),
                                PaneDimensions {
                                    cols: target_cells,
                                    rows: size.rows,
                                },
                            );
                            sizes.insert(
                                created.clone(),
                                PaneDimensions {
                                    cols: created_cells,
                                    rows: size.rows,
                                },
                            );
                        }
                        Orientation::Vertical => {
                            sizes.insert(
                                target.to_owned(),
                                PaneDimensions {
                                    cols: size.cols,
                                    rows: target_cells,
                                },
                            );
                            sizes.insert(
                                created.clone(),
                                PaneDimensions {
                                    cols: size.cols,
                                    rows: created_cells,
                                },
                            );
                        }
                    }
                }
                Ok(strings(&[
                    "split-window",
                    direction,
                    "-t",
                    target,
                    "-l",
                    &cells,
                ]))
            } else {
                let ResolvedSplitSize::Percent { percentage } =
                    resolve_split_size(step, &Default::default())?
                else {
                    return Err(execution_error(
                        "INVALID_PLAN",
                        "Percent split resolved to a non-percent sizing mode",
                        &step.id,
                    ));
                };
                Ok(strings(&[
                    "split-window",
                    direction,
                    "-t",
                    target,
                    "-l",
                    &format!("{percentage}%"),
                ]))
            }
        }
    }
}

fn execute_terminal_commands(
    terminals: &[crate::core::EmittedTerminal],
    executor: &mut dyn CommandExecutor,
    pane_map: &mut IndexMap<String, String>,
    focus_virtual: &str,
) -> Result<(), CoreError> {
    resolve_pane(pane_map, focus_virtual, "Unknown focus pane")?;
    for terminal in terminals {
        resolve_pane(pane_map, &terminal.virtual_pane_id, "Unknown terminal pane")?;
    }
    let prepared = prepare_terminal_commands(terminals, focus_virtual, pane_map)?;
    for set in prepared.commands {
        if let Some(cwd) = set.cwd_command.as_deref() {
            send_keys(
                executor,
                &set.real_pane_id,
                cwd,
                &set.terminal.virtual_pane_id,
            )?;
        }
        for env in set.env_commands {
            send_keys(
                executor,
                &set.real_pane_id,
                &env.command,
                &set.terminal.virtual_pane_id,
            )?;
        }
        if let Some(title) = set.title.as_deref() {
            execute_command(
                executor,
                vec!["select-pane", "-t", &set.real_pane_id, "-T", title],
                "TMUX_COMMAND_FAILED",
                "Failed to set pane title",
                &set.terminal.virtual_pane_id,
            )?;
        }
        if let Some(command) = set.command {
            wait_for_terminal_delay(
                command.delay_ms,
                executor.is_dry_run(),
                &set.terminal.virtual_pane_id,
            )?;
            send_keys(
                executor,
                &set.real_pane_id,
                &command.text,
                &set.terminal.virtual_pane_id,
            )?;
        }
    }
    Ok(())
}

fn send_keys(
    executor: &mut dyn CommandExecutor,
    pane: &str,
    command: &str,
    path: &str,
) -> Result<(), CoreError> {
    execute_command(
        executor,
        vec!["send-keys", "-t", pane, command, "Enter"],
        "TMUX_COMMAND_FAILED",
        "Failed to send command to pane",
        path,
    )?;
    Ok(())
}

fn resolve_current_pane(
    executor: &mut dyn CommandExecutor,
    env_pane: Option<&str>,
    dry_run: bool,
    path: &str,
) -> Result<String, CoreError> {
    if let Some(pane) = env_pane.map(str::trim).filter(|pane| !pane.is_empty()) {
        return Ok(normalize_pane_id(pane));
    }
    if dry_run {
        return Ok("%0".to_owned());
    }
    let output = execute_command(
        executor,
        vec!["display-message", "-p", "#{pane_id}"],
        "TMUX_COMMAND_FAILED",
        "Failed to resolve current tmux pane",
        path,
    )?;
    if output.trim().is_empty() {
        return Err(execution_error(
            "NOT_IN_TMUX_SESSION",
            "Unable to determine current tmux pane",
            path,
        ));
    }
    Ok(normalize_pane_id(&output))
}

fn query_pane_size(
    executor: &mut dyn CommandExecutor,
    pane: &str,
    include_sidebar_flag: bool,
) -> Option<(PaneDimensions, Option<bool>)> {
    let format = if include_sidebar_flag {
        CURRENT_PANE_SIZE_FORMAT
    } else {
        PANE_SIZE_FORMAT
    };
    let output = executor
        .execute(&strings(&["display-message", "-p", "-t", pane, format]))
        .ok()?;
    let mut fields = output.split_whitespace();
    let cols = parse_positive_integer_prefix(fields.next()?)?;
    let rows = parse_positive_integer_prefix(fields.next()?)?;
    let sidebar = include_sidebar_flag.then(|| fields.next().unwrap_or_default() == "1");
    Some((PaneDimensions { cols, rows }, sidebar))
}

fn parse_positive_integer_prefix(raw: &str) -> Option<u64> {
    let unsigned = raw
        .trim_start()
        .strip_prefix('+')
        .unwrap_or(raw.trim_start());
    let digits = unsigned
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u64>().ok().filter(|value| *value > 0)
}

fn split_beside_sidebar(
    executor: &mut dyn CommandExecutor,
    sidebar: &str,
    path: &str,
) -> Result<String, CoreError> {
    let output = execute_command(
        executor,
        vec![
            "split-window",
            "-h",
            "-P",
            "-F",
            "#{pane_id}",
            "-t",
            sidebar,
        ],
        "TMUX_COMMAND_FAILED",
        "Failed to split a pane beside the sidebar",
        path,
    )?;
    let pane = output.trim();
    if pane.is_empty() {
        Err(execution_error(
            "INVALID_PANE",
            "Unable to determine the pane created beside the sidebar",
            path,
        ))
    } else {
        Ok(pane.to_owned())
    }
}

fn list_pane_ids(executor: &mut dyn CommandExecutor, path: &str) -> Result<Vec<String>, CoreError> {
    let output = execute_command(
        executor,
        vec!["list-panes", "-F", "#{pane_id}"],
        "TMUX_COMMAND_FAILED",
        "Failed to list tmux panes",
        path,
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|pane| !pane.is_empty())
        .map(str::to_owned)
        .collect())
}

fn resolve_pane(
    pane_map: &mut IndexMap<String, String>,
    virtual_id: &str,
    message: &str,
) -> Result<String, CoreError> {
    resolve_pane_mapping(pane_map, virtual_id).ok_or_else(|| {
        execution_error(
            "INVALID_PANE",
            format!("{message}: {virtual_id}"),
            virtual_id,
        )
    })
}

fn normalize_pane_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "%0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn execute_command(
    executor: &mut dyn CommandExecutor,
    command: Vec<&str>,
    code: &str,
    message: &str,
    path: &str,
) -> Result<String, CoreError> {
    execute_command_owned(
        executor,
        &command.into_iter().map(str::to_owned).collect::<Vec<_>>(),
        code,
        message,
        path,
    )
}

fn execute_command_owned(
    executor: &mut dyn CommandExecutor,
    command: &[String],
    code: &str,
    message: &str,
    path: &str,
) -> Result<String, CoreError> {
    executor.execute(command).map_err(|mut error| {
        if error.code.is_empty() {
            error.code = code.to_owned();
        }
        if error.message.is_empty() {
            error.message = message.to_owned();
        }
        error.path = Some(path.to_owned());
        if error.details.is_empty() {
            error.details.insert("command".to_owned(), json!(command));
        }
        error
    })
}

fn execution_error(code: &str, message: impl Into<String>, path: &str) -> CoreError {
    CoreError::new(CoreErrorKind::Execution, code, message).with_path(path)
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}
