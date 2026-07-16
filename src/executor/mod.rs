mod command;
mod split;
mod template;
mod terminal;
mod tmux;

pub use command::{CommandExecutor, ProcessCommandExecutor};
pub use split::{
    ResolvedSplitSize, SplitSizeResolutionContext, resolve_split_orientation,
    resolve_split_percentage, resolve_split_size,
};
pub use template::{TemplateTokenError, build_name_to_real_id_map, replace_template_tokens};
pub use terminal::{
    PreparedCommand, PreparedEnvCommand, PreparedTerminalCommand, PreparedTerminalCommands,
    prepare_terminal_commands, shell_quote_literal,
};
pub use tmux::{
    ApplyTmuxPlanResult, ConfirmKillCallback, ExecuteTmuxPlanOptions, ExecuteTmuxPlanResult,
    PaneDimensions, SIDEBAR_LIST_PANES_FORMAT, TmuxDryRunStep, apply_tmux_plan,
    build_tmux_dry_run_steps, classify_window_panes, execute_tmux_plan,
    resolve_initial_tmux_pane_size, resolve_pane_mapping, verify_tmux_environment,
};
