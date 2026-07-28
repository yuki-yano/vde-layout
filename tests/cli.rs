use std::fs;
use std::os::unix::fs::PermissionsExt;

use assert_cmd::Command;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use predicates::prelude::*;
use tempfile::TempDir;

fn config() -> (TempDir, std::path::PathBuf) {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("layout.yml");
    fs::write(
        &path,
        r#"
defaults:
  windowMode: new-window
presets:
  default:
    name: Default Layout
    command: bash
  dev:
    name: Development
    description: Editor and logs
    layout:
      type: horizontal
      ratio: [1, 1]
      panes:
        - { name: editor, command: nvim, focus: true }
        - { name: logs, command: tail -f app.log }
  wez:
    name: WezTerm Layout
    backend: wezterm
    windowMode: current-window
    command: fish
  herdr:
    name: Herdr Layout
    backend: herdr
    command: fish
  list:
    name: Positional List
    command: echo list
"#,
    )
    .unwrap();
    (directory, path)
}

fn binary(name: &str) -> Command {
    let mut command = Command::cargo_bin(name).unwrap();
    command
        .env_remove("TMUX")
        .env_remove("TMUX_PANE")
        .env_remove("WEZTERM_PANE")
        .env_remove("HERDR_PANE_ID")
        .env_remove("HERDR_WORKSPACE_ID")
        .env_remove("VDE_CONFIG_PATH")
        .env_remove("VDE_VERBOSE")
        .env_remove("VDE_DEBUG");
    command
}

fn install_fake_tmux(directory: &TempDir) -> (std::path::PathBuf, std::path::PathBuf) {
    let bin = directory.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let executable = bin.join("tmux");
    fs::write(
        &executable,
        r#"#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_TMUX_LOG"
case "$1" in
  -V) printf 'tmux 3.4\n' ;;
  new-window) printf '%%0\n' ;;
  display-message) printf '@1\n' ;;
esac
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&executable).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&executable, permissions).unwrap();
    (bin, directory.path().join("tmux.log"))
}

#[test]
fn both_binaries_expose_the_same_version_and_help() {
    let expected = env!("CARGO_PKG_VERSION");
    let mut help_outputs = Vec::new();
    for name in ["vde-layout", "vl"] {
        binary(name)
            .arg("--version")
            .assert()
            .success()
            .stdout(format!("{expected}\n"));
        let help = binary(name).arg("--help").output().unwrap();
        assert!(help.status.success());
        let help_text = String::from_utf8(help.stdout.clone()).unwrap();
        assert!(help_text.contains("VDE (Vibrant Development Environment)"));
        assert!(help_text.contains("Usage:"));
        assert!(help_text.contains("list"));
        assert!(help_text.contains("--dry-run"));
        help_outputs.push(help.stdout);
    }
    assert_eq!(help_outputs[0], help_outputs[1]);
}

#[test]
fn lists_presets_and_applies_explicit_config_to_subcommand() {
    let (_directory, path) = config();
    binary("vde-layout")
        .args(["--config", path.to_str().unwrap(), "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Available presets:"))
        .stdout(predicate::str::contains("dev"))
        .stdout(predicate::str::contains("Editor and logs"));
}

#[test]
fn all_backend_dry_runs_need_no_external_binary() {
    let (_directory, path) = config();
    binary("vde-layout")
        .env("TMUX", "detected-session")
        .args(["dev", "--config", path.to_str().unwrap(), "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"))
        .stdout(predicate::str::contains("[tmux]"))
        .stdout(predicate::str::contains("Applied preset \"Development\""));

    binary("vl")
        .args(["wez", "--config", path.to_str().unwrap(), "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[wezterm]"))
        .stdout(predicate::str::contains("send-text"))
        .stdout(predicate::str::contains(
            "Applied preset \"WezTerm Layout\"",
        ));

    binary("vde-layout")
        .args(["herdr", "--config", path.to_str().unwrap(), "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("[herdr]"))
        .stdout(predicate::str::contains("herdr pane run"))
        .stdout(predicate::str::contains("Applied preset \"Herdr Layout\""));
}

#[test]
fn herdr_dry_run_warns_when_clamping_an_unsupported_ratio() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("layout.yml");
    fs::write(
        &path,
        "presets:\n  narrow:\n    name: Narrow\n    backend: herdr\n    layout:\n      type: horizontal\n      ratio: [1, 19]\n      panes:\n        - { name: narrow }\n        - { name: wide }\n",
    )
    .unwrap();

    binary("vde-layout")
        .args(["narrow", "--config", path.to_str().unwrap(), "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--ratio 0.1"))
        .stderr(predicate::str::contains(
            "Warning: Herdr adjusted split root:split:1 from ratio 0.05 to 0.1",
        ));
}

#[test]
fn actual_tmux_apply_uses_the_preset_display_name_for_a_new_window() {
    let (_config_directory, path) = config();
    let fake_directory = TempDir::new().unwrap();
    let (bin, log) = install_fake_tmux(&fake_directory);
    let path_env = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    binary("vde-layout")
        .env("PATH", path_env)
        .env("TMUX", "fake-session")
        .env("FAKE_TMUX_LOG", &log)
        .args(["default", "--config", path.to_str().unwrap()])
        .assert()
        .success();

    assert!(
        fs::read_to_string(log)
            .unwrap()
            .lines()
            .any(|line| line.contains("new-window") && line.contains("-n Default Layout"))
    );
}

#[test]
fn environment_validation_precedes_core_compilation_for_actual_apply() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("layout.yml");
    let huge_cells = "9".repeat(400);
    fs::write(
        &path,
        format!(
            "presets:\n  invalid:\n    name: Invalid\n    layout:\n      type: horizontal\n      ratio: [\"{huge_cells}c\", 1]\n      panes:\n        - {{ name: fixed }}\n        - {{ name: weighted }}\n"
        ),
    )
    .unwrap();

    binary("vde-layout")
        .args([
            "invalid",
            "--config",
            path.to_str().unwrap(),
            "--backend",
            "tmux",
        ])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "Must be run inside a tmux session",
        ))
        .stderr(predicate::str::contains("RATIO_INVALID_VALUE").not());

    binary("vde-layout")
        .args([
            "invalid",
            "--config",
            path.to_str().unwrap(),
            "--backend",
            "tmux",
            "--dry-run",
        ])
        .assert()
        .code(1)
        .stdout(predicate::str::starts_with(
            "[DRY RUN] No actual commands will be executed",
        ))
        .stderr(predicate::str::contains("RATIO_INVALID_VALUE"));
}

#[test]
fn alias_produces_identical_dry_run_output() {
    let (_directory, path) = config();
    let args = ["dev", "--config", path.to_str().unwrap(), "--dry-run"];
    let first = binary("vde-layout")
        .env("TMUX", "detected-session")
        .args(args)
        .output()
        .unwrap();
    let second = binary("vl")
        .env("TMUX", "detected-session")
        .args(args)
        .output()
        .unwrap();
    assert_eq!(first.status.code(), Some(0));
    assert_eq!(first.stdout, second.stdout);
    assert_eq!(first.stderr, second.stderr);
}

#[test]
fn reports_config_preset_and_option_errors_with_exit_one() {
    binary("vde-layout")
        .args(["--config", "/definitely/missing/layout.yml", "list"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Configuration file not found"));

    let (_directory, path) = config();
    binary("vde-layout")
        .args(["missing", "--config", path.to_str().unwrap(), "--dry-run"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Preset \"missing\" not found"));
    binary("vde-layout")
        .args(["--current-window", "--new-window"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("cannot be used with"));
    binary("vde-layout")
        .args(["--select-ui", "fzf"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("--select"));
}

#[test]
fn debug_environment_includes_structured_error_details() {
    binary("vde-layout")
        .env("VDE_DEBUG", "true")
        .args(["--config", "/definitely/missing/layout.yml", "list"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Debug: Vde("))
        .stderr(predicate::str::contains("ConfigNotFound"));
}

#[test]
fn verbose_environment_and_cli_flag_enable_runtime_logs() {
    let (_directory, path) = config();
    for mut command in [binary("vde-layout"), binary("vl")] {
        command
            .env("TMUX", "detected-session")
            .env("VDE_VERBOSE", "true")
            .args(["dev", "--config", path.to_str().unwrap(), "--dry-run"])
            .assert()
            .success()
            .stdout(predicate::str::contains("Window mode: new-window"))
            .stdout(predicate::str::contains("Terminal backend: tmux"));
    }
}

#[test]
fn backend_and_window_mode_sources_follow_cli_preset_and_environment_precedence() {
    let (_directory, path) = config();
    binary("vde-layout")
        .env("HERDR_PANE_ID", "pane-1")
        .args([
            "wez",
            "--config",
            path.to_str().unwrap(),
            "--backend",
            "tmux",
            "--new-window",
            "--verbose",
            "--dry-run",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Window mode: new-window (source: cli)",
        ))
        .stdout(predicate::str::contains("Terminal backend: tmux"));
    binary("vde-layout")
        .args([
            "wez",
            "--config",
            path.to_str().unwrap(),
            "--verbose",
            "--dry-run",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Window mode: current-window (source: preset)",
        ))
        .stdout(predicate::str::contains("Terminal backend: wezterm"));
    binary("vde-layout")
        .env("HERDR_PANE_ID", "pane-1")
        .args([
            "dev",
            "--config",
            path.to_str().unwrap(),
            "--verbose",
            "--dry-run",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Window mode: new-window (source: defaults)",
        ))
        .stdout(predicate::str::contains(
            "Terminal backend: herdr (source: environment)",
        ));

    let fallback_directory = TempDir::new().unwrap();
    let fallback_path = fallback_directory.path().join("fallback.yml");
    fs::write(
        &fallback_path,
        "presets:\n  shell:\n    name: Shell\n    command: bash\n",
    )
    .unwrap();
    binary("vde-layout")
        .env("WEZTERM_PANE", "42")
        .args([
            "shell",
            "--config",
            fallback_path.to_str().unwrap(),
            "--verbose",
            "--dry-run",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Window mode: new-window (source: fallback)",
        ))
        .stdout(predicate::str::contains(
            "Terminal backend: wezterm (source: environment)",
        ));
}

#[test]
fn backend_auto_detection_requires_a_supported_terminal_environment() {
    let (_directory, path) = config();
    binary("vde-layout")
        .args(["dev", "--config", path.to_str().unwrap(), "--dry-run"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "Unable to detect an active terminal backend",
        ))
        .stderr(predicate::str::contains("--backend <tmux|wezterm|herdr>"));
}

#[test]
fn double_dash_keeps_list_as_a_positional_preset() {
    let (_directory, path) = config();
    binary("vde-layout")
        .env("TMUX", "detected-session")
        .args([
            "--config",
            path.to_str().unwrap(),
            "--dry-run",
            "--",
            "list",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Applied preset \"Positional List\"",
        ));
}

#[test]
fn hidden_preview_subcommand_decodes_payload_without_node() {
    let payload = STANDARD.encode("presets:\n  dev:\n    name: Development\n");
    for name in ["vde-layout", "vl"] {
        binary(name)
            .args(["__preview", &payload])
            .assert()
            .success()
            .stdout("presets:\n  dev:\n    name: Development\n");
    }
    binary("vde-layout")
        .args(["__preview", "not-base64!"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Invalid preview payload"));
}

#[test]
fn selection_rejects_non_interactive_sessions_before_spawning_fzf() {
    let (_directory, path) = config();
    binary("vde-layout")
        .args(["--config", path.to_str().unwrap(), "--select=fzf"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "Preset selection requires an interactive terminal",
        ));
}
