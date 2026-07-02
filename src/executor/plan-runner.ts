import type { PlanEmission } from "../core/emitter"
import type { ConfirmPaneClosure } from "../contracts"
import type { CommandExecutor } from "../contracts"
import { ErrorCodes } from "../utils/errors"
import type { WindowMode } from "../models/types"
import { classifyWindowPanes } from "./sidebar-detection"
import {
  executeCommand,
  executeFocusStep,
  executeSplitStep,
  executeTerminalCommands,
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
  readonly paneMap: ReadonlyMap<string, string>
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

    // Target the classification at the current pane's own window (via `-t
    // currentPaneId`) rather than tmux's "active" window, so multi-window/multi-session
    // setups always classify the window this invocation is actually running in.
    const { sidebarPanes, normalPanes } = await classifyWindowPanes(executor, initialVirtualPaneId, currentPaneId)
    const sidebarPaneIds = new Set(sidebarPanes)

    let originPaneId: string
    if (sidebarPaneIds.has(currentPaneId)) {
      // The resolved "current pane" is the protected sidebar pane itself. Rebuild the
      // layout starting from the first non-sidebar pane instead, splitting a fresh one
      // beside the sidebar when the window has no other panes to build on.
      const [firstNormalPane] = normalPanes
      originPaneId =
        firstNormalPane !== undefined
          ? firstNormalPane
          : await splitPaneBesideSidebar({
              executor,
              sidebarPaneId: currentPaneId,
              contextPath: initialVirtualPaneId,
            })
    } else {
      originPaneId = currentPaneId
    }

    const panesToClose = normalPanes.filter((paneId) => paneId !== originPaneId)

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

      // `kill-pane -a` would also kill protected sidebar panes in real tmux, so close
      // each non-sidebar pane individually instead of relying on the bulk flag.
      for (const paneId of panesToClose) {
        await executeCommand(executor, ["kill-pane", "-t", paneId], {
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: "Failed to close existing panes",
          path: initialVirtualPaneId,
          details: { command: ["kill-pane", "-t", paneId] },
        })
      }
    }

    initialPaneId = normalizePaneId(originPaneId)
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

  return { executedSteps, paneMap }
}

/**
 * Splits a fresh pane beside the sidebar so it can be used as the layout's origin
 * pane. Only reached when the current window contains nothing but sidebar panes
 * (no normal pane to reuse). The split direction is fixed to a horizontal split
 * away from the sidebar (i.e. the new pane appears on the opposite side).
 *
 * Uses `-P -F "#{pane_id}"` to have tmux report the newly created pane id directly
 * in the split-window output, rather than diffing a follow-up `list-panes` call
 * against the pre-split pane set (which was fragile under concurrent pane changes).
 */
const splitPaneBesideSidebar = async ({
  executor,
  sidebarPaneId,
  contextPath,
}: {
  readonly executor: CommandExecutor
  readonly sidebarPaneId: string
  readonly contextPath: string
}): Promise<string> => {
  const command = ["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", sidebarPaneId]
  const output = await executeCommand(executor, command, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: "Failed to split a pane beside the sidebar",
    path: contextPath,
    details: { command },
  })

  const newPaneId = output.trim()
  if (newPaneId.length === 0) {
    return raiseExecutionError(ErrorCodes.INVALID_PANE, {
      message: "Unable to determine the pane created beside the sidebar",
      path: contextPath,
    })
  }

  return newPaneId
}
