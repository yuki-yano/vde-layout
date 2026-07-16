use serde_json::json;
use vde_layout::Orientation;
use vde_layout::core::{
    CommandStepKind, CompiledRatioEntry, LayoutPlan, PlanNode, PlanSplit, SplitSizing,
    canonical_json_value, compile_preset, create_layout_plan, emit_plan,
};

fn emit(document: &str) -> vde_layout::core::PlanEmission {
    let preset = compile_preset(document, "tests/emitter.yml").unwrap();
    let plan = create_layout_plan(&preset).unwrap();
    emit_plan(&plan).unwrap()
}

#[test]
fn emits_backend_neutral_split_and_focus_steps() {
    let emission = emit(
        "name: emit\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: main, command: nvim }\n    - { name: repl, command: node }\n",
    );
    assert_eq!(emission.steps.len(), 2);
    let split = &emission.steps[0];
    assert_eq!(split.kind, CommandStepKind::Split);
    assert_eq!(split.orientation, Some(Orientation::Horizontal));
    assert_eq!(split.percentage, Some(50));
    assert_eq!(split.target_pane_id.as_deref(), Some("root.0"));
    assert_eq!(
        split.split_sizing,
        Some(SplitSizing::Percent { percentage: 50 })
    );
    assert!(split.command.is_none());
    assert_eq!(emission.summary.steps_count, 2);
    assert_eq!(emission.summary.focus_pane_id, "root.0");
    assert_eq!(emission.summary.initial_pane_id, "root.0");
    assert_eq!(emission.hash.len(), 64);
    assert!(emission.hash.bytes().all(|byte| byte.is_ascii_hexdigit()));
}

#[test]
fn emits_terminal_metadata() {
    let emission = emit(
        "name: options\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: main, title: Main Pane, delay: 300, command: npm run dev }\n    - { name: aux }\n",
    );
    let main = emission
        .terminals
        .iter()
        .find(|terminal| terminal.virtual_pane_id == "root.0")
        .unwrap();
    assert_eq!(main.title.as_deref(), Some("Main Pane"));
    assert_eq!(main.delay, Some(300.0));
}

#[test]
fn emits_only_focus_for_single_terminal_plans() {
    let emission = emit("name: single\n");
    assert_eq!(emission.steps.len(), 1);
    assert_eq!(emission.steps[0].kind, CommandStepKind::Focus);
    assert_eq!(emission.steps[0].target_pane_id.as_deref(), Some("root"));
    assert_eq!(emission.summary.initial_pane_id, "root");
}

#[test]
fn rounds_percentages_and_orders_nested_splits_preorder() {
    let emission = emit(
        r#"
name: nested
layout:
  type: horizontal
  ratio: [1, 1, 1]
  panes:
    - name: first
    - type: vertical
      ratio: [1, 2]
      panes:
        - name: nested-one
        - name: nested-two
    - name: third
"#,
    );
    let splits = emission
        .steps
        .iter()
        .filter(|step| step.kind == CommandStepKind::Split)
        .collect::<Vec<_>>();
    assert_eq!(
        splits
            .iter()
            .map(|step| (step.id.as_str(), step.percentage))
            .collect::<Vec<_>>(),
        vec![
            ("root:split:1", Some(67)),
            ("root:split:2", Some(50)),
            ("root.1:split:1", Some(67)),
        ]
    );
}

#[test]
fn emits_dynamic_fixed_cell_metadata() {
    let emission = emit(
        "name: dynamic\nlayout:\n  type: horizontal\n  ratio: [\"90c\", 2, 1]\n  panes:\n    - { name: left }\n    - { name: middle }\n    - { name: right }\n",
    );
    let splits = emission
        .steps
        .iter()
        .filter(|step| step.kind == CommandStepKind::Split)
        .collect::<Vec<_>>();
    assert_eq!(
        splits[0].split_sizing,
        Some(SplitSizing::DynamicCells {
            target: CompiledRatioEntry::FixedCells { cells: 90.0 },
            remaining_fixed_cells: 0.0,
            remaining_weight: 3.0,
            remaining_weight_pane_count: 2,
        })
    );
    assert_eq!(
        splits[1].split_sizing,
        Some(SplitSizing::DynamicCells {
            target: CompiledRatioEntry::Weight { weight: 2.0 },
            remaining_fixed_cells: 0.0,
            remaining_weight: 1.0,
            remaining_weight_pane_count: 1,
        })
    );
}

#[test]
fn hash_is_deterministic_and_canonical_json_sorts_keys_and_numbers() {
    let preset = compile_preset(
        "name: hash\nlayout:\n  type: horizontal\n  ratio: [2, 1]\n  panes:\n    - { name: main }\n    - { name: aux }\n",
        "tests/hash.yml",
    )
    .unwrap();
    let plan = create_layout_plan(&preset).unwrap();
    assert_eq!(
        emit_plan(&plan).unwrap().hash,
        emit_plan(&plan).unwrap().hash
    );

    let canonical = canonical_json_value(&json!({ "z": 2.0, "a": { "y": 1, "x": 1.5 } })).unwrap();
    assert_eq!(
        serde_json::to_string(&canonical).unwrap(),
        r#"{"a":{"x":1.5,"y":1},"z":2}"#
    );
}

#[test]
fn rejects_malformed_plans_without_panicking() {
    let plan = LayoutPlan {
        focus_pane_id: "root.0".to_owned(),
        root: PlanNode::Split(PlanSplit {
            id: "root".to_owned(),
            orientation: Orientation::Horizontal,
            ratio: vec![CompiledRatioEntry::Weight { weight: 1.0 }],
            panes: vec![],
        }),
    };
    assert_eq!(emit_plan(&plan).unwrap_err().code, "LAYOUT_RATIO_MISMATCH");
}
