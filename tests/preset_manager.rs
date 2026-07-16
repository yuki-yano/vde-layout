use std::fs;

use tempfile::TempDir;
use vde_layout::{ConfigLoaderOptions, ErrorCode, Pane, PresetManager};

fn manager_with_file(temp: &TempDir) -> PresetManager {
    PresetManager::new(ConfigLoaderOptions {
        config_paths: Some(vec![temp.path().join("layout.yml")]),
        ..ConfigLoaderOptions::default()
    })
}

fn write(temp: &TempDir, yaml: &str) {
    fs::write(temp.path().join("layout.yml"), yaml).unwrap();
}

#[test]
fn loads_gets_and_lists_presets_in_order() {
    let temp = TempDir::new().unwrap();
    write(
        &temp,
        r#"
presets:
  default:
    name: Default
    description: primary
  work:
    name: Work
    layout:
      type: horizontal
      ratio: [1, 1]
      panes:
        - name: editor
          command: vim
        - name: server
          command: npm run dev
  test:
    name: Test
"#,
    );
    let mut manager = manager_with_file(&temp);
    manager.load_config().unwrap();
    assert_eq!(manager.get_preset("default").unwrap().name, "Default");
    assert_eq!(
        manager
            .list_presets()
            .iter()
            .map(|preset| preset.key.as_str())
            .collect::<Vec<_>>(),
        ["default", "work", "test"]
    );
    assert_eq!(
        manager.list_presets()[0].description.as_deref(),
        Some("primary")
    );
    let layout = manager.get_preset("work").unwrap().layout.as_ref().unwrap();
    let Pane::Terminal(editor) = &layout.panes[0] else {
        panic!("expected terminal");
    };
    assert_eq!(editor.command.as_deref(), Some("vim"));
}

#[test]
fn returns_empty_list_before_loading() {
    let temp = TempDir::new().unwrap();
    assert!(manager_with_file(&temp).list_presets().is_empty());
}

#[test]
fn errors_before_loading_and_for_unknown_preset() {
    let temp = TempDir::new().unwrap();
    let mut manager = manager_with_file(&temp);
    let error = manager.get_preset("default").unwrap_err();
    assert_eq!(error.code, ErrorCode::ConfigNotFound);
    assert_eq!(error.message, "Configuration not loaded");

    write(&temp, "presets:\n  default:\n    name: default\n");
    manager.load_config().unwrap();
    let error = manager.get_preset("missing").unwrap_err();
    assert_eq!(error.code, ErrorCode::PresetNotFound);
    assert_eq!(error.details["availablePresets"][0], "default");
}

#[test]
fn returns_named_default_or_first_preset() {
    let temp = TempDir::new().unwrap();
    write(
        &temp,
        "presets:\n  work:\n    name: work\n  test:\n    name: test\n",
    );
    let mut manager = manager_with_file(&temp);
    manager.load_config().unwrap();
    assert_eq!(manager.get_default_preset().unwrap().name, "work");

    write(
        &temp,
        "presets:\n  work:\n    name: work\n  default:\n    name: default\n",
    );
    manager.load_config().unwrap();
    assert_eq!(manager.get_default_preset().unwrap().name, "default");
}

#[test]
fn exposes_defaults_and_resets_cache_when_path_changes() {
    let temp = TempDir::new().unwrap();
    write(
        &temp,
        "defaults:\n  windowMode: current-window\npresets:\n  one:\n    name: one\n",
    );
    let mut manager = manager_with_file(&temp);
    manager.load_config().unwrap();
    assert!(manager.get_defaults().unwrap().is_some());

    manager.set_config_path(temp.path().join("other.yml"));
    assert_eq!(
        manager.get_preset("one").unwrap_err().message,
        "Configuration not loaded"
    );
}

#[test]
fn propagates_missing_file_and_validation_errors() {
    let temp = TempDir::new().unwrap();
    let mut manager = manager_with_file(&temp);
    assert_eq!(
        manager.load_config().unwrap_err().code,
        ErrorCode::ConfigNotFound
    );

    write(
        &temp,
        "presets:\n  invalid:\n    name: invalid\n    backend: screen\n",
    );
    assert_eq!(
        manager.load_config().unwrap_err().code,
        ErrorCode::ConfigParseError
    );
}
