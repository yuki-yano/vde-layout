use serde_json::json;
use vde_layout::core::{
    CompiledLayoutNode, CompiledRatioEntry, compile_preset, compile_preset_from_value,
};

#[test]
fn compiles_yaml_into_the_core_model() {
    let preset = compile_preset(
        r#"
name: sample-core
layout:
  type: horizontal
  ratio: [1, 2]
  panes:
    - name: main
      command: nvim
    - type: vertical
      ratio: [3, 1]
      panes:
        - name: watcher
        - name: console
"#,
        "tests/sample.yml",
    )
    .unwrap();
    assert_eq!(preset.name, "sample-core");
    assert_eq!(preset.version, "legacy");
    assert_eq!(preset.metadata.source, "tests/sample.yml");
    let CompiledLayoutNode::Split(root) = preset.layout.unwrap() else {
        panic!("expected split root");
    };
    assert_eq!(
        root.ratio,
        vec![
            CompiledRatioEntry::Weight { weight: 1.0 },
            CompiledRatioEntry::Weight { weight: 2.0 },
        ]
    );
    assert!(matches!(
        &root.panes[0],
        CompiledLayoutNode::Terminal(pane)
            if pane.name == "main" && pane.command.as_deref() == Some("nvim")
    ));
}

#[test]
fn reports_yaml_parse_errors_with_source() {
    let error = compile_preset("name: [unclosed", "tests/broken.yml").unwrap_err();
    assert_eq!(error.code, "PRESET_PARSE_ERROR");
    assert_eq!(error.source.as_deref(), Some("tests/broken.yml"));
}

#[test]
fn reports_ratio_mismatch_and_invalid_orientation() {
    let mismatch = compile_preset(
        "name: mismatch\nlayout:\n  type: horizontal\n  ratio: [1, 2]\n  panes:\n    - name: left\n",
        "tests/mismatch.yml",
    )
    .unwrap_err();
    assert_eq!(mismatch.code, "LAYOUT_RATIO_MISMATCH");

    let orientation = compile_preset(
        "name: invalid\nlayout:\n  type: diagonal\n  ratio: [1]\n  panes:\n    - name: main\n",
        "tests/orientation.yml",
    )
    .unwrap_err();
    assert_eq!(orientation.code, "LAYOUT_INVALID_ORIENTATION");
    assert_eq!(orientation.path.as_deref(), Some("preset.layout.type"));
}

#[test]
fn normalizes_terminal_env_and_collects_additional_options() {
    let preset = compile_preset(
        r#"
name: env-options
layout:
  type: horizontal
  ratio: [1, 1]
  panes:
    - name: main
      env:
        PATH: /usr/bin
        COUNT: 1
      delay: 750
      title: Main Pane
      layoutHint: floating
      focus: true
    - name: shell
      command: bash
"#,
        "tests/env.yml",
    )
    .unwrap();
    let Some(CompiledLayoutNode::Split(root)) = preset.layout else {
        panic!("expected split root");
    };
    let CompiledLayoutNode::Terminal(terminal) = &root.panes[0] else {
        panic!("expected terminal");
    };
    assert_eq!(terminal.env.as_ref().unwrap()["PATH"], "/usr/bin");
    assert!(!terminal.env.as_ref().unwrap().contains_key("COUNT"));
    assert_eq!(terminal.delay, Some(750.0));
    assert_eq!(terminal.title.as_deref(), Some("Main Pane"));
    assert_eq!(terminal.focus, Some(true));
    assert_eq!(terminal.options.as_ref().unwrap()["layoutHint"], "floating");
}

#[test]
fn matches_javascript_object_entries_for_array_env_values() {
    let preset = compile_preset_from_value(
        &json!({
            "name": "array-env",
            "layout": {
                "type": "horizontal",
                "ratio": [1],
                "panes": [{ "name": "main", "env": ["FIRST", 2, "THIRD"] }]
            }
        }),
        "tests/array-env",
    )
    .unwrap();
    let Some(CompiledLayoutNode::Split(root)) = preset.layout else {
        panic!("expected split root");
    };
    let CompiledLayoutNode::Terminal(terminal) = &root.panes[0] else {
        panic!("expected terminal");
    };
    let env = terminal.env.as_ref().unwrap();
    assert_eq!(env.get("0").map(String::as_str), Some("FIRST"));
    assert_eq!(env.get("2").map(String::as_str), Some("THIRD"));
    assert!(!env.contains_key("1"));
}

#[test]
fn reports_unknown_layout_nodes() {
    let error = compile_preset(
        "name: invalid\nlayout:\n  type: horizontal\n  ratio: [1]\n  panes: [42]\n",
        "tests/invalid-node.yml",
    )
    .unwrap_err();
    assert_eq!(error.code, "LAYOUT_INVALID_NODE");
    assert_eq!(error.path.as_deref(), Some("preset.layout.panes[0]"));
}

#[test]
fn compiles_values_hooks_and_mixed_ratios() {
    let preset = compile_preset_from_value(
        &json!({
            "name": "mixed-ratio",
            "hooks": { "afterApply": "echo {{focus_pane}}" },
            "layout": {
                "type": "horizontal",
                "ratio": ["90c", 2, 1],
                "panes": [{ "name": "left" }, { "name": "middle" }, { "name": "right" }]
            }
        }),
        "tests/value-input",
    )
    .unwrap();
    assert_eq!(
        preset.hooks.unwrap().after_apply.as_deref(),
        Some("echo {{focus_pane}}")
    );
    let Some(CompiledLayoutNode::Split(root)) = preset.layout else {
        panic!("expected split root");
    };
    assert_eq!(
        root.ratio,
        vec![
            CompiledRatioEntry::FixedCells { cells: 90.0 },
            CompiledRatioEntry::Weight { weight: 2.0 },
            CompiledRatioEntry::Weight { weight: 1.0 },
        ]
    );
}

#[test]
fn omits_invalid_or_empty_hooks() {
    for hooks in [
        json!(null),
        json!({}),
        json!({ "afterApply": "" }),
        json!(42),
    ] {
        let preset = compile_preset_from_value(
            &json!({ "name": "no-hooks", "hooks": hooks }),
            "tests/no-hooks",
        )
        .unwrap();
        assert!(preset.hooks.is_none());
    }
}

#[test]
fn maps_layout_validation_failures_to_stable_codes() {
    let cases = [
        (
            json!({ "type": "horizontal", "ratio": [1], "name": "terminal" }),
            "LAYOUT_PANES_MISSING",
        ),
        (
            json!({ "type": "horizontal", "ratio": [1], "panes": [] }),
            "LAYOUT_PANES_MISSING",
        ),
        (
            json!({ "type": "horizontal", "ratio": [], "panes": [{ "name": "main" }] }),
            "LAYOUT_RATIO_MISSING",
        ),
        (
            json!({ "type": "horizontal", "ratio": [0], "panes": [{ "name": "main" }] }),
            "RATIO_INVALID_VALUE",
        ),
        (
            json!({ "type": "horizontal", "ratio": [1], "panes": [{ "name": "" }] }),
            "LAYOUT_INVALID_NODE",
        ),
        (
            json!({
                "type": "horizontal",
                "ratio": ["40c", "20c"],
                "panes": [{ "name": "left" }, { "name": "right" }]
            }),
            "RATIO_WEIGHT_MISSING",
        ),
    ];
    for (layout, expected) in cases {
        let error = compile_preset_from_value(
            &json!({ "name": "invalid", "layout": layout }),
            "tests/invalid",
        )
        .unwrap_err();
        assert_eq!(error.code, expected);
    }
}

#[test]
fn maps_nested_schema_failures_to_invalid_node_like_zod_union() {
    for nested in [
        json!({ "type": "diagonal", "ratio": [1], "panes": [{ "name": "main" }] }),
        json!({ "type": "vertical", "ratio": [0], "panes": [{ "name": "main" }] }),
        json!({ "type": "vertical", "ratio": [1, 1], "panes": [{ "name": "main" }] }),
    ] {
        let error = compile_preset_from_value(
            &json!({
                "name": "nested-invalid",
                "layout": {
                    "type": "horizontal",
                    "ratio": [1],
                    "panes": [nested]
                }
            }),
            "tests/nested-invalid",
        )
        .unwrap_err();
        assert_eq!(error.code, "LAYOUT_INVALID_NODE");
        assert_eq!(error.path.as_deref(), Some("preset.layout.panes[0]"));
    }
}

#[test]
fn preserves_large_finite_fixed_cell_values_like_javascript_numbers() {
    let preset = compile_preset_from_value(
        &json!({
            "name": "large-fixed",
            "layout": {
                "type": "horizontal",
                "ratio": ["1000000000000000000000000000000c", 1],
                "panes": [{ "name": "large" }, { "name": "weighted" }]
            }
        }),
        "tests/large-fixed",
    )
    .unwrap();
    let Some(CompiledLayoutNode::Split(root)) = preset.layout else {
        panic!("expected split root");
    };
    assert!(matches!(
        root.ratio[0],
        CompiledRatioEntry::FixedCells { cells } if cells == 1e30
    ));
}

#[test]
fn defaults_name_and_allows_single_terminal_core_layouts() {
    let preset = compile_preset_from_value(
        &json!({ "name": "  ", "layout": { "name": "shell", "custom": 7 } }),
        "tests/terminal-root",
    )
    .unwrap();
    assert_eq!(preset.name, "Unnamed preset");
    assert!(matches!(
        preset.layout,
        Some(CompiledLayoutNode::Terminal(ref pane))
            if pane.name == "shell" && pane.options.as_ref().unwrap()["custom"] == 7
    ));
}

#[test]
fn rejects_non_object_documents_but_matches_javascript_array_behavior() {
    let error = compile_preset_from_value(&json!(42), "tests/number").unwrap_err();
    assert_eq!(error.code, "PRESET_INVALID_DOCUMENT");

    let array = compile_preset_from_value(&json!([]), "tests/array").unwrap();
    assert_eq!(array.name, "Unnamed preset");
    assert!(array.layout.is_none());
}
