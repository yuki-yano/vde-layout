import { execFileSync } from "node:child_process"
import { type PaneDimensions, updatePaneSizes } from "../pane-tracking"
import { createTmuxExecutor } from "./executor"
import type { CommandStep, PlanEmission } from "../../core/emitter"
import { isCoreError } from "../../core/errors"
import { executePlan } from "../../executor/plan-runner"
import { resolveSplitOrientation as resolveSplitOrientationFromStep, resolveSplitSize } from "../../executor/split-step"
import { resolveRequiredStepTargetPaneId } from "../../executor/step-target"
import { createUnsupportedStepKindError } from "../../executor/unsupported-step-kind"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  TmuxTerminalBackendContext,
} from "../../executor/terminal-backend"
import { ErrorCodes } from "../../utils/errors"

const TMUX_VERSION_REGEX = /^tmux\s+(.+)$/

export const createTmuxBackend = (context: TmuxTerminalBackendContext): TerminalBackend => {
  const tmuxExecutor = createTmuxExecutor({
    executor: context.executor,
    verbose: context.verbose,
    dryRun: context.dryRun,
  })

  let detectedVersion: string | undefined

  const buildDryRunSteps = (emission: PlanEmission): DryRunStep[] => {
    const paneSizes = new Map<string, PaneDimensions>()
    const initialPane = emission.summary.initialPaneId
    const initialPaneSize = resolveInitialTmuxPaneSize()
    if (initialPaneSize !== undefined) {
      paneSizes.set(initialPane, initialPaneSize)
    }

    return emission.steps.map((step) => ({
      backend: "tmux" as const,
      summary: step.summary,
      command: tmuxExecutor.getCommandString(
        buildTmuxCommand({
          step,
          paneSizes,
          detectedVersion,
        }),
      ),
    }))
  }

  const verifyEnvironment = async (): Promise<void> => {
    if (context.dryRun) {
      return
    }
    await tmuxExecutor.verifyTmuxEnvironment()
    detectedVersion = await detectTmuxVersion(tmuxExecutor)
  }

  const applyPlan = async ({ emission, windowMode, windowName }: ApplyPlanParameters): Promise<ApplyPlanResult> => {
    const executionResult = await executePlan({
      emission,
      executor: tmuxExecutor.getExecutor(),
      windowMode,
      windowName,
      onConfirmKill: context.prompt,
      detectedVersion,
    })

    return {
      executedSteps: executionResult.executedSteps,
      focusPaneId: emission.summary.focusPaneId,
    }
  }

  return {
    verifyEnvironment,
    applyPlan,
    getDryRunSteps: buildDryRunSteps,
  }
}

const buildTmuxCommand = ({
  step,
  paneSizes,
  detectedVersion,
}: {
  readonly step: CommandStep
  readonly paneSizes: Map<string, PaneDimensions>
  readonly detectedVersion?: string
}): string[] => {
  if (step.kind === "split") {
    const target = resolveRequiredStepTargetPaneId(step)
    const orientation = resolveSplitOrientationFromStep(step)
    const direction = orientation === "horizontal" ? "-h" : "-v"

    if (step.splitSizing?.mode === "dynamic-cells") {
      const paneSize = paneSizes.get(target)
      if (paneSize !== undefined) {
        const paneCells = orientation === "horizontal" ? paneSize.cols : paneSize.rows

        try {
          const splitSize = resolveSplitSize(step, {
            paneCells,
            paneId: target,
            detectedVersion,
            rawPaneRecord: {
              backend: "tmux",
              paneId: target,
              sourceFormat: "tmux-format",
              size: {
                cols: paneSize.cols,
                rows: paneSize.rows,
              },
            },
          })

          if (splitSize.mode === "cells") {
            if (typeof step.createdPaneId === "string" && step.createdPaneId.length > 0) {
              updatePaneSizes({
                paneSizes,
                targetPaneId: target,
                createdPaneId: step.createdPaneId,
                orientation,
                targetCells: splitSize.targetCells,
                createdCells: splitSize.createdCells,
              })
            }
            return ["split-window", direction, "-t", target, "-l", splitSize.cells]
          }
        } catch (error) {
          if (isCoreError(error) && error.code === ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED) {
            // dry-run intentionally falls back to a placeholder when pane size cannot be resolved
          } else {
            throw error
          }
        }
      }

      return ["split-window", direction, "-t", target, "-l", "<dynamic>"]
    }

    const splitSize = resolveSplitSize(step, {
      paneId: target,
      detectedVersion,
    })
    if (splitSize.mode !== "percent") {
      throw createUnsupportedStepKindError(step)
    }
    return ["split-window", direction, "-t", target, "-p", splitSize.percentage]
  }

  if (step.kind === "focus") {
    const target = resolveRequiredStepTargetPaneId(step)
    return ["select-pane", "-t", target]
  }

  throw createUnsupportedStepKindError(step)
}

const detectTmuxVersion = async (tmuxExecutor: ReturnType<typeof createTmuxExecutor>): Promise<string | undefined> => {
  try {
    const raw = await tmuxExecutor.execute(["-V"])
    const match = raw.trim().match(TMUX_VERSION_REGEX)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

const resolveInitialTmuxPaneSize = (): PaneDimensions | undefined => {
  const tmuxPane = process.env.TMUX_PANE
  const tmuxSession = process.env.TMUX
  if (
    typeof tmuxSession !== "string" ||
    tmuxSession.length === 0 ||
    typeof tmuxPane !== "string" ||
    tmuxPane.length === 0
  ) {
    return undefined
  }

  try {
    const sizeOutput = execFileSync("tmux", ["display-message", "-p", "-t", tmuxPane, "#{pane_width} #{pane_height}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    const [colsRaw = "", rowsRaw = ""] = sizeOutput.split(/\s+/, 2)

    const cols = Number.parseInt(colsRaw, 10)
    const rows = Number.parseInt(rowsRaw, 10)
    if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
      return undefined
    }
    return { cols, rows }
  } catch {
    return undefined
  }
}
