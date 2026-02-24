import type { CommandStep, EmittedTerminal } from "../core/emitter"
import { createCoreError } from "../core/errors"
import type { CommandExecutor } from "../contracts"
import { waitForDelay } from "../utils/async"
import { ErrorCodes } from "../utils/errors"
import { resolvePaneMapping } from "../utils/pane-map"
import { resolveSplitOrientation, resolveSplitSize } from "./split-step"
import { prepareTerminalCommands } from "./terminal-command-preparation"

export const executeSplitStep = async ({
  step,
  executor,
  paneMap,
  detectedVersion,
}: {
  readonly step: CommandStep
  readonly executor: CommandExecutor
  readonly paneMap: Map<string, string>
  readonly detectedVersion?: string
}): Promise<void> => {
  const targetVirtualId = ensureNonEmpty(step.targetPaneId, () =>
    raiseExecutionError(ErrorCodes.MISSING_TARGET, {
      message: "Split step missing target pane metadata",
      path: step.id,
    }),
  )

  const targetRealId = ensureNonEmpty(resolvePaneId(paneMap, targetVirtualId), () =>
    raiseExecutionError(ErrorCodes.INVALID_PANE, {
      message: `Unknown target pane: ${targetVirtualId}`,
      path: step.id,
    }),
  )

  const panesBefore = await listPaneIds(executor, step)
  const splitCommand = await buildSplitCommand({
    step,
    targetRealId,
    executor,
    detectedVersion,
  })
  await executeCommand(executor, splitCommand, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: `Failed to execute split step ${step.id}`,
    path: step.id,
    details: { command: splitCommand },
  })

  const panesAfter = await listPaneIds(executor, step)
  const newPaneId = ensureNonEmpty(findNewPaneId(panesBefore, panesAfter), () =>
    raiseExecutionError(ErrorCodes.INVALID_PANE, {
      message: "Unable to determine newly created pane",
      path: step.id,
    }),
  )

  const createdVirtualId = step.createdPaneId
  if (typeof createdVirtualId === "string" && createdVirtualId.length > 0) {
    registerPane(paneMap, createdVirtualId, newPaneId)
  }
}

export const executeFocusStep = async ({
  step,
  executor,
  paneMap,
}: {
  readonly step: CommandStep
  readonly executor: CommandExecutor
  readonly paneMap: Map<string, string>
}): Promise<void> => {
  const targetVirtualId = ensureNonEmpty(step.targetPaneId, () =>
    raiseExecutionError(ErrorCodes.MISSING_TARGET, {
      message: "Focus step missing target pane metadata",
      path: step.id,
    }),
  )

  const targetRealId = ensureNonEmpty(resolvePaneId(paneMap, targetVirtualId), () =>
    raiseExecutionError(ErrorCodes.INVALID_PANE, {
      message: `Unknown focus pane: ${targetVirtualId}`,
      path: step.id,
    }),
  )

  const command = buildFocusCommand(targetRealId)
  await executeCommand(executor, command, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: `Failed to execute focus step ${step.id}`,
    path: step.id,
    details: { command },
  })
}

export const executeTerminalCommands = async ({
  terminals,
  executor,
  paneMap,
  focusPaneVirtualId,
}: {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly executor: CommandExecutor
  readonly paneMap: Map<string, string>
  readonly focusPaneVirtualId: string
}): Promise<void> => {
  if (!paneMap.has(focusPaneVirtualId)) {
    raiseExecutionError(ErrorCodes.INVALID_PANE, {
      message: `Unknown focus pane: ${focusPaneVirtualId}`,
      path: focusPaneVirtualId,
    })
  }
  ensureNonEmpty(resolvePaneId(paneMap, focusPaneVirtualId), () =>
    raiseExecutionError(ErrorCodes.INVALID_PANE, {
      message: `Unknown focus pane: ${focusPaneVirtualId}`,
      path: focusPaneVirtualId,
    }),
  )

  const resolveRealPaneId = (virtualPaneId: string): string => {
    return ensureNonEmpty(resolvePaneId(paneMap, virtualPaneId), () =>
      raiseExecutionError(ErrorCodes.INVALID_PANE, {
        message: `Unknown terminal pane: ${virtualPaneId}`,
        path: virtualPaneId,
      }),
    )
  }

  const prepared = prepareTerminalCommands({
    terminals,
    focusPaneVirtualId,
    resolveRealPaneId,
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
      await executeCommand(executor, ["send-keys", "-t", realPaneId, commandSet.cwdCommand, "Enter"], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: `Failed to change directory for pane ${terminal.virtualPaneId}`,
        path: terminal.virtualPaneId,
        details: { cwd: terminal.cwd },
      })
    }

    for (const envEntry of commandSet.envCommands) {
      await executeCommand(executor, ["send-keys", "-t", realPaneId, envEntry.command, "Enter"], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: `Failed to set environment variable ${envEntry.key}`,
        path: terminal.virtualPaneId,
      })
    }

    if (typeof commandSet.title === "string") {
      await executeCommand(executor, ["select-pane", "-t", realPaneId, "-T", commandSet.title], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: `Failed to set pane title for pane ${terminal.virtualPaneId}`,
        path: terminal.virtualPaneId,
        details: { title: commandSet.title },
      })
    }

    if (commandSet.command !== undefined) {
      if (commandSet.command.delayMs > 0) {
        await waitForDelay(commandSet.command.delayMs)
      }

      await executeCommand(executor, ["send-keys", "-t", realPaneId, commandSet.command.text, "Enter"], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: `Failed to execute command for pane ${terminal.virtualPaneId}`,
        path: terminal.virtualPaneId,
        details: { command: terminal.command },
      })
    }
  }
}

export const executeCommand = async (
  executor: CommandExecutor,
  command: string[],
  context: {
    readonly code: string
    readonly message: string
    readonly path: string
    readonly details?: Record<string, unknown>
  },
): Promise<string> => {
  try {
    return await executor.execute([...command])
  } catch (error) {
    if (error instanceof Error && "code" in error && "message" in error) {
      const candidate = error as { code?: string; message?: string; details?: Record<string, unknown> }
      throw createCoreError("execution", {
        code: typeof candidate.code === "string" ? candidate.code : context.code,
        message: candidate.message ?? context.message,
        path: context.path,
        details: candidate.details ?? context.details,
      })
    }

    throw createCoreError("execution", {
      code: context.code,
      message: context.message,
      path: context.path,
      details: context.details,
    })
  }
}

export const resolveCurrentPaneId = async ({
  executor,
  contextPath,
  isDryRun,
}: {
  executor: CommandExecutor
  contextPath: string
  isDryRun: boolean
}): Promise<string> => {
  const envPaneId = process.env.TMUX_PANE
  if (typeof envPaneId === "string" && envPaneId.trim().length > 0) {
    return normalizePaneId(envPaneId)
  }

  if (isDryRun) {
    return "%0"
  }

  const output = await executeCommand(executor, ["display-message", "-p", "#{pane_id}"], {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: "Failed to resolve current tmux pane",
    path: contextPath,
  })

  const paneId = output.trim()
  if (paneId.length === 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.NOT_IN_TMUX_SESSION,
      message: "Unable to determine current tmux pane",
      path: contextPath,
    })
  }

  return normalizePaneId(paneId)
}

export const listWindowPaneIds = async (executor: CommandExecutor, contextPath: string): Promise<string[]> => {
  const output = await executeCommand(executor, ["list-panes", "-F", "#{pane_id}"], {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: "Failed to list tmux panes",
    path: contextPath,
  })

  return output
    .split("\n")
    .map((pane) => pane.trim())
    .filter((pane) => pane.length > 0)
}

const listPaneIds = async (executor: CommandExecutor, step: CommandStep): Promise<string[]> => {
  return listWindowPaneIds(executor, step.id)
}

const findNewPaneId = (before: string[], after: string[]): string | undefined => {
  const beforeSet = new Set(before)
  return after.find((id) => !beforeSet.has(id))
}

const buildSplitCommand = async ({
  step,
  targetRealId,
  executor,
  detectedVersion,
}: {
  readonly step: CommandStep
  readonly targetRealId: string
  readonly executor: CommandExecutor
  readonly detectedVersion?: string
}): Promise<string[]> => {
  const orientation = resolveSplitOrientation(step)
  const directionFlag = orientation === "horizontal" ? "-h" : "-v"
  if (isDynamicSplit(step)) {
    const paneCells = await resolveTmuxPaneCells({
      executor,
      step,
      targetRealId,
      orientation,
      detectedVersion,
    })
    const splitSize = resolveSplitSize(step, {
      paneCells,
      paneId: targetRealId,
      detectedVersion,
      rawPaneRecord: {
        backend: "tmux",
        paneId: targetRealId,
        sourceFormat: "tmux-format",
      },
    })
    if (splitSize.mode === "cells") {
      return ["split-window", directionFlag, "-t", targetRealId, "-l", splitSize.cells]
    }
    return raiseExecutionError(ErrorCodes.INVALID_PLAN, {
      message: "Dynamic split resolved to a non-cell sizing mode",
      path: step.id,
      details: { splitSize },
    })
  }

  const splitSize = resolveSplitSize(step, {
    paneId: targetRealId,
    detectedVersion,
  })
  if (splitSize.mode === "percent") {
    return ["split-window", directionFlag, "-t", targetRealId, "-p", splitSize.percentage]
  }
  return raiseExecutionError(ErrorCodes.INVALID_PLAN, {
    message: "Percent split resolved to a non-percent sizing mode",
    path: step.id,
    details: { splitSize },
  })
}

const buildFocusCommand = (targetRealId: string): string[] => {
  return ["select-pane", "-t", targetRealId]
}

export const normalizePaneId = (raw: string): string => {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? "%0" : trimmed
}

export const registerPane = (paneMap: Map<string, string>, virtualId: string, realId: string): void => {
  paneMap.set(virtualId, realId)
}

export const resolvePaneId = (paneMap: Map<string, string>, virtualId: string): string | undefined => {
  return resolvePaneMapping(paneMap, virtualId)
}

const resolveTmuxPaneCells = async ({
  executor,
  step,
  targetRealId,
  orientation,
  detectedVersion,
}: {
  readonly executor: CommandExecutor
  readonly step: CommandStep
  readonly targetRealId: string
  readonly orientation: "horizontal" | "vertical"
  readonly detectedVersion?: string
}): Promise<number> => {
  const format = orientation === "horizontal" ? "#{pane_width}" : "#{pane_height}"
  const output = await executeCommand(executor, ["display-message", "-p", "-t", targetRealId, format], {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: "Failed to resolve tmux pane size",
    path: step.id,
    details: { command: ["display-message", "-p", "-t", targetRealId, format] },
  })
  const value = Number.parseInt(output.trim(), 10)
  if (!Number.isInteger(value) || value <= 0) {
    raiseExecutionError(ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED, {
      message: "Unable to parse tmux pane size",
      path: step.id,
      details: {
        paneId: targetRealId,
        orientation,
        output,
        detectedVersion,
      },
    })
  }
  return value
}

const isDynamicSplit = (step: CommandStep): boolean => {
  return step.kind === "split" && step.splitSizing?.mode === "dynamic-cells"
}

const ensureNonEmpty = <T extends string>(value: T | undefined, buildError: () => never): T => {
  if (value === undefined || value.length === 0) {
    return buildError()
  }
  return value
}

export const raiseExecutionError = (
  code: string,
  error: {
    readonly message: string
    readonly path: string
    readonly details?: Record<string, unknown>
  },
): never => {
  throw createCoreError("execution", {
    code,
    message: error.message,
    path: error.path,
    details: error.details,
  })
}
