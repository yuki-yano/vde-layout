use serde_json::json;
use vde_layout::{
    ErrorCode, Orientation, Pane, RatioValue, SelectSurfaceMode, SelectUiMode, TerminalBackendKind,
    WindowMode, validate_config_value, validate_pane_value, validate_preset_value, validate_yaml,
};

fn minimal_config() -> &'static str {
    r#"
presets:
  minimal:
    name: minimal
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
"#
}

#[test]
fn validates_minimal_config() {
    let config = validate_yaml(minimal_config()).unwrap();
    let preset = &config.presets["minimal"];
    assert_eq!(preset.name, "minimal");
    let layout = preset.layout.as_ref().unwrap();
    assert_eq!(layout.orientation, Orientation::Horizontal);
    assert_eq!(
        layout.ratio,
        vec![RatioValue::Weight(50.0), RatioValue::Weight(50.0)]
    );
    assert_eq!(layout.panes.len(), 2);
}

#[test]
fn validates_repository_example_config() {
    let config = validate_yaml(include_str!("../examples/basic-layout.yml")).unwrap();
    assert_eq!(config.presets.len(), 5);
    assert!(config.presets.contains_key("default"));
}

#[test]
fn validates_nested_layout_and_all_terminal_options() {
    let config = validate_yaml(
        r#"
presets:
  complex:
    name: Complex
    description: nested
    backend: wezterm
    windowMode: current-window
    hooks:
      afterApply: echo done
    layout:
      type: horizontal
      ratio: ["80c", 1]
      panes:
        - name: editor
          command: nvim
          cwd: ~/work
          env:
            NODE_ENV: development
            PORT: "3000"
          delay: 25
          title: Editor
          focus: true
          ephemeral: false
          closeOnError: true
        - type: vertical
          ratio: [2, 1]
          panes:
            - name: test
            - name: logs
"#,
    )
    .unwrap();

    let preset = &config.presets["complex"];
    assert_eq!(preset.backend, Some(TerminalBackendKind::Wezterm));
    assert_eq!(preset.window_mode, Some(WindowMode::CurrentWindow));
    assert_eq!(
        preset.hooks.as_ref().unwrap().after_apply.as_deref(),
        Some("echo done")
    );
    let layout = preset.layout.as_ref().unwrap();
    assert_eq!(layout.ratio[0], RatioValue::FixedCells("80c".into()));
    let Pane::Terminal(editor) = &layout.panes[0] else {
        panic!("expected terminal pane");
    };
    assert_eq!(editor.delay, Some(25));
    assert_eq!(editor.env.as_ref().unwrap()["PORT"], "3000");
    assert_eq!(editor.close_on_error, Some(true));
    assert!(matches!(layout.panes[1], Pane::Split(_)));
}

#[test]
fn preserves_preset_insertion_order() {
    let config = validate_yaml(
        r#"
presets:
  dev:
    name: dev
  test:
    name: test
  ops:
    name: ops
"#,
    )
    .unwrap();
    assert_eq!(
        config
            .presets
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["dev", "test", "ops"]
    );
}

#[test]
fn validates_defaults_selector_and_simple_presets() {
    let config = validate_yaml(
        r#"
defaults:
  windowMode: new-window
  selector:
    ui: fzf
    surface: tmux-popup
    tmuxPopupOpts: 80%,70%
    fzf:
      extraArgs: [--cycle, --info=inline]
presets:
  shell:
    name: Shell
  top:
    name: Top
    command: htop
"#,
    )
    .unwrap();
    let defaults = config.defaults.unwrap();
    assert_eq!(defaults.window_mode, Some(WindowMode::NewWindow));
    let selector = defaults.selector.unwrap();
    assert_eq!(selector.ui, Some(SelectUiMode::Fzf));
    assert_eq!(selector.surface, Some(SelectSurfaceMode::TmuxPopup));
    assert_eq!(
        selector.fzf.unwrap().extra_args.unwrap(),
        ["--cycle", "--info=inline"]
    );
    assert!(config.presets["shell"].layout.is_none());
    assert_eq!(config.presets["top"].command.as_deref(), Some("htop"));
}

#[test]
fn schema_level_config_allows_empty_presets() {
    let config = validate_config_value(&json!({ "presets": {} }), false).unwrap();
    assert!(config.presets.is_empty());
}

#[test]
fn schema_level_preset_and_pane_validation_are_available() {
    let preset = validate_preset_value(&json!({ "name": "wez", "backend": "wezterm" })).unwrap();
    assert_eq!(preset.backend, Some(TerminalBackendKind::Wezterm));
    let herdr = validate_preset_value(&json!({ "name": "herdr", "backend": "herdr" })).unwrap();
    assert_eq!(herdr.backend, Some(TerminalBackendKind::Herdr));
    let pane = validate_pane_value(&json!({
        "type": "horizontal",
        "ratio": ["40c", 1],
        "panes": [{"name": "left"}, {"name": "right"}]
    }))
    .unwrap();
    assert!(matches!(pane, Pane::Split(_)));
}

#[test]
fn rejects_invalid_yaml_syntax() {
    let error = validate_yaml("presets:\n  broken: [").unwrap_err();
    assert_eq!(error.code, ErrorCode::ConfigParseError);
    assert_eq!(error.message, "Failed to parse YAML");
    assert!(error.details.contains_key("parseError"));
}

#[test]
fn rejects_empty_missing_and_empty_presets() {
    assert_eq!(
        validate_yaml("").unwrap_err().message,
        "YAML text not provided"
    );
    assert_eq!(
        validate_yaml("config:\n  value: true\n")
            .unwrap_err()
            .message,
        "presets field is required"
    );
    assert_eq!(
        validate_yaml("presets: {}\n").unwrap_err().message,
        "At least one preset is required"
    );
}

#[test]
fn rejects_invalid_enum_values() {
    for (field, value) in [("windowMode", "side-window"), ("backend", "screen")] {
        let yaml = format!("presets:\n  bad:\n    name: bad\n    {field}: {value}\n");
        assert!(
            validate_yaml(&yaml)
                .unwrap_err()
                .message
                .contains("Invalid enum value")
        );
    }
    let yaml = minimal_config().replace("type: horizontal", "type: diagonal");
    assert!(
        validate_yaml(&yaml)
            .unwrap_err()
            .message
            .contains("Invalid enum value")
    );
}

#[test]
fn rejects_missing_required_fields() {
    let missing_name = "presets:\n  bad:\n    description: nope\n";
    let error = validate_yaml(missing_name).unwrap_err();
    assert_eq!(error.message, "Required");
    assert_eq!(error.details["issues"][0]["path"], "presets.bad.name");

    let missing_panes =
        "presets:\n  bad:\n    name: bad\n    layout:\n      type: horizontal\n      ratio: [1]\n";
    let error = validate_yaml(missing_panes).unwrap_err();
    assert_eq!(
        error.details["issues"][0]["path"],
        "presets.bad.layout.panes"
    );
}

#[test]
fn rejects_ratio_mismatch_and_fixed_only_ratio() {
    let mismatch = minimal_config().replace("ratio: [50, 50]", "ratio: [50, 30, 20]");
    assert!(
        validate_yaml(&mismatch)
            .unwrap_err()
            .message
            .contains("Number of elements in ratio array")
    );
    let fixed_only = minimal_config().replace("ratio: [50, 50]", "ratio: [\"40c\", \"20c\"]");
    assert!(
        validate_yaml(&fixed_only)
            .unwrap_err()
            .message
            .contains("numeric weight")
    );
}

#[test]
fn rejects_invalid_ratio_values() {
    for ratio in [
        "[0, 1]",
        "[-1, 1]",
        "[\"90\", 1]",
        "[\"0c\", 1]",
        "[\"1.5c\", 1]",
    ] {
        let yaml = minimal_config().replace("[50, 50]", ratio);
        assert!(validate_yaml(&yaml).is_err(), "ratio {ratio} should fail");
    }
}

#[test]
fn accepts_positive_decimal_ratios() {
    let yaml = minimal_config()
        .replace("ratio: [50, 50]", "ratio: [33.33, 33.34, 33.33]")
        .replace(
            "        - name: monitor",
            "        - name: logs\n        - name: monitor",
        );
    let config = validate_yaml(&yaml).unwrap();
    assert_eq!(
        config.presets["minimal"]
            .layout
            .as_ref()
            .unwrap()
            .ratio
            .len(),
        3
    );
}

#[test]
fn rejects_unknown_fields_in_strict_objects() {
    let terminal = minimal_config().replace(
        "command: vim",
        "command: vim\n          unknownField: value",
    );
    assert!(validate_yaml(&terminal).is_err());

    let split = minimal_config().replace("ratio: [50, 50]", "ratio: [50, 50]\n      unknown: true");
    // Root LayoutSchema is intentionally non-strict, matching Zod.
    assert!(validate_yaml(&split).is_ok());

    let hook = minimal_config().replace(
        "    layout:",
        "    hooks:\n      beforeApply: nope\n    layout:",
    );
    assert!(validate_yaml(&hook).is_err());

    let selector = minimal_config().replacen(
        "presets:",
        "defaults:\n  selector:\n    floating: true\npresets:",
        1,
    );
    assert!(validate_yaml(&selector).is_err());
}

#[test]
fn ignores_unknown_fields_in_nonstrict_zod_objects() {
    let config = validate_yaml(
        r#"
futureRoot: ignored
defaults:
  futureDefault: ignored
presets:
  test:
    name: test
    futurePreset: ignored
    layout:
      type: horizontal
      ratio: [1, 1]
      futureLayout: ignored
      panes:
        - name: one
        - name: two
"#,
    )
    .unwrap();
    assert_eq!(config.presets["test"].name, "test");
}

#[test]
fn rejects_null_for_optional_zod_fields() {
    for line in [
        "description: null",
        "layout: null",
        "backend: null",
        "hooks: null",
    ] {
        let yaml = format!("presets:\n  bad:\n    name: bad\n    {line}\n");
        assert!(validate_yaml(&yaml).is_err(), "{line} must fail");
    }
}

#[test]
fn reports_path_for_invalid_terminal_values() {
    let yaml = r#"
presets:
  test:
    name: test
    layout:
      type: horizontal
      ratio: [1, 1]
      panes:
        - name: invalid-command
          command: 123
        - name: invalid-env
          env:
            PORT: 3000
"#;
    let error = validate_yaml(yaml).unwrap_err();
    let issues = error.details["issues"].as_array().unwrap();
    assert!(
        issues
            .iter()
            .any(|issue| issue["path"] == "presets.test.layout.panes.0.command")
    );
    assert!(
        issues
            .iter()
            .any(|issue| issue["path"] == "presets.test.layout.panes.1.env.PORT")
    );
}

#[test]
fn treats_yaml_11_boolean_words_as_strings() {
    let config = validate_yaml(
        r#"
presets:
  words:
    name: words
    command: on
    description: no
"#,
    )
    .unwrap();
    assert_eq!(config.presets["words"].command.as_deref(), Some("on"));
    assert_eq!(config.presets["words"].description.as_deref(), Some("no"));
}

#[test]
fn expands_yaml_anchors_and_aliases() {
    let config = validate_yaml(
        r#"
shared: &shared
  name: shared-name
presets:
  one: *shared
  two: *shared
"#,
    )
    .unwrap();
    assert_eq!(config.presets["one"].name, "shared-name");
    assert_eq!(config.presets["two"].name, "shared-name");
}

#[test]
fn treats_yaml_merge_keys_as_ordinary_keys() {
    let error = validate_yaml(
        r#"
base: &base
  name: inherited
presets:
  one:
    <<: *base
"#,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::ConfigParseError);
    assert!(
        error.details["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["path"] == "presets.one.name")
    );
}

#[test]
fn rejects_yaml_11_boolean_words_for_boolean_fields() {
    let error = validate_yaml(
        r#"
presets:
  one:
    name: one
    layout:
      type: horizontal
      ratio: [1]
      panes:
        - name: pane
          focus: yes
"#,
    )
    .unwrap_err();
    assert!(
        error.details["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["path"] == "presets.one.layout.panes.0.focus")
    );
}

#[test]
fn accepts_integer_delay_written_with_a_decimal_point() {
    let config = validate_yaml(
        r#"
presets:
  one:
    name: one
    layout:
      type: horizontal
      ratio: [1]
      panes:
        - name: delayed
          delay: 500.0
"#,
    )
    .unwrap();
    let pane = &config.presets["one"].layout.as_ref().unwrap().panes[0];
    assert!(matches!(pane, Pane::Terminal(pane) if pane.delay == Some(500)));

    let error = validate_yaml(
        r#"
presets:
  one:
    name: one
    layout:
      type: horizontal
      ratio: [1]
      panes:
        - name: delayed
          delay: 500.5
"#,
    )
    .unwrap_err();
    assert!(
        error.details["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|issue| issue["path"] == "presets.one.layout.panes.0.delay")
    );

    for zero in ["0", "0.0"] {
        let error = validate_yaml(&format!(
            r#"
presets:
  one:
    name: one
    layout:
      type: horizontal
      ratio: [1]
      panes:
        - name: delayed
          delay: {zero}
"#
        ))
        .unwrap_err();
        assert!(
            error.details["issues"]
                .as_array()
                .unwrap()
                .iter()
                .any(|issue| issue["path"] == "presets.one.layout.panes.0.delay")
        );
    }
}

#[test]
fn rejects_duplicate_mapping_keys() {
    let error = validate_yaml(
        r#"
presets:
  one:
    name: first
    name: second
"#,
    )
    .unwrap_err();
    assert_eq!(error.message, "Failed to parse YAML");
}

#[test]
fn accepts_deeply_nested_layouts() {
    let config = validate_yaml(
        r#"
presets:
  deep:
    name: deep
    layout:
      type: horizontal
      ratio: [1, 1]
      panes:
        - type: vertical
          ratio: [1, 1]
          panes:
            - type: horizontal
              ratio: [1, 1]
              panes:
                - name: editor
                - name: monitor
            - name: logs
        - name: shell
"#,
    )
    .unwrap();
    assert!(config.presets.contains_key("deep"));
}
