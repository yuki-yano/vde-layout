use std::fs;

use indexmap::indexmap;
use tempfile::TempDir;
use vde_layout::cli::{
    AfterApplyHookContext, CliLogger, SelectorError, SelectorOptions, build_fzf_args,
    build_preset_preview_yaml, build_selector_rows, decode_preview_payload, run_after_apply_hook,
};
use vde_layout::config::ConfigLoaderOptions;
use vde_layout::model::{Preset, SelectSurfaceMode, SelectUiMode};
use vde_layout::preset::PresetManager;

fn preset() -> Preset {
    Preset {
        name: "Development".to_owned(),
        description: Some("Editor\tand\nlogs".to_owned()),
        layout: None,
        command: Some("nvim".to_owned()),
        window_mode: None,
        backend: None,
        hooks: None,
    }
}

#[test]
fn preview_yaml_contains_only_the_selected_preset() {
    let yaml = build_preset_preview_yaml("dev", &preset()).unwrap();
    assert!(yaml.contains("presets:"));
    assert!(yaml.contains("dev:"));
    assert!(yaml.contains("Development"));
}

#[test]
fn fzf_args_use_rust_preview_and_enforce_reserved_options() {
    let options = SelectorOptions {
        ui_mode: SelectUiMode::Fzf,
        surface_mode: SelectSurfaceMode::Auto,
        tmux_popup_options: Some("80%,70%".to_owned()),
        fzf_extra_args: vec!["--cycle".to_owned()],
        cwd: "/tmp".into(),
        current_exe: "/tmp/path with spaces/vde-layout".into(),
        in_tmux: true,
    };
    let args = build_fzf_args(&options).unwrap();
    assert!(args.iter().any(|arg| arg == "--tmux=80%,70%"));
    assert!(args.iter().any(|arg| arg == "--cycle"));
    let preview = args
        .iter()
        .find(|arg| arg.starts_with("--preview="))
        .unwrap();
    assert!(preview.contains("__preview {3}"));
    assert!(!preview.contains("node -e"));
    assert!(preview.contains("'"));

    let mut outside = options.clone();
    outside.surface_mode = SelectSurfaceMode::TmuxPopup;
    outside.in_tmux = false;
    assert!(matches!(
        build_fzf_args(&outside),
        Err(SelectorError::Message(message)) if message.contains("requires running inside tmux")
    ));

    let mut reserved = options;
    reserved.fzf_extra_args = vec!["--preview=bad".to_owned()];
    assert!(matches!(
        build_fzf_args(&reserved),
        Err(SelectorError::Message(message)) if message.contains("reserved fzf option")
    ));
}

#[test]
fn selector_rows_are_sanitized_aligned_and_decodable() {
    let directory = TempDir::new().unwrap();
    let path = directory.path().join("layout.yml");
    fs::write(
        &path,
        "presets:\n  dev:\n    name: Development\n    description: 'Editor and logs'\n    command: nvim\n  長い:\n    name: 日本語\n",
    )
    .unwrap();
    let mut manager = PresetManager::new(ConfigLoaderOptions {
        config_paths: Some(vec![path]),
        ..Default::default()
    });
    manager.load_config().unwrap();
    let rows = build_selector_rows(&manager).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| !row.display.contains('\t')));
    for row in rows {
        let decoded = decode_preview_payload(&row.preview_base64).unwrap();
        let text = String::from_utf8(decoded).unwrap();
        assert!(text.contains(&row.key));
    }
}

#[test]
fn after_apply_hook_resolves_all_tokens_and_runs_in_requested_directory() {
    let directory = TempDir::new().unwrap();
    let output = directory.path().join("hook.txt");
    let command = format!(
        "printf '%s' \"{{{{this_pane}}}}|{{{{focus_pane}}}}|{{{{pane_id:logs}}}}|{{{{window_id}}}}|$PWD\" > {}",
        shlex::try_quote(&output.to_string_lossy()).unwrap()
    );
    run_after_apply_hook(
        Some(&command),
        &AfterApplyHookContext {
            cwd: directory.path(),
            focus_pane_id: Some("%1"),
            pane_name_to_real_id: &indexmap! { "logs".to_owned() => "%2".to_owned() },
            window_id: Some("@5"),
        },
        &CliLogger::from_environment(false),
    );
    assert_eq!(
        fs::read_to_string(output).unwrap(),
        format!(
            "%1|%1|%2|@5|{}",
            directory.path().canonicalize().unwrap().display()
        )
    );
}

#[test]
fn after_apply_hook_skips_unresolved_tokens_and_ignores_command_failure() {
    let directory = TempDir::new().unwrap();
    let output = directory.path().join("must-not-exist");
    let command = format!(
        "printf bad > {} && echo {{{{window_id}}}}",
        shlex::try_quote(&output.to_string_lossy()).unwrap()
    );
    run_after_apply_hook(
        Some(&command),
        &AfterApplyHookContext {
            cwd: directory.path(),
            focus_pane_id: Some("%1"),
            pane_name_to_real_id: &indexmap::IndexMap::new(),
            window_id: None,
        },
        &CliLogger::from_environment(false),
    );
    assert!(!output.exists());

    run_after_apply_hook(
        Some("exit 9"),
        &AfterApplyHookContext {
            cwd: directory.path(),
            focus_pane_id: None,
            pane_name_to_real_id: &indexmap::IndexMap::new(),
            window_id: None,
        },
        &CliLogger::from_environment(false),
    );
}
