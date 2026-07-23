use pretty_assertions::assert_eq;
use serde_json::{Value, json};
use vde_layout::core::{
    canonical_json_value, compile_preset_from_value, create_layout_plan, emit_plan,
};

fn assert_parity(input: &str, golden: &str, source: &str) {
    let input: Value = serde_json::from_str(input).unwrap();
    let expected: Value = serde_json::from_str(golden).unwrap();
    let preset = compile_preset_from_value(&input, source).unwrap();
    let plan = create_layout_plan(&preset).unwrap();
    let emission = emit_plan(&plan).unwrap();
    let actual = json!({
        "plan": plan,
        "emission": {
            "steps": emission.steps,
            "summary": emission.summary,
            "terminals": emission.terminals,
        },
    });

    assert_eq!(canonical_json_value(&actual).unwrap(), expected);
}

#[test]
fn rust_plan_and_emission_match_typescript_golden_structures() {
    let fixtures = [
        (
            include_str!("fixtures/core-plan-input.json"),
            include_str!("fixtures/core-plan-golden.json"),
            "tests/fixtures/core-plan-input.json",
        ),
        (
            include_str!("fixtures/core-complex-input.json"),
            include_str!("fixtures/core-complex-golden.json"),
            "tests/fixtures/core-complex-input.json",
        ),
        (
            include_str!("fixtures/core-single-input.json"),
            include_str!("fixtures/core-single-golden.json"),
            "tests/fixtures/core-single-input.json",
        ),
    ];

    for (input, golden, source) in fixtures {
        assert_parity(input, golden, source);
    }
}
