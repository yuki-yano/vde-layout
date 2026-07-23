mod hook;
mod logger;
mod selector;

use std::ffi::OsString;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use indexmap::IndexMap;
use serde_json::Value;

use crate::core::{
    CoreError, CoreErrorKind, compile_preset_from_value, create_layout_plan, emit_plan,
};
use crate::error::{ErrorCode, ErrorKind, VdeError, format_error};
use crate::executor::{
    ApplyHerdrPlanResult, ApplyTmuxPlanResult, ApplyWeztermPlanResult, CommandExecutor,
    ExecuteHerdrPlanOptions, ExecuteTmuxPlanOptions, ExecuteWeztermPlanOptions,
    ProcessCommandExecutor, WeztermDryRunOptions, apply_tmux_plan, build_herdr_dry_run_steps,
    build_tmux_dry_run_steps, build_wezterm_dry_run_steps, execute_herdr_plan,
    execute_wezterm_plan, resolve_initial_tmux_pane_size, resolve_initial_wezterm_pane_size,
    verify_herdr_environment, verify_tmux_environment, verify_wezterm_environment,
};
use crate::model::{Preset, SelectSurfaceMode, SelectUiMode, TerminalBackendKind, WindowMode};
use crate::preset::PresetManager;

pub use hook::{AfterApplyHookContext, run_after_apply_hook};
pub use logger::{CliLogger, LogLevel};
use selector::select_preset;
pub use selector::{
    PresetSelectorRow, SelectPresetResult, SelectorError, SelectorOptions, build_fzf_args,
    build_preset_preview_yaml, build_selector_rows, decode_preview_payload,
};

const EXIT_CODE_ERROR: i32 = 1;
const EXIT_CODE_CANCELLED: i32 = 130;

#[derive(Debug, Parser)]
#[command(
    name = "vde-layout",
    version,
    disable_version_flag = true,
    about = "VDE (Vibrant Development Environment) Layout Manager - terminal pane layout management tool"
)]
struct CliArguments {
    #[arg(value_name = "PRESET")]
    preset: Option<String>,

    #[arg(long, global = true, help = "Show detailed logs")]
    verbose: bool,

    #[arg(
        long = "dry-run",
        global = true,
        help = "Display commands without executing"
    )]
    dry_run: bool,

    #[arg(long, global = true, value_enum, help = "Select terminal backend")]
    backend: Option<CliBackend>,

    #[arg(
        long,
        global = true,
        value_name = "PATH",
        help = "Path to configuration file"
    )]
    config: Option<PathBuf>,

    #[arg(
        long = "current-window",
        global = true,
        conflicts_with = "new_window",
        help = "Apply the layout to the current window"
    )]
    current_window: bool,

    #[arg(
        long = "new-window",
        global = true,
        conflicts_with = "current_window",
        help = "Create a new window for the layout"
    )]
    new_window: bool,

    #[arg(long, global = true, help = "Select preset from interactive UI")]
    select: bool,

    #[arg(
        long = "select-ui",
        global = true,
        value_enum,
        requires = "select",
        help = "Choose the interactive selector implementation"
    )]
    select_ui: Option<CliSelectUi>,

    #[arg(
        long = "select-surface",
        global = true,
        value_enum,
        requires = "select",
        help = "Choose where the selector is displayed"
    )]
    select_surface: Option<CliSelectSurface>,

    #[arg(
        long = "select-tmux-popup-opts",
        global = true,
        requires = "select",
        help = "Pass options to the tmux popup selector"
    )]
    select_tmux_popup_opts: Option<String>,

    #[arg(
        long = "fzf-arg",
        global = true,
        requires = "select",
        action = ArgAction::Append,
        allow_hyphen_values = true
    )]
    fzf_args: Vec<String>,

    #[arg(short = 'v', long = "version", global = true)]
    version: bool,

    #[command(subcommand)]
    command: Option<CliCommand>,
}

#[derive(Debug, Subcommand)]
enum CliCommand {
    /// List available presets
    List,
    #[command(name = "__preview", hide = true)]
    Preview { payload: String },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliBackend {
    Tmux,
    Wezterm,
    Herdr,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliSelectUi {
    Auto,
    Fzf,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliSelectSurface {
    Auto,
    Inline,
    TmuxPopup,
}

#[derive(Debug)]
enum AppError {
    Vde(VdeError),
    Core(CoreError),
    Message(String),
}

#[derive(Debug, Clone, Copy)]
struct ExecutionSummary {
    executed_steps: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowModeResolution {
    mode: WindowMode,
    source: &'static str,
}

struct BackendResult {
    summary: ExecutionSummary,
    focus_pane_id: Option<String>,
    pane_name_to_real_id: IndexMap<String, String>,
    window_id: Option<String>,
}

struct LoggingExecutor {
    process: ProcessCommandExecutor,
    logger: CliLogger,
    backend: &'static str,
}

impl LoggingExecutor {
    fn new(binary: &'static str, dry_run: bool, logger: &CliLogger) -> Self {
        Self {
            process: ProcessCommandExecutor::new(binary).dry_run(dry_run),
            logger: logger.clone(),
            backend: binary,
        }
    }
}

impl CommandExecutor for LoggingExecutor {
    fn execute(&mut self, args: &[String]) -> Result<String, CoreError> {
        self.logger.info(format!(
            "[{}] {}",
            self.backend,
            self.process.command_string(args)
        ));
        self.process.execute(args)
    }

    fn is_dry_run(&self) -> bool {
        self.process.is_dry_run()
    }
}

pub fn run_cli() -> i32 {
    run_cli_from(std::env::args_os())
}

pub fn run_cli_from<I, T>(arguments: I) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let raw = arguments
        .into_iter()
        .map(Into::into)
        .collect::<Vec<OsString>>();
    let mut normalized = normalize_select_args(raw);
    if let Some(program_name) = normalized.first_mut() {
        *program_name = OsString::from("vde-layout");
    }
    let parsed = match CliArguments::try_parse_from(normalized) {
        Ok(parsed) => parsed,
        Err(error) => {
            let kind = error.kind();
            let _ = error.print();
            return if matches!(
                kind,
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) {
                0
            } else {
                EXIT_CODE_ERROR
            };
        }
    };
    if parsed.version {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    if let Some(CliCommand::Preview { payload }) = parsed.command.as_ref() {
        return match decode_preview_payload(payload) {
            Ok(decoded) => match std::io::stdout().write_all(&decoded) {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("Error: {error}");
                    EXIT_CODE_ERROR
                }
            },
            Err(error) => {
                print_selector_error(error);
                EXIT_CODE_ERROR
            }
        };
    }
    let logger = CliLogger::from_environment(parsed.verbose);
    match run_parsed_cli(parsed, &logger) {
        Ok(code) => code,
        Err(error) => print_app_error(error),
    }
}

fn run_parsed_cli(parsed: CliArguments, logger: &CliLogger) -> Result<i32, AppError> {
    if parsed.command.is_some() && parsed.preset.is_some() {
        return Err(AppError::Message(
            "too many arguments. Expected at most 1 argument".to_owned(),
        ));
    }
    let mut preset_manager = PresetManager::default();
    if let Some(path) = parsed.config.as_ref() {
        preset_manager.set_config_path(path);
    }
    if matches!(parsed.command, Some(CliCommand::List)) {
        preset_manager.load_config().map_err(AppError::Vde)?;
        let presets = preset_manager.list_presets();
        if presets.is_empty() {
            logger.warn("No presets defined");
            return Ok(0);
        }
        println!("Available presets:\n");
        let width = presets
            .iter()
            .map(|preset| preset.key.len())
            .max()
            .unwrap_or(0)
            + 2;
        for preset in presets {
            println!(
                "  {:width$} {}",
                preset.key,
                preset.description.unwrap_or_default(),
                width = width
            );
        }
        return Ok(0);
    }

    preset_manager.load_config().map_err(AppError::Vde)?;
    let mut preset_name = parsed.preset.clone();
    if parsed.select {
        if preset_name.is_some() {
            return Err(AppError::Message(
                "Cannot use preset argument with --select".to_owned(),
            ));
        }
        let defaults = preset_manager
            .get_defaults()
            .map_err(AppError::Vde)?
            .cloned();
        let selector_defaults = defaults.and_then(|defaults| defaults.selector);
        let ui_mode = parsed
            .select_ui
            .map(Into::into)
            .or_else(|| selector_defaults.as_ref().and_then(|selector| selector.ui))
            .unwrap_or(SelectUiMode::Auto);
        let surface_mode = parsed
            .select_surface
            .map(Into::into)
            .or_else(|| {
                selector_defaults
                    .as_ref()
                    .and_then(|selector| selector.surface)
            })
            .unwrap_or(SelectSurfaceMode::Auto);
        let popup = parsed.select_tmux_popup_opts.clone().or_else(|| {
            selector_defaults
                .as_ref()
                .and_then(|selector| selector.tmux_popup_opts.clone())
        });
        let mut extra = selector_defaults
            .and_then(|selector| selector.fzf)
            .and_then(|fzf| fzf.extra_args)
            .unwrap_or_default();
        extra.extend(parsed.fzf_args.clone());
        let selection = select_preset(
            &preset_manager,
            &SelectorOptions {
                ui_mode,
                surface_mode,
                tmux_popup_options: popup,
                fzf_extra_args: extra,
                cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
                current_exe: std::env::current_exe()
                    .map_err(|error| AppError::Message(error.to_string()))?,
                in_tmux: environment_is_set("TMUX"),
            },
            logger,
        )
        .map_err(app_error_from_selector)?;
        match selection {
            SelectPresetResult::Selected(selected) => preset_name = Some(selected),
            SelectPresetResult::Cancelled => return Ok(EXIT_CODE_CANCELLED),
        }
    }

    let preset = match preset_name.as_deref() {
        Some(name) => preset_manager.get_preset(name).map_err(AppError::Vde)?,
        None => preset_manager.get_default_preset().map_err(AppError::Vde)?,
    }
    .clone();
    let defaults = preset_manager
        .get_defaults()
        .map_err(AppError::Vde)?
        .cloned();
    execute_preset(
        preset_name.as_deref(),
        &preset,
        defaults.as_ref(),
        &parsed,
        logger,
    )
}

fn execute_preset(
    preset_name: Option<&str>,
    preset: &Preset,
    defaults: Option<&crate::model::ConfigDefaults>,
    arguments: &CliArguments,
    logger: &CliLogger,
) -> Result<i32, AppError> {
    let window_mode = resolve_window_mode(arguments, preset, defaults)?;
    logger.info(format!(
        "Window mode: {} (source: {})",
        window_mode.mode, window_mode.source
    ));
    let backend = arguments
        .backend
        .map(Into::into)
        .or(preset.backend)
        .unwrap_or(TerminalBackendKind::Tmux);
    let backend_name = match backend {
        TerminalBackendKind::Tmux => "tmux",
        TerminalBackendKind::Wezterm => "wezterm",
        TerminalBackendKind::Herdr => "herdr",
    };
    logger.info(format!("Terminal backend: {backend_name}"));

    let detected_version = if arguments.dry_run {
        println!("[DRY RUN] No actual commands will be executed");
        None
    } else {
        verify_backend_environment(backend, logger)?
    };

    let value = serde_json::to_value(preset)
        .map_err(|error| AppError::Message(format!("Failed to serialize preset: {error}")))?;
    let source = preset_name
        .filter(|name| !name.is_empty())
        .map(|name| format!("preset://{name}"))
        .unwrap_or_else(|| "preset://default".to_owned());
    let compiled = compile_preset_from_value(&value, source).map_err(AppError::Core)?;
    let plan = create_layout_plan(&compiled).map_err(AppError::Core)?;
    let emission = emit_plan(&plan).map_err(AppError::Core)?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    if arguments.dry_run {
        render_dry_run(backend, &emission, logger)?;
        if let Some(hook) = compiled
            .hooks
            .as_ref()
            .and_then(|hooks| hooks.after_apply.as_deref())
        {
            println!("\nPlanned hooks (dry-run)");
            println!(" 1. [afterApply] {hook}");
        }
        logger.success(format!("Applied preset \"{}\"", preset.name));
        return Ok(0);
    }

    let result = apply_backend(
        backend,
        &emission,
        window_mode.mode,
        &preset.name,
        &cwd,
        detected_version.as_deref(),
        logger,
    )?;
    logger.info(format!(
        "Executed {} {} steps",
        result.summary.executed_steps,
        match backend {
            TerminalBackendKind::Tmux => "tmux",
            TerminalBackendKind::Wezterm => "wezterm",
            TerminalBackendKind::Herdr => "herdr",
        }
    ));
    run_after_apply_hook(
        compiled
            .hooks
            .as_ref()
            .and_then(|hooks| hooks.after_apply.as_deref()),
        &AfterApplyHookContext {
            cwd: &cwd,
            focus_pane_id: result.focus_pane_id.as_deref(),
            pane_name_to_real_id: &result.pane_name_to_real_id,
            window_id: result.window_id.as_deref(),
        },
        logger,
    );
    logger.success(format!("Applied preset \"{}\"", preset.name));
    Ok(0)
}

fn verify_backend_environment(
    backend: TerminalBackendKind,
    logger: &CliLogger,
) -> Result<Option<String>, AppError> {
    match backend {
        TerminalBackendKind::Tmux => {
            let mut executor = LoggingExecutor::new("tmux", false, logger);
            verify_tmux_environment(&mut executor, environment_is_set("TMUX"))
                .map_err(AppError::Core)
        }
        TerminalBackendKind::Wezterm => {
            let mut executor = LoggingExecutor::new("wezterm", false, logger);
            verify_wezterm_environment(&mut executor, false).map_err(AppError::Core)
        }
        TerminalBackendKind::Herdr => {
            let mut executor = LoggingExecutor::new("herdr", false, logger);
            verify_herdr_environment(&mut executor, false).map_err(AppError::Core)
        }
    }
}

fn render_dry_run(
    backend: TerminalBackendKind,
    emission: &crate::core::PlanEmission,
    logger: &CliLogger,
) -> Result<(), AppError> {
    println!("\nPlanned terminal steps (dry-run)");
    match backend {
        TerminalBackendKind::Tmux => {
            let mut query = LoggingExecutor::new("tmux", false, logger);
            let size = resolve_initial_tmux_pane_size(
                &mut query,
                std::env::var("TMUX").ok().as_deref(),
                std::env::var("TMUX_PANE").ok().as_deref(),
            );
            for (index, step) in build_tmux_dry_run_steps(emission, size, None)
                .map_err(AppError::Core)?
                .into_iter()
                .enumerate()
            {
                println!(" {}. [tmux] {}: {}", index + 1, step.summary, step.command);
            }
        }
        TerminalBackendKind::Wezterm => {
            let mut query = LoggingExecutor::new("wezterm", false, logger);
            let pane_id = std::env::var("WEZTERM_PANE").ok();
            let size = resolve_initial_wezterm_pane_size(&mut query, pane_id.as_deref());
            let options = WeztermDryRunOptions {
                initial_pane_id: Some(emission.summary.initial_pane_id.clone()),
                initial_pane_size: size,
                detected_version: None,
            };
            for (index, step) in build_wezterm_dry_run_steps(emission, &options)
                .map_err(AppError::Core)?
                .into_iter()
                .enumerate()
            {
                println!(
                    " {}. [wezterm] {}: {}",
                    index + 1,
                    step.summary,
                    step.command
                );
            }
        }
        TerminalBackendKind::Herdr => {
            for (index, step) in build_herdr_dry_run_steps(emission)
                .map_err(AppError::Core)?
                .into_iter()
                .enumerate()
            {
                println!(" {}. [herdr] {}: {}", index + 1, step.summary, step.command);
            }
        }
    }
    Ok(())
}

fn apply_backend(
    backend: TerminalBackendKind,
    emission: &crate::core::PlanEmission,
    window_mode: WindowMode,
    window_name: &str,
    cwd: &Path,
    detected_version: Option<&str>,
    logger: &CliLogger,
) -> Result<BackendResult, AppError> {
    match backend {
        TerminalBackendKind::Tmux => {
            let mut executor = LoggingExecutor::new("tmux", false, logger);
            let mut confirm =
                |panes: &[String], dry_run: bool| confirm_pane_kill(panes, dry_run, logger);
            let result = apply_tmux_plan(
                emission,
                &mut executor,
                ExecuteTmuxPlanOptions {
                    window_mode,
                    window_name: Some(window_name),
                    tmux_pane: std::env::var("TMUX_PANE").ok().as_deref(),
                    detected_version,
                    on_confirm_kill: Some(&mut confirm),
                },
            )
            .map_err(AppError::Core)?;
            Ok(tmux_backend_result(result))
        }
        TerminalBackendKind::Wezterm => {
            let mut executor = LoggingExecutor::new("wezterm", false, logger);
            let mut confirm =
                |panes: &[String], dry_run: bool| confirm_pane_kill(panes, dry_run, logger);
            let pane_id = std::env::var("WEZTERM_PANE").ok();
            let result = execute_wezterm_plan(
                emission,
                &mut executor,
                ExecuteWeztermPlanOptions {
                    window_mode,
                    cwd: cwd.to_str(),
                    pane_id: pane_id.as_deref(),
                    detected_version,
                    on_confirm_kill: Some(&mut confirm),
                },
            )
            .map_err(AppError::Core)?;
            Ok(wezterm_backend_result(result))
        }
        TerminalBackendKind::Herdr => {
            let mut executor = LoggingExecutor::new("herdr", false, logger);
            let mut confirm =
                |panes: &[String], dry_run: bool| confirm_pane_kill(panes, dry_run, logger);
            let pane_id = std::env::var("HERDR_PANE_ID").ok();
            let workspace_id = std::env::var("HERDR_WORKSPACE_ID").ok();
            let result = execute_herdr_plan(
                emission,
                &mut executor,
                ExecuteHerdrPlanOptions {
                    window_mode,
                    cwd: cwd.to_str(),
                    pane_id: pane_id.as_deref(),
                    workspace_id: workspace_id.as_deref(),
                    window_name: Some(window_name),
                    on_confirm_kill: Some(&mut confirm),
                },
            )
            .map_err(AppError::Core)?;
            Ok(herdr_backend_result(result))
        }
    }
}

fn tmux_backend_result(result: ApplyTmuxPlanResult) -> BackendResult {
    BackendResult {
        summary: ExecutionSummary {
            executed_steps: result.executed_steps,
        },
        focus_pane_id: result.focus_pane_id,
        pane_name_to_real_id: result.pane_name_to_real_id,
        window_id: result.window_id,
    }
}

fn wezterm_backend_result(result: ApplyWeztermPlanResult) -> BackendResult {
    BackendResult {
        summary: ExecutionSummary {
            executed_steps: result.executed_steps,
        },
        focus_pane_id: result.focus_pane_id,
        pane_name_to_real_id: result.pane_name_to_real_id,
        window_id: Some(result.window_id),
    }
}

fn herdr_backend_result(result: ApplyHerdrPlanResult) -> BackendResult {
    BackendResult {
        summary: ExecutionSummary {
            executed_steps: result.executed_steps,
        },
        focus_pane_id: result.focus_pane_id,
        pane_name_to_real_id: result.pane_name_to_real_id,
        window_id: Some(result.window_id),
    }
}

fn resolve_window_mode(
    arguments: &CliArguments,
    preset: &Preset,
    defaults: Option<&crate::model::ConfigDefaults>,
) -> Result<WindowModeResolution, AppError> {
    if arguments.current_window && arguments.new_window {
        return Err(AppError::Message(
            "Cannot use --current-window and --new-window at the same time".to_owned(),
        ));
    }
    Ok(if arguments.current_window {
        WindowModeResolution {
            mode: WindowMode::CurrentWindow,
            source: "cli",
        }
    } else if arguments.new_window {
        WindowModeResolution {
            mode: WindowMode::NewWindow,
            source: "cli",
        }
    } else if let Some(mode) = preset.window_mode {
        WindowModeResolution {
            mode,
            source: "preset",
        }
    } else if let Some(mode) = defaults.and_then(|defaults| defaults.window_mode) {
        WindowModeResolution {
            mode,
            source: "defaults",
        }
    } else {
        WindowModeResolution {
            mode: WindowMode::NewWindow,
            source: "fallback",
        }
    })
}

fn confirm_pane_kill(panes: &[String], dry_run: bool, logger: &CliLogger) -> bool {
    if panes.is_empty() {
        return true;
    }
    let pane_list = panes.join(", ");
    if dry_run {
        logger.warn(format!("[DRY RUN] Would close panes: {pane_list}"));
        return true;
    }
    logger.warn(format!(
        "This operation will close the following panes: {pane_list}"
    ));
    if !(std::io::stdin().is_terminal() && std::io::stdout().is_terminal()) {
        eprintln!("Error: Cannot prompt for confirmation because the terminal is not interactive");
        return false;
    }
    print!("Continue? [y/N]: ");
    let _ = std::io::stdout().flush();
    let mut answer = String::new();
    if std::io::stdin().read_line(&mut answer).is_err() {
        return false;
    }
    matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
}

fn normalize_select_args(arguments: Vec<OsString>) -> Vec<OsString> {
    let mut normalized = Vec::with_capacity(arguments.len() + 2);
    let mut iterator = arguments.into_iter().peekable();
    if let Some(program) = iterator.next() {
        normalized.push(program);
    }
    while let Some(argument) = iterator.next() {
        if argument == "--" {
            normalized.push(argument);
            normalized.extend(iterator);
            break;
        }
        let Some(text) = argument.to_str() else {
            normalized.push(argument);
            continue;
        };
        if let Some(value) = text.strip_prefix("--select=") {
            normalized.push("--select".into());
            if !value.is_empty() {
                normalized.push("--select-ui".into());
                normalized.push(value.into());
            }
            continue;
        }
        if text == "--select"
            && iterator
                .peek()
                .and_then(|value| value.to_str())
                .is_some_and(|value| matches!(value, "auto" | "fzf"))
        {
            normalized.push("--select".into());
            normalized.push("--select-ui".into());
            normalized.push(iterator.next().expect("peeked argument must exist"));
            continue;
        }
        normalized.push(argument);
    }
    normalized
}

fn environment_is_set(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
}

fn app_error_from_selector(error: SelectorError) -> AppError {
    match error {
        SelectorError::Message(message) => AppError::Message(message),
        SelectorError::Vde(error) => AppError::Vde(error),
    }
}

fn print_selector_error(error: SelectorError) {
    match app_error_from_selector(error) {
        AppError::Vde(error) => eprintln!("{}", format_error(&error)),
        AppError::Message(message) => eprintln!("Error: {message}"),
        AppError::Core(_) => unreachable!(),
    }
}

fn print_app_error(error: AppError) -> i32 {
    if std::env::var("VDE_DEBUG").as_deref() == Ok("true") {
        eprintln!("Debug: {error:#?}");
    }
    match error {
        AppError::Vde(error) => {
            eprintln!("{}", format_error(&error));
            if error.code == ErrorCode::UserCancelled {
                EXIT_CODE_CANCELLED
            } else {
                EXIT_CODE_ERROR
            }
        }
        AppError::Core(error) => {
            eprintln!("{}", format_core_error(&error));
            if error.code == "USER_CANCELLED" {
                EXIT_CODE_CANCELLED
            } else {
                EXIT_CODE_ERROR
            }
        }
        AppError::Message(message) => {
            eprintln!("Error: {message}");
            EXIT_CODE_ERROR
        }
    }
}

fn format_core_error(error: &CoreError) -> String {
    let kind = match error.kind {
        CoreErrorKind::Compile => "compile",
        CoreErrorKind::Plan => "plan",
        CoreErrorKind::Emit => "emit",
        CoreErrorKind::Execution => "execution",
    };
    let mut header = format!("[{kind}] [{}]", error.code);
    if let Some(path) = error.path.as_deref().filter(|path| !path.is_empty()) {
        header.push_str(&format!(" [{path}]"));
    }
    let mut output = format!("Error: {header} {}", error.message);
    if let Some(source) = error.source.as_deref().filter(|source| !source.is_empty()) {
        output.push_str(&format!("\nsource: {source}"));
    }
    if let Some(command) = error.details.get("command") {
        let text = match command {
            Value::Array(values) => values
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
            Value::String(command) => command.clone(),
            _ => command.to_string(),
        };
        if !text.is_empty() {
            output.push_str(&format!("\ncommand: {text}"));
        }
    }
    if let Some(stderr) = error.details.get("stderr") {
        output.push_str(&format!(
            "\nstderr: {}",
            stderr.as_str().unwrap_or(&stderr.to_string())
        ));
    }
    if let Some(code) = error_code_from_str(&error.code) {
        let guidance = format_error(&VdeError::new(
            ErrorKind::Execution,
            code,
            &error.message,
            (*error.details).clone(),
        ));
        let first_line = format!("Error: {}", error.message);
        if let Some(extra) = guidance.strip_prefix(&first_line)
            && !extra.is_empty()
        {
            output.push_str(extra);
        }
    }
    output
}

fn error_code_from_str(code: &str) -> Option<ErrorCode> {
    Some(match code {
        "CONFIG_NOT_FOUND" => ErrorCode::ConfigNotFound,
        "CONFIG_PARSE_ERROR" => ErrorCode::ConfigParseError,
        "CONFIG_PERMISSION_ERROR" => ErrorCode::ConfigPermissionError,
        "INVALID_PRESET" => ErrorCode::InvalidPreset,
        "PRESET_NOT_FOUND" => ErrorCode::PresetNotFound,
        "INVALID_LAYOUT" => ErrorCode::InvalidLayout,
        "INVALID_PANE" => ErrorCode::InvalidPane,
        "INVALID_PLAN" => ErrorCode::InvalidPlan,
        "MISSING_TARGET" => ErrorCode::MissingTarget,
        "TMUX_NOT_RUNNING" => ErrorCode::TmuxNotRunning,
        "TMUX_COMMAND_FAILED" => ErrorCode::TmuxCommandFailed,
        "NOT_IN_TMUX_SESSION" => ErrorCode::NotInTmuxSession,
        "TMUX_NOT_FOUND" => ErrorCode::TmuxNotFound,
        "TMUX_NOT_INSTALLED" => ErrorCode::TmuxNotInstalled,
        "UNSUPPORTED_TMUX_VERSION" => ErrorCode::UnsupportedTmuxVersion,
        "BACKEND_NOT_FOUND" => ErrorCode::BackendNotFound,
        "TERMINAL_COMMAND_FAILED" => ErrorCode::TerminalCommandFailed,
        "TEMPLATE_TOKEN_ERROR" => ErrorCode::TemplateTokenError,
        "WEZTERM_NOT_FOUND" => ErrorCode::WeztermNotFound,
        "UNSUPPORTED_WEZTERM_VERSION" => ErrorCode::UnsupportedWeztermVersion,
        "HERDR_NOT_FOUND" => ErrorCode::HerdrNotFound,
        "UNSUPPORTED_HERDR_VERSION" => ErrorCode::UnsupportedHerdrVersion,
        "USER_CANCELLED" => ErrorCode::UserCancelled,
        "SPLIT_SIZE_RESOLUTION_FAILED" => ErrorCode::SplitSizeResolutionFailed,
        _ => return None,
    })
}

impl From<CliBackend> for TerminalBackendKind {
    fn from(value: CliBackend) -> Self {
        match value {
            CliBackend::Tmux => Self::Tmux,
            CliBackend::Wezterm => Self::Wezterm,
            CliBackend::Herdr => Self::Herdr,
        }
    }
}

impl From<CliSelectUi> for SelectUiMode {
    fn from(value: CliSelectUi) -> Self {
        match value {
            CliSelectUi::Auto => Self::Auto,
            CliSelectUi::Fzf => Self::Fzf,
        }
    }
}

impl From<CliSelectSurface> for SelectSurfaceMode {
    fn from(value: CliSelectSurface) -> Self {
        match value {
            CliSelectSurface::Auto => Self::Auto,
            CliSelectSurface::Inline => Self::Inline,
            CliSelectSurface::TmuxPopup => Self::TmuxPopup,
        }
    }
}
