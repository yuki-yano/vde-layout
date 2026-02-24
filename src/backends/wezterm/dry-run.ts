import type { PlanEmission } from "../../core/emitter"
import { createCoreError, isCoreError } from "../../core/errors"
import { resolveSplitOrientation, resolveSplitSize, type ResolvedSplitSize } from "../../executor/split-step"
import { resolveRequiredStepTargetPaneId } from "../../executor/step-target"
import { prepareTerminalCommands } from "../../executor/terminal-command-preparation"
import type { DryRunStep } from "../../executor/terminal-backend"
import { ErrorCodes } from "../../utils/errors"

const SINGLE_QUOTE = "'"
const SHELL_SINGLE_QUOTE_ESCAPE = `'"'"'`

type PaneDimensions = {
  readonly cols: number
  readonly rows: number
}

type SplitArgumentSize =
  | ResolvedSplitSize
  | {
      readonly mode: "cells-placeholder"
      readonly cellsPlaceholder: string
    }

export type BuildWeztermDryRunStepsOptions = {
  readonly initialPaneId?: string
  readonly initialPaneSize?: PaneDimensions
  readonly detectedVersion?: string
}

export const buildSplitArguments = (params: {
  readonly targetPaneId: string
  readonly splitSize: SplitArgumentSize
  readonly horizontal: boolean
}): string[] => {
  const directionFlag = params.horizontal ? "--right" : "--bottom"
  if (params.splitSize.mode === "percent") {
    return ["split-pane", directionFlag, "--percent", params.splitSize.percentage, "--pane-id", params.targetPaneId]
  }

  if (params.splitSize.mode === "cells") {
    return ["split-pane", directionFlag, "--cells", params.splitSize.cells, "--pane-id", params.targetPaneId]
  }

  return ["split-pane", directionFlag, "--cells", params.splitSize.cellsPlaceholder, "--pane-id", params.targetPaneId]
}

export const buildDryRunSteps = (
  emission: PlanEmission,
  options: BuildWeztermDryRunStepsOptions = {},
): DryRunStep[] => {
  const steps: DryRunStep[] = []
  const paneSizes = new Map<string, PaneDimensions>()
  if (options.initialPaneId !== undefined && options.initialPaneSize !== undefined) {
    paneSizes.set(options.initialPaneId, options.initialPaneSize)
  }

  for (const step of emission.steps) {
    if (step.kind === "split") {
      const target = resolveRequiredStepTargetPaneId(step)
      const horizontal = resolveSplitOrientation(step) === "horizontal"
      const splitSize = resolveDryRunSplitSize({
        step,
        targetPaneId: target,
        paneSizes,
        orientation: horizontal ? "horizontal" : "vertical",
        detectedVersion: options.detectedVersion,
      })
      const args = buildSplitArguments({
        targetPaneId: target,
        splitSize,
        horizontal,
      })
      const summary = step.splitSizing?.mode === "dynamic-cells" ? `${step.summary} [dynamic-cells]` : step.summary
      steps.push({
        backend: "wezterm",
        summary,
        command: `wezterm cli ${args.join(" ")}`,
      })
      continue
    }

    if (step.kind === "focus") {
      const target = resolveRequiredStepTargetPaneId(step)
      steps.push({
        backend: "wezterm",
        summary: step.summary,
        command: `wezterm cli activate-pane --pane-id ${target}`,
      })
      continue
    }

    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: `Unsupported step kind in emission: ${String((step as { kind?: unknown }).kind)}`,
      path: step.id,
    })
  }

  const prepared = prepareTerminalCommands({
    terminals: emission.terminals,
    focusPaneVirtualId: emission.summary.focusPaneId,
    resolveRealPaneId: (virtualPaneId: string): string => virtualPaneId,
    onTemplateTokenError: ({ terminal, error }): never => {
      throw createCoreError("execution", {
        code: ErrorCodes.TEMPLATE_TOKEN_ERROR,
        message: `Template token resolution failed for pane ${terminal.virtualPaneId}: ${error.message}`,
        path: terminal.virtualPaneId,
        details: {
          command: terminal.command,
          tokenType: error.tokenType,
          availablePanes: error.availablePanes,
        },
      })
    },
  })

  const quoteForShellDisplay = (value: string): string => {
    return `${SINGLE_QUOTE}${value.split(SINGLE_QUOTE).join(SHELL_SINGLE_QUOTE_ESCAPE)}${SINGLE_QUOTE}`
  }

  for (const commandSet of prepared.commands) {
    const paneId = commandSet.terminal.virtualPaneId
    if (typeof commandSet.cwdCommand === "string") {
      steps.push({
        backend: "wezterm",
        summary: `set cwd for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- ${quoteForShellDisplay(commandSet.cwdCommand)}`,
      })
    }

    for (const envEntry of commandSet.envCommands) {
      steps.push({
        backend: "wezterm",
        summary: `set env ${envEntry.key} for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- ${quoteForShellDisplay(envEntry.command)}`,
      })
    }

    if (commandSet.command !== undefined) {
      steps.push({
        backend: "wezterm",
        summary: `run command for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- ${quoteForShellDisplay(commandSet.command.text)}`,
      })
    }
  }

  return steps
}

const resolveDryRunSplitSize = ({
  step,
  targetPaneId,
  paneSizes,
  orientation,
  detectedVersion,
}: {
  readonly step: PlanEmission["steps"][number]
  readonly targetPaneId: string
  readonly paneSizes: Map<string, PaneDimensions>
  readonly orientation: "horizontal" | "vertical"
  readonly detectedVersion?: string
}): SplitArgumentSize => {
  if (step.kind !== "split") {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Dry-run split sizing requested for non-split step",
      path: step.id,
    })
  }

  if (step.splitSizing?.mode === "dynamic-cells") {
    const paneSize = paneSizes.get(targetPaneId)
    const paneCells = paneSize ? (orientation === "horizontal" ? paneSize.cols : paneSize.rows) : undefined

    if (typeof paneCells !== "number") {
      return {
        mode: "cells-placeholder",
        cellsPlaceholder: "<dynamic>",
      }
    }

    try {
      const splitSize = resolveSplitSize(step, {
        paneCells,
        paneId: targetPaneId,
        detectedVersion,
        rawPaneRecord: {
          backend: "wezterm",
          paneId: targetPaneId,
          sourceFormat: "unknown",
          size: paneSize,
        },
      })

      if (splitSize.mode === "cells" && typeof step.createdPaneId === "string" && step.createdPaneId.length > 0) {
        updatePaneSizes({
          paneSizes,
          targetPaneId,
          createdPaneId: step.createdPaneId,
          orientation,
          targetCells: splitSize.targetCells,
          createdCells: splitSize.createdCells,
        })
      }

      if (splitSize.mode === "cells") {
        return splitSize
      }
    } catch (error) {
      if (isCoreError(error) && error.code === ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED) {
        return {
          mode: "cells-placeholder",
          cellsPlaceholder: "<dynamic>",
        }
      }
      throw error
    }

    return {
      mode: "cells-placeholder",
      cellsPlaceholder: "<dynamic>",
    }
  }

  return resolveSplitSize(step, {
    paneId: targetPaneId,
    detectedVersion,
  })
}

const updatePaneSizes = ({
  paneSizes,
  targetPaneId,
  createdPaneId,
  orientation,
  targetCells,
  createdCells,
}: {
  readonly paneSizes: Map<string, PaneDimensions>
  readonly targetPaneId: string
  readonly createdPaneId: string
  readonly orientation: "horizontal" | "vertical"
  readonly targetCells: number
  readonly createdCells: number
}): void => {
  const base = paneSizes.get(targetPaneId)
  if (base === undefined) {
    return
  }

  if (orientation === "horizontal") {
    paneSizes.set(targetPaneId, { cols: targetCells, rows: base.rows })
    paneSizes.set(createdPaneId, { cols: createdCells, rows: base.rows })
    return
  }

  paneSizes.set(targetPaneId, { cols: base.cols, rows: targetCells })
  paneSizes.set(createdPaneId, { cols: base.cols, rows: createdCells })
}
