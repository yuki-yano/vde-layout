use std::process::Command;

use serde_json::json;

use crate::core::{CoreError, CoreErrorKind};

pub trait CommandExecutor {
    fn execute(&mut self, args: &[String]) -> Result<String, CoreError>;
    fn is_dry_run(&self) -> bool;
}

#[derive(Debug, Clone)]
pub struct ProcessCommandExecutor {
    binary: String,
    leading_args: Vec<String>,
    dry_run: bool,
}

impl ProcessCommandExecutor {
    pub fn new(binary: impl Into<String>) -> Self {
        Self {
            binary: binary.into(),
            leading_args: Vec::new(),
            dry_run: false,
        }
    }

    pub fn with_leading_args(mut self, args: impl IntoIterator<Item = String>) -> Self {
        self.leading_args = args.into_iter().collect();
        self
    }

    pub fn dry_run(mut self, dry_run: bool) -> Self {
        self.dry_run = dry_run;
        self
    }

    pub fn command_string(&self, args: &[String]) -> String {
        std::iter::once(self.binary.as_str())
            .chain(self.leading_args.iter().map(String::as_str))
            .chain(args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

impl CommandExecutor for ProcessCommandExecutor {
    fn execute(&mut self, args: &[String]) -> Result<String, CoreError> {
        if self.dry_run {
            return Ok(String::new());
        }
        let output = Command::new(&self.binary)
            .args(&self.leading_args)
            .args(args)
            .output()
            .map_err(|error| {
                CoreError::new(
                    CoreErrorKind::Execution,
                    "TMUX_COMMAND_FAILED",
                    "Failed to execute tmux command",
                )
                .with_details(
                    json!({
                        "command": self.command_string(args),
                        "stderr": error.to_string(),
                        "binary": self.binary,
                        "ioErrorKind": format!("{:?}", error.kind()),
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
                )
            })?;
        if !output.status.success() {
            return Err(CoreError::new(
                CoreErrorKind::Execution,
                "TMUX_COMMAND_FAILED",
                "Failed to execute tmux command",
            )
            .with_details(
                json!({
                    "command": self.command_string(args),
                    "exitCode": output.status.code(),
                    "stderr": String::from_utf8_lossy(&output.stderr),
                })
                .as_object()
                .cloned()
                .unwrap_or_default(),
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_owned())
    }

    fn is_dry_run(&self) -> bool {
        self.dry_run
    }
}
