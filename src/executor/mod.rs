mod command;
mod herdr;
mod split;
mod template;
mod terminal;
mod tmux;
mod wezterm;
mod wezterm_list;

pub use command::{CommandExecutor, ProcessCommandExecutor};
pub use herdr::{
    ApplyHerdrPlanResult, ConfirmHerdrKillCallback, ExecuteHerdrPlanOptions, HERDR_MINIMUM_VERSION,
    HerdrDryRunStep, build_herdr_dry_run_steps, execute_herdr_plan, run_herdr_cli,
    verify_herdr_environment,
};
pub use split::{
    ResolvedSplitSize, SplitSizeResolutionContext, resolve_split_orientation,
    resolve_split_percentage, resolve_split_size,
};
pub use template::{TemplateTokenError, build_name_to_real_id_map, replace_template_tokens};
pub use terminal::{
    MAX_TIMER_DELAY_MS, PreparedCommand, PreparedEnvCommand, PreparedTerminalCommand,
    PreparedTerminalCommands, prepare_terminal_commands, resolve_pane_mapping, shell_quote_literal,
    wait_for_terminal_delay,
};
pub use tmux::{
    ApplyTmuxPlanResult, ConfirmKillCallback, ExecuteTmuxPlanOptions, ExecuteTmuxPlanResult,
    PaneDimensions, SIDEBAR_LIST_PANES_FORMAT, TmuxDryRunStep, apply_tmux_plan,
    build_tmux_dry_run_steps, classify_window_panes, execute_tmux_plan,
    resolve_initial_tmux_pane_size, verify_tmux_environment,
};
pub use wezterm::{
    ApplyWeztermPlanResult, ConfirmWeztermKillCallback, ExecuteWeztermPlanOptions,
    WEZTERM_MINIMUM_VERSION, WeztermDryRunOptions, WeztermDryRunStep, build_wezterm_dry_run_steps,
    collect_pane_ids_for_window, execute_wezterm_plan, list_wezterm_windows,
    resolve_initial_wezterm_pane_size, run_wezterm_cli, verify_wezterm_environment,
};
pub use wezterm_list::{
    WeztermListPane, WeztermListResult, WeztermListTab, WeztermListWindow, WeztermPaneSize,
    parse_wezterm_list_result,
};
