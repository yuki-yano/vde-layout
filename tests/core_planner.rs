use vde_layout::Orientation;
use vde_layout::core::{
    CompiledLayoutNode, CompiledPreset, CompiledPresetMetadata, CompiledRatioEntry,
    CompiledSplitPane, CompiledTerminalPane, PlanNode, compile_preset, create_layout_plan,
};

fn terminal(name: &str) -> CompiledLayoutNode {
    CompiledLayoutNode::Terminal(Box::new(CompiledTerminalPane {
        name: name.to_owned(),
        command: None,
        cwd: None,
        env: None,
        delay: None,
        title: None,
        focus: None,
        ephemeral: None,
        close_on_error: None,
        options: None,
    }))
}

fn preset(layout: CompiledLayoutNode) -> CompiledPreset {
    CompiledPreset {
        name: "manual".to_owned(),
        version: "legacy".to_owned(),
        command: None,
        layout: Some(layout),
        hooks: None,
        metadata: CompiledPresetMetadata {
            source: "tests/manual".to_owned(),
        },
    }
}

#[test]
fn assigns_deterministic_ids_and_preserves_ratios_and_focus() {
    let compiled = compile_preset(
        r#"
name: layout-sample
layout:
  type: horizontal
  ratio: [2, 1]
  panes:
    - name: editor
      command: nvim
      focus: true
    - type: vertical
      ratio: [1, 1]
      panes:
        - name: logs
        - name: shell
"#,
        "tests/sample.yml",
    )
    .unwrap();
    let plan = create_layout_plan(&compiled).unwrap();
    assert_eq!(plan.focus_pane_id, "root.0");
    let PlanNode::Split(root) = plan.root else {
        panic!("expected split root");
    };
    assert_eq!(root.panes[0].id(), "root.0");
    assert_eq!(root.panes[1].id(), "root.1");
    let PlanNode::Split(nested) = &root.panes[1] else {
        panic!("expected nested split");
    };
    assert_eq!(nested.panes[0].id(), "root.1.0");
    assert_eq!(nested.panes[1].id(), "root.1.1");
}

#[test]
fn rejects_multiple_focus_requests() {
    let compiled = compile_preset(
        "name: focus\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one, focus: true }\n    - { name: two, focus: true }\n",
        "tests/focus.yml",
    )
    .unwrap();
    let error = create_layout_plan(&compiled).unwrap_err();
    assert_eq!(error.code, "FOCUS_CONFLICT");
    assert_eq!(
        error.details["focusPaneIds"],
        serde_json::json!(["root.0", "root.1"])
    );
}

#[test]
fn focuses_the_first_terminal_when_unspecified() {
    let compiled = compile_preset(
        "name: no-focus\nlayout:\n  type: vertical\n  ratio: [3, 1]\n  panes:\n    - { name: main }\n    - { name: aux }\n",
        "tests/no-focus.yml",
    )
    .unwrap();
    let plan = create_layout_plan(&compiled).unwrap();
    assert_eq!(plan.focus_pane_id, "root.0");
    let serialized = serde_json::to_value(plan).unwrap();
    let panes = serialized["root"]["panes"].as_array().unwrap();
    assert_eq!(panes.iter().filter(|pane| pane["focus"] == true).count(), 1);
}

#[test]
fn creates_a_single_terminal_when_layout_is_missing() {
    let compiled =
        compile_preset("name: single-pane\ncommand: fish\n", "tests/single.yml").unwrap();
    let plan = create_layout_plan(&compiled).unwrap();
    assert_eq!(plan.focus_pane_id, "root");
    assert!(matches!(
        plan.root,
        PlanNode::Terminal(ref pane)
            if pane.id == "root" && pane.name == "single-pane" && pane.focus
                && pane.command.as_deref() == Some("fish")
    ));
}

#[test]
fn validates_manual_ratio_entries() {
    let fixed_only = preset(CompiledLayoutNode::Split(CompiledSplitPane {
        orientation: Orientation::Horizontal,
        ratio: vec![
            CompiledRatioEntry::FixedCells { cells: 10.0 },
            CompiledRatioEntry::FixedCells { cells: 20.0 },
        ],
        panes: vec![terminal("left"), terminal("right")],
    }));
    assert_eq!(
        create_layout_plan(&fixed_only).unwrap_err().code,
        "RATIO_WEIGHT_MISSING"
    );

    let invalid = preset(CompiledLayoutNode::Split(CompiledSplitPane {
        orientation: Orientation::Horizontal,
        ratio: vec![CompiledRatioEntry::Weight { weight: f64::NAN }],
        panes: vec![terminal("left")],
    }));
    assert_eq!(
        create_layout_plan(&invalid).unwrap_err().code,
        "RATIO_INVALID_VALUE"
    );
}

#[test]
fn rejects_layouts_without_terminal_panes() {
    let compiled = preset(CompiledLayoutNode::Split(CompiledSplitPane {
        orientation: Orientation::Horizontal,
        ratio: vec![CompiledRatioEntry::Weight { weight: 1.0 }],
        panes: vec![CompiledLayoutNode::Split(CompiledSplitPane {
            orientation: Orientation::Vertical,
            ratio: vec![CompiledRatioEntry::Weight { weight: 1.0 }],
            panes: vec![],
        })],
    }));
    assert_eq!(
        create_layout_plan(&compiled).unwrap_err().code,
        "NO_TERMINAL_PANES"
    );
}
