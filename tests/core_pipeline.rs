use vde_layout::core::compile_core_pipeline;

#[test]
fn compiles_plans_and_emissions_through_the_pipeline() {
    let result = compile_core_pipeline(
        "name: pipeline\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: main, command: nvim, focus: true }\n    - { name: aux }\n",
        "tests/pipeline.yml",
    )
    .unwrap();
    assert_eq!(result.preset.metadata.source, "tests/pipeline.yml");
    assert_eq!(result.plan.focus_pane_id, "root.0");
    assert!(!result.emission.steps.is_empty());
    assert_eq!(result.emission.hash.len(), 64);
}

#[test]
fn propagates_stage_errors() {
    let error = compile_core_pipeline("name: [unterminated", "tests/broken.yml").unwrap_err();
    assert_eq!(error.code, "PRESET_PARSE_ERROR");

    let error = compile_core_pipeline(
        "name: focus\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one, focus: true }\n    - { name: two, focus: true }\n",
        "tests/focus.yml",
    )
    .unwrap_err();
    assert_eq!(error.code, "FOCUS_CONFLICT");
}
