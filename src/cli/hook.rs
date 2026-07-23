use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use indexmap::IndexMap;
use wait_timeout::ChildExt;

use crate::executor::replace_template_tokens;

use super::logger::CliLogger;

const AFTER_APPLY_HOOK_TIMEOUT: Duration = Duration::from_secs(30);

pub struct AfterApplyHookContext<'a> {
    pub cwd: &'a Path,
    pub focus_pane_id: Option<&'a str>,
    pub pane_name_to_real_id: &'a IndexMap<String, String>,
    pub window_id: Option<&'a str>,
}

pub fn run_after_apply_hook(
    hook_command: Option<&str>,
    context: &AfterApplyHookContext<'_>,
    logger: &CliLogger,
) {
    run_after_apply_hook_with_timeout(hook_command, context, logger, AFTER_APPLY_HOOK_TIMEOUT);
}

fn run_after_apply_hook_with_timeout(
    hook_command: Option<&str>,
    context: &AfterApplyHookContext<'_>,
    logger: &CliLogger,
    timeout: Duration,
) {
    let Some(command) = hook_command.filter(|command| !command.is_empty()) else {
        return;
    };
    if context.focus_pane_id.is_none()
        && (command.contains("{{this_pane}}") || command.contains("{{focus_pane}}"))
    {
        logger.warn(
            "hooks.afterApply skipped: failed to resolve template tokens ({{this_pane}}/{{focus_pane}} require a focus pane id, but none was available)",
        );
        return;
    }
    if context.window_id.is_none() && command.contains("{{window_id}}") {
        logger.warn(
            "hooks.afterApply skipped: failed to resolve template tokens ({{window_id}} requires a window id, but none was available)",
        );
        return;
    }
    let focus = context.focus_pane_id.unwrap_or_default();
    let resolved = match replace_template_tokens(
        command,
        focus,
        focus,
        context.pane_name_to_real_id,
        context.window_id,
    ) {
        Ok(resolved) => resolved,
        Err(error) => {
            logger.warn(format!(
                "hooks.afterApply skipped: failed to resolve template tokens ({})",
                error.message
            ));
            return;
        }
    };
    logger.info(format!("Executing: {resolved}"));
    let mut child = match Command::new("sh")
        .args(["-c", &resolved])
        .current_dir(context.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            logger.warn(format!("hooks.afterApply failed: {error}"));
            return;
        }
    };
    match child.wait_timeout(timeout) {
        Ok(Some(status)) if status.success() => {}
        Ok(Some(status)) => logger.warn(format!("hooks.afterApply failed: {status}")),
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            logger.warn(format!(
                "hooks.afterApply failed: command timed out after {} seconds",
                timeout.as_secs()
            ));
        }
        Err(error) => logger.warn(format!("hooks.afterApply failed: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use indexmap::IndexMap;
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn kills_a_hook_process_after_the_timeout() {
        let directory = TempDir::new().unwrap();
        let started = Instant::now();
        run_after_apply_hook_with_timeout(
            Some("exec sleep 5"),
            &AfterApplyHookContext {
                cwd: directory.path(),
                focus_pane_id: None,
                pane_name_to_real_id: &IndexMap::new(),
                window_id: None,
            },
            &CliLogger::from_environment(false),
            Duration::from_millis(20),
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
