use serde_json::{Value, json};

use crate::core::{
    CommandStep, CommandStepKind, CompiledRatioEntry, CoreError, CoreErrorKind, SplitSizing,
};
use crate::model::Orientation;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SplitSizeResolutionContext {
    pub pane_cells: Option<u64>,
    pub pane_id: Option<String>,
    pub required_version: Option<String>,
    pub detected_version: Option<String>,
    pub raw_pane_record: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSplitSize {
    Percent {
        percentage: String,
    },
    Cells {
        cells: String,
        target_cells: u64,
        created_cells: u64,
    },
}

pub fn resolve_split_orientation(step: &CommandStep) -> Result<Orientation, CoreError> {
    assert_split(step, "orientation")?;
    step.orientation.ok_or_else(|| {
        execution_error(
            "INVALID_PLAN",
            "Split step missing orientation metadata",
            &step.id,
            json!({ "orientation": step.orientation }),
        )
    })
}

pub fn resolve_split_size(
    step: &CommandStep,
    context: &SplitSizeResolutionContext,
) -> Result<ResolvedSplitSize, CoreError> {
    assert_split(step, "sizing")?;
    let Some(sizing) = step.split_sizing.as_ref() else {
        return step.percentage.map_or_else(
            || {
                Err(execution_error(
                    "INVALID_PLAN",
                    "Split step missing sizing metadata",
                    &step.id,
                    json!({ "percentage": step.percentage }),
                ))
            },
            |percentage| {
                Ok(ResolvedSplitSize::Percent {
                    percentage: clamp_percentage(f64::from(percentage)).to_string(),
                })
            },
        );
    };
    match sizing {
        SplitSizing::Percent { percentage } => Ok(ResolvedSplitSize::Percent {
            percentage: clamp_percentage(f64::from(*percentage)).to_string(),
        }),
        SplitSizing::DynamicCells {
            target,
            remaining_fixed_cells,
            remaining_weight,
            remaining_weight_pane_count,
        } => resolve_dynamic(
            step,
            target,
            *remaining_fixed_cells,
            *remaining_weight,
            *remaining_weight_pane_count,
            context,
        ),
    }
}

pub fn resolve_split_percentage(step: &CommandStep) -> Result<String, CoreError> {
    assert_split(step, "percentage")?;
    if matches!(step.split_sizing, Some(SplitSizing::DynamicCells { .. })) {
        return Err(execution_error(
            "INVALID_PLAN",
            "Split step uses dynamic sizing and has no percentage value",
            &step.id,
            json!({ "splitSizing": step.split_sizing }),
        ));
    }
    match resolve_split_size(step, &Default::default())? {
        ResolvedSplitSize::Percent { percentage } => Ok(percentage),
        ResolvedSplitSize::Cells { .. } => Err(execution_error(
            "INVALID_PLAN",
            "Split step uses dynamic sizing and has no percentage value",
            &step.id,
            json!({ "splitSizing": step.split_sizing }),
        )),
    }
}

fn resolve_dynamic(
    step: &CommandStep,
    target: &CompiledRatioEntry,
    remaining_fixed_cells: f64,
    remaining_weight: f64,
    remaining_weight_pane_count: usize,
    context: &SplitSizeResolutionContext,
) -> Result<ResolvedSplitSize, CoreError> {
    let metadata = DynamicMetadata {
        target,
        remaining_fixed_cells,
        remaining_weight,
        remaining_weight_pane_count,
    };
    let pane_cells = context.pane_cells.ok_or_else(|| {
        dynamic_error(
            "SPLIT_SIZE_RESOLUTION_FAILED",
            "Pane size is unavailable for dynamic split sizing",
            step,
            context,
            &metadata,
        )
    })?;
    if !remaining_fixed_cells.is_finite()
        || remaining_fixed_cells.fract() != 0.0
        || remaining_fixed_cells < 0.0
        || !remaining_weight.is_finite()
        || remaining_weight < 0.0
    {
        return Err(dynamic_error(
            "INVALID_PLAN",
            "Split step has invalid dynamic sizing metadata",
            step,
            context,
            &metadata,
        ));
    }
    let min_target = match target {
        CompiledRatioEntry::FixedCells { cells }
            if cells.is_finite() && cells.fract() == 0.0 && *cells > 0.0 =>
        {
            *cells
        }
        CompiledRatioEntry::FixedCells { .. } => {
            return Err(dynamic_error(
                "INVALID_PLAN",
                "Split step has invalid minimum-cell constraints",
                step,
                context,
                &metadata,
            ));
        }
        CompiledRatioEntry::Weight { .. } => 1.0,
    };
    let min_created = remaining_fixed_cells + remaining_weight_pane_count as f64;
    let pane_cells_f64 = pane_cells as f64;
    if !min_created.is_finite()
        || min_created.fract() != 0.0
        || min_created < 0.0
        || pane_cells_f64 < min_target + min_created
    {
        return Err(dynamic_error(
            "SPLIT_SIZE_RESOLUTION_FAILED",
            "Pane is too small for requested fixed and weighted splits",
            step,
            context,
            &metadata,
        ));
    }
    let target_cells = match target {
        CompiledRatioEntry::FixedCells { cells } => *cells,
        CompiledRatioEntry::Weight { weight } => {
            if !weight.is_finite() || *weight <= 0.0 {
                return Err(dynamic_error(
                    "INVALID_PLAN",
                    "Split step has invalid weight metadata",
                    step,
                    context,
                    &metadata,
                ));
            }
            let total = *weight + remaining_weight;
            if !total.is_finite() || total <= 0.0 {
                return Err(dynamic_error(
                    "INVALID_PLAN",
                    "Split step has invalid dynamic weight totals",
                    step,
                    context,
                    &metadata,
                ));
            }
            let available = pane_cells_f64 - remaining_fixed_cells;
            let raw = (available * *weight / total).round();
            raw.clamp(min_target, pane_cells_f64 - min_created)
        }
    };
    let created_cells = pane_cells_f64 - target_cells;
    if target_cells < min_target
        || created_cells < min_created
        || target_cells <= 0.0
        || created_cells <= 0.0
        || target_cells > u64::MAX as f64
        || created_cells > u64::MAX as f64
    {
        let mut error = dynamic_error(
            "SPLIT_SIZE_RESOLUTION_FAILED",
            "Unable to resolve split size without violating pane minimums",
            step,
            context,
            &metadata,
        );
        error
            .details
            .insert("targetCells".to_owned(), json!(target_cells));
        error
            .details
            .insert("createdCells".to_owned(), json!(created_cells));
        return Err(error);
    }
    let target_cells = target_cells as u64;
    let created_cells = created_cells as u64;
    Ok(ResolvedSplitSize::Cells {
        cells: created_cells.to_string(),
        target_cells,
        created_cells,
    })
}

fn assert_split(step: &CommandStep, field: &str) -> Result<(), CoreError> {
    if step.kind == CommandStepKind::Split {
        Ok(())
    } else {
        Err(execution_error(
            "INVALID_PLAN",
            format!("Non-split step cannot resolve split {field}"),
            &step.id,
            json!({ "kind": step.kind }),
        ))
    }
}

fn clamp_percentage(value: f64) -> u8 {
    value.round().clamp(1.0, 99.0) as u8
}

struct DynamicMetadata<'a> {
    target: &'a CompiledRatioEntry,
    remaining_fixed_cells: f64,
    remaining_weight: f64,
    remaining_weight_pane_count: usize,
}

fn dynamic_error(
    code: &str,
    message: &str,
    step: &CommandStep,
    context: &SplitSizeResolutionContext,
    metadata: &DynamicMetadata<'_>,
) -> CoreError {
    execution_error(
        code,
        message,
        &step.id,
        json!({
            "stepId": step.id,
            "paneId": context.pane_id,
            "paneCells": context.pane_cells,
            "targetSpec": metadata.target,
            "remainingFixedCells": metadata.remaining_fixed_cells,
            "remainingWeight": metadata.remaining_weight,
            "remainingWeightPaneCount": metadata.remaining_weight_pane_count,
            "requiredVersion": context.required_version,
            "detectedVersion": context.detected_version,
            "rawPaneRecord": context.raw_pane_record,
        }),
    )
}

fn execution_error(
    code: &str,
    message: impl Into<String>,
    path: &str,
    details: Value,
) -> CoreError {
    CoreError::new(CoreErrorKind::Execution, code, message)
        .with_path(path)
        .with_details(details.as_object().cloned().unwrap_or_default())
}
