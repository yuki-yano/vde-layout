import type { CommandStep, EmittedTerminal } from "../../core/emitter"
import { createCoreError } from "../../core/errors"
import { resolveSplitOrientation, resolveSplitSize } from "../../executor/split-step"
import { prepareTerminalCommands } from "../../executor/terminal-command-preparation"
import { waitForDelay } from "../../utils/async"
import { ErrorCodes } from "../../utils/errors"
import { buildSplitArguments } from "./dry-run"
import { collectPaneIdsForWindow } from "./layout-resolution"
import { registerPaneWithAncestors, resolveRealPaneId } from "./pane-map"
import type { ExecuteWeztermCommand, ListWeztermWindows, LogPaneMapping, PaneMap } from "./shared"
import { WEZTERM_MINIMUM_VERSION, type WeztermListResult } from "./cli"

const findNewPaneId = (before: Set<string>, after: Set<string>): string | undefined => {
  for (const paneId of after) {
    if (!before.has(paneId)) {
      return paneId
    }
  }
  return undefined
}

const appendCarriageReturn = (value: string): string => {
  return value.endsWith("\r") ? value : `${value}\r`
}

const sendTextToPane = async ({
  paneId,
  text,
  runCommand,
  context,
}: {
  readonly paneId: string
  readonly text: string
  readonly runCommand: ExecuteWeztermCommand
  readonly context: { readonly message: string; readonly path: string; readonly details?: Record<string, unknown> }
}): Promise<void> => {
  await runCommand(["send-text", "--pane-id", paneId, "--no-paste", "--", appendCarriageReturn(text)], context)
}

export const applyFocusStep = async ({
  step,
  paneMap,
  runCommand,
}: {
  readonly step: CommandStep
  readonly paneMap: PaneMap
  readonly runCommand: ExecuteWeztermCommand
}): Promise<void> => {
  const targetVirtualId = step.targetPaneId
  if (typeof targetVirtualId !== "string" || targetVirtualId.length === 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PANE,
      message: "Focus step missing target pane metadata",
      path: step.id,
    })
  }

  const targetRealId = resolveRealPaneId(paneMap, targetVirtualId, { stepId: step.id })

  await runCommand(["activate-pane", "--pane-id", targetRealId], {
    message: `Failed to execute focus step ${step.id}`,
    path: step.id,
  })
}

export const applySplitStep = async ({
  step,
  paneMap,
  windowId,
  runCommand,
  listWindows,
  logPaneMapping,
  detectedVersion,
}: {
  readonly step: CommandStep
  readonly paneMap: PaneMap
  readonly windowId: string
  readonly runCommand: ExecuteWeztermCommand
  readonly listWindows: ListWeztermWindows
  readonly logPaneMapping: LogPaneMapping
  readonly detectedVersion?: string
}): Promise<void> => {
  const targetVirtualId = step.targetPaneId
  if (typeof targetVirtualId !== "string" || targetVirtualId.length === 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PANE,
      message: "Split step missing target pane metadata",
      path: step.id,
    })
  }

  const targetRealId = resolveRealPaneId(paneMap, targetVirtualId, { stepId: step.id })

  const beforeList = await listWindows()
  const beforePaneIds = collectPaneIdsForWindow(beforeList, windowId)
  const orientation = resolveSplitOrientation(step)
  const targetPane = findPaneById(beforeList, targetRealId)
  const paneCells = resolvePaneCellsForOrientation(targetPane?.size, orientation)
  const splitSize = resolveSplitSize(step, {
    paneCells,
    paneId: targetRealId,
    requiredVersion: WEZTERM_MINIMUM_VERSION,
    detectedVersion,
    rawPaneRecord: targetPane?.rawPaneRecord,
  })

  const args = buildSplitArguments({
    targetPaneId: targetRealId,
    splitSize,
    horizontal: orientation === "horizontal",
  })

  await runCommand(args, {
    message: `Failed to execute split step ${step.id}`,
    path: step.id,
  })

  const afterList = await listWindows()
  const afterPaneIds = collectPaneIdsForWindow(afterList, windowId)

  const newPaneId = findNewPaneId(beforePaneIds, afterPaneIds)
  if (typeof newPaneId !== "string" || newPaneId.length === 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "Unable to determine newly created wezterm pane",
      path: step.id,
    })
  }

  if (typeof step.createdPaneId === "string" && step.createdPaneId.length > 0) {
    registerPaneWithAncestors(paneMap, step.createdPaneId, newPaneId)
    logPaneMapping(step.createdPaneId, newPaneId)
  }
}

const findPaneById = (
  list: WeztermListResult,
  paneId: string,
):
  | {
      readonly size?: { readonly cols?: number; readonly rows?: number }
      readonly rawPaneRecord?: Record<string, unknown>
    }
  | undefined => {
  for (const window of list.windows) {
    for (const tab of window.tabs) {
      for (const pane of tab.panes) {
        if (pane.paneId === paneId) {
          return {
            size: pane.size,
            rawPaneRecord: pane.rawPaneRecord,
          }
        }
      }
    }
  }
  return undefined
}

const resolvePaneCellsForOrientation = (
  size: { readonly cols?: number; readonly rows?: number } | undefined,
  orientation: "horizontal" | "vertical",
): number | undefined => {
  if (orientation === "horizontal") {
    return size?.cols
  }
  return size?.rows
}

export const applyTerminalCommands = async ({
  terminals,
  paneMap,
  runCommand,
  focusPaneVirtualId,
}: {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly paneMap: PaneMap
  readonly runCommand: ExecuteWeztermCommand
  readonly focusPaneVirtualId: string
}): Promise<void> => {
  if (!paneMap.has(focusPaneVirtualId)) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PANE,
      message: `Unknown focus pane: ${focusPaneVirtualId}`,
      path: focusPaneVirtualId,
    })
  }

  const prepared = prepareTerminalCommands({
    terminals,
    focusPaneVirtualId,
    resolveRealPaneId: (virtualPaneId: string): string =>
      resolveRealPaneId(paneMap, virtualPaneId, {
        stepId: virtualPaneId,
      }),
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

  for (const commandSet of prepared.commands) {
    const { terminal, realPaneId } = commandSet

    if (typeof commandSet.cwdCommand === "string") {
      await sendTextToPane({
        paneId: realPaneId,
        text: commandSet.cwdCommand,
        runCommand,
        context: {
          message: `Failed to change directory for pane ${terminal.virtualPaneId}`,
          path: terminal.virtualPaneId,
          details: { cwd: terminal.cwd },
        },
      })
    }

    for (const envEntry of commandSet.envCommands) {
      await sendTextToPane({
        paneId: realPaneId,
        text: envEntry.command,
        runCommand,
        context: {
          message: `Failed to set environment variable ${envEntry.key}`,
          path: terminal.virtualPaneId,
        },
      })
    }

    if (commandSet.command !== undefined) {
      if (commandSet.command.delayMs > 0) {
        await waitForDelay(commandSet.command.delayMs)
      }

      await sendTextToPane({
        paneId: realPaneId,
        text: commandSet.command.text,
        runCommand,
        context: {
          message: `Failed to execute command for pane ${terminal.virtualPaneId}`,
          path: terminal.virtualPaneId,
          details: { command: terminal.command },
        },
      })
    }
  }
}
