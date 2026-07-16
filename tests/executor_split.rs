use vde_layout::Orientation;
use vde_layout::core::{CommandStep, CommandStepKind, CompiledRatioEntry, SplitSizing};
use vde_layout::executor::{
    ResolvedSplitSize, SplitSizeResolutionContext, resolve_split_orientation,
    resolve_split_percentage, resolve_split_size,
};

fn split(sizing: SplitSizing) -> CommandStep {
    CommandStep {
        id: "root:split:1".to_owned(),
        kind: CommandStepKind::Split,
        command: None,
        summary: "split".to_owned(),
        target_pane_id: Some("root.0".to_owned()),
        created_pane_id: Some("root.1".to_owned()),
        orientation: Some(Orientation::Horizontal),
        percentage: None,
        split_sizing: Some(sizing),
    }
}

#[test]
fn resolves_percent_and_orientation() {
    let step = split(SplitSizing::Percent { percentage: 67 });
    assert_eq!(
        resolve_split_orientation(&step).unwrap(),
        Orientation::Horizontal
    );
    assert_eq!(
        resolve_split_size(&step, &Default::default()).unwrap(),
        ResolvedSplitSize::Percent {
            percentage: "67".to_owned()
        }
    );
    assert_eq!(resolve_split_percentage(&step).unwrap(), "67");

    let legacy = CommandStep {
        split_sizing: None,
        percentage: Some(50),
        ..step
    };
    assert_eq!(resolve_split_percentage(&legacy).unwrap(), "50");
}

#[test]
fn resolves_fixed_and_weighted_dynamic_sizes() {
    let fixed = split(SplitSizing::DynamicCells {
        target: CompiledRatioEntry::FixedCells { cells: 90.0 },
        remaining_fixed_cells: 0.0,
        remaining_weight: 3.0,
        remaining_weight_pane_count: 2,
    });
    assert_eq!(
        resolve_split_size(
            &fixed,
            &SplitSizeResolutionContext {
                pane_cells: Some(200),
                ..Default::default()
            }
        )
        .unwrap(),
        ResolvedSplitSize::Cells {
            cells: "110".to_owned(),
            target_cells: 90,
            created_cells: 110,
        }
    );

    let weighted = split(SplitSizing::DynamicCells {
        target: CompiledRatioEntry::Weight { weight: 2.0 },
        remaining_fixed_cells: 10.0,
        remaining_weight: 1.0,
        remaining_weight_pane_count: 1,
    });
    assert_eq!(
        resolve_split_size(
            &weighted,
            &SplitSizeResolutionContext {
                pane_cells: Some(100),
                ..Default::default()
            }
        )
        .unwrap(),
        ResolvedSplitSize::Cells {
            cells: "40".to_owned(),
            target_cells: 60,
            created_cells: 40,
        }
    );
}

#[test]
fn reports_invalid_and_unresolvable_dynamic_metadata() {
    let dynamic = split(SplitSizing::DynamicCells {
        target: CompiledRatioEntry::FixedCells { cells: 90.0 },
        remaining_fixed_cells: 20.0,
        remaining_weight: 0.0,
        remaining_weight_pane_count: 1,
    });
    assert_eq!(
        resolve_split_size(&dynamic, &Default::default())
            .unwrap_err()
            .code,
        "SPLIT_SIZE_RESOLUTION_FAILED"
    );
    assert_eq!(
        resolve_split_size(
            &dynamic,
            &SplitSizeResolutionContext {
                pane_cells: Some(100),
                ..Default::default()
            }
        )
        .unwrap_err()
        .code,
        "SPLIT_SIZE_RESOLUTION_FAILED"
    );

    let focus = CommandStep {
        kind: CommandStepKind::Focus,
        ..dynamic
    };
    assert_eq!(
        resolve_split_orientation(&focus).unwrap_err().code,
        "INVALID_PLAN"
    );
}

#[test]
fn matches_typescript_validation_order_for_invalid_weight_and_small_pane() {
    let invalid_weight = split(SplitSizing::DynamicCells {
        target: CompiledRatioEntry::Weight { weight: f64::NAN },
        remaining_fixed_cells: 0.0,
        remaining_weight: 1.0,
        remaining_weight_pane_count: 1,
    });
    assert_eq!(
        resolve_split_size(
            &invalid_weight,
            &SplitSizeResolutionContext {
                pane_cells: Some(1),
                ..Default::default()
            },
        )
        .unwrap_err()
        .code,
        "SPLIT_SIZE_RESOLUTION_FAILED"
    );
    let error = resolve_split_size(
        &invalid_weight,
        &SplitSizeResolutionContext {
            pane_cells: Some(100),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "INVALID_PLAN");
    assert_eq!(error.message, "Split step has invalid weight metadata");
}
