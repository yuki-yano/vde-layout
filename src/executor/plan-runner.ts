import type { PlanEmission } from "../core/emitter"
import type { ConfirmPaneClosure } from "../contracts"
import type { CommandExecutor } from "../contracts"
import { ErrorCodes } from "../utils/errors"
import type { WindowMode } from "../models/types"
import {
  executeCommand,
  executeFocusStep,
  executeSplitStep,
  executeTerminalCommands,
  listWindowPaneIds,
  normalizePaneId,
  raiseExecutionError,
  registerPane,
  resolveCurrentPaneId,
  resolvePaneId,
} from "./plan-runner-helpers"

type ExecutePlanInput = {
  readonly emission: PlanEmission
  readonly executor: CommandExecutor
  readonly windowName?: string
  readonly windowMode: WindowMode
  readonly onConfirmKill?: ConfirmPaneClosure
  readonly detectedVersion?: string
}

type ExecutePlanSuccess = {
  readonly executedSteps: number
}

export const executePlan = async ({
  emission,
  executor,
  windowName,
  windowMode,
  onConfirmKill,
  detectedVersion,
}: ExecutePlanInput): Promise<ExecutePlanSuccess> => {
  const initialVirtualPaneId = emission.summary.initialPaneId
  if (typeof initialVirtualPaneId !== "string" || initialVirtualPaneId.length === 0) {
    raiseExecutionError(ErrorCodes.INVALID_PLAN, {
      message: "Plan emission is missing initial pane metadata",
      path: "plan.initialPaneId",
    })
  }

  const paneMap = new Map<string, string>()

  const isDryRun = executor.isDryRun()

  let initialPaneId: string

  if (windowMode === "current-window") {
    const currentPaneId = await resolveCurrentPaneId({
      executor,
      contextPath: initialVirtualPaneId,
      isDryRun,
    })

    const panesInWindow = await listWindowPaneIds(executor, initialVirtualPaneId)
    const panesToClose = panesInWindow.filter((paneId) => paneId !== currentPaneId)

    if (panesToClose.length > 0) {
      let confirmed = true
      if (onConfirmKill !== undefined) {
        confirmed = await onConfirmKill({ panesToClose, dryRun: isDryRun })
      }

      if (confirmed !== true) {
        raiseExecutionError(ErrorCodes.USER_CANCELLED, {
          message: "Aborted layout application for current window",
          path: initialVirtualPaneId,
          details: { panes: panesToClose },
        })
      }

      await executeCommand(executor, ["kill-pane", "-a", "-t", currentPaneId], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: "Failed to close existing panes",
        path: initialVirtualPaneId,
        details: { command: ["kill-pane", "-a", "-t", currentPaneId] },
      })
    }

    initialPaneId = normalizePaneId(currentPaneId)
  } else {
    const newWindowCommand: string[] = ["new-window", "-P", "-F", "#{pane_id}"]
    if (typeof windowName === "string" && windowName.trim().length > 0) {
      newWindowCommand.push("-n", windowName.trim())
    }

    const createdPane = await executeCommand(executor, newWindowCommand, {
      code: ErrorCodes.TMUX_COMMAND_FAILED,
      message: "Failed to create tmux window",
      path: initialVirtualPaneId,
    })
    initialPaneId = normalizePaneId(createdPane)
  }

  registerPane(paneMap, initialVirtualPaneId, initialPaneId)

  let executedSteps = 0

  for (const step of emission.steps) {
    if (step.kind === "split") {
      await executeSplitStep({ step, executor, paneMap, detectedVersion })
      executedSteps += 1
    } else if (step.kind === "focus") {
      await executeFocusStep({ step, executor, paneMap })
      executedSteps += 1
    } else {
      raiseExecutionError(ErrorCodes.INVALID_PLAN, {
        message: `Unsupported step kind in emission: ${String((step as { kind?: unknown }).kind)}`,
        path: step.id,
      })
    }
  }

  await executeTerminalCommands({
    terminals: emission.terminals,
    executor,
    paneMap,
    focusPaneVirtualId: emission.summary.focusPaneId,
  })

  const finalRealFocus = resolvePaneId(paneMap, emission.summary.focusPaneId)
  if (typeof finalRealFocus === "string" && finalRealFocus.length > 0) {
    await executeCommand(executor, ["select-pane", "-t", finalRealFocus], {
      code: ErrorCodes.TMUX_COMMAND_FAILED,
      message: "Failed to restore focus",
      path: emission.summary.focusPaneId,
    })
  }

  return { executedSteps }
}
