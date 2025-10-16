import type { CommandExecutor } from "../types/command-executor.ts"
import type { PlanEmission, CommandStep, EmittedTerminal } from "../core/emitter.ts"
import type { WindowMode } from "../models/types.ts"
import { ErrorCodes } from "../utils/errors.ts"
import { createFunctionalError } from "../core/errors.ts"
import type { ConfirmPaneClosure } from "../types/confirm-pane.ts"

const DOUBLE_QUOTE = '"'
const ESCAPED_DOUBLE_QUOTE = '\\"'

type ExecutePlanInput = {
  readonly emission: PlanEmission
  readonly executor: CommandExecutor
  readonly windowName?: string
  readonly windowMode: WindowMode
  readonly onConfirmKill?: ConfirmPaneClosure
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
}: ExecutePlanInput): Promise<ExecutePlanSuccess> => {
  const initialVirtualPaneId = emission.summary.initialPaneId
  if (typeof initialVirtualPaneId !== "string" || initialVirtualPaneId.length === 0) {
    raiseExecutionError("INVALID_PLAN", {
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
        throw createFunctionalError("execution", {
          code: ErrorCodes.USER_CANCELLED,
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

    initialPaneId = normalizePaneId(
      await executeCommand(executor, newWindowCommand, {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: "Failed to create tmux window",
        path: initialVirtualPaneId,
      }),
    )
  }

  registerPane(paneMap, initialVirtualPaneId, initialPaneId)

  let executedSteps = 0

  for (const step of emission.steps) {
    if (step.kind === "split") {
      await executeSplitStep({ step, executor, paneMap })
    } else if (step.kind === "focus") {
      await executeFocusStep({ step, executor, paneMap })
    }
    executedSteps += 1
  }

  await executeTerminalCommands({ terminals: emission.terminals, executor, paneMap })

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

const executeSplitStep = async ({
  step,
  executor,
  paneMap,
}: {
  readonly step: CommandStep
  readonly executor: CommandExecutor
  readonly paneMap: Map<string, string>
}): Promise<void> => {
  const targetVirtualId = ensureNonEmpty(step.targetPaneId, () =>
    raiseExecutionError("MISSING_TARGET", {
      message: "Split step missing target pane metadata",
      path: step.id,
    }),
  )

  const targetRealId = ensureNonEmpty(resolvePaneId(paneMap, targetVirtualId), () =>
    raiseExecutionError("UNKNOWN_PANE", {
      message: `Unknown target pane: ${targetVirtualId}`,
      path: step.id,
    }),
  )

  const panesBefore = await listPaneIds(executor, step)
  const splitCommand = replaceTarget(step.command, targetRealId)
  await executeCommand(executor, splitCommand, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: `Failed to execute split step ${step.id}`,
    path: step.id,
    details: { command: splitCommand },
  })

  const panesAfter = await listPaneIds(executor, step)
  const newPaneId = ensureNonEmpty(findNewPaneId(panesBefore, panesAfter), () =>
    raiseExecutionError("UNKNOWN_PANE", {
      message: "Unable to determine newly created pane",
      path: step.id,
    }),
  )

  const createdVirtualId = step.createdPaneId
  if (typeof createdVirtualId === "string" && createdVirtualId.length > 0) {
    registerPane(paneMap, createdVirtualId, newPaneId)
  }
}

const executeFocusStep = async ({
  step,
  executor,
  paneMap,
}: {
  readonly step: CommandStep
  readonly executor: CommandExecutor
  readonly paneMap: Map<string, string>
}): Promise<void> => {
  const targetVirtualId = ensureNonEmpty(step.targetPaneId, () =>
    raiseExecutionError("MISSING_TARGET", {
      message: "Focus step missing target pane metadata",
      path: step.id,
    }),
  )

  const targetRealId = ensureNonEmpty(resolvePaneId(paneMap, targetVirtualId), () =>
    raiseExecutionError("UNKNOWN_PANE", {
      message: `Unknown focus pane: ${targetVirtualId}`,
      path: step.id,
    }),
  )

  const command = replaceTarget(step.command, targetRealId)
  await executeCommand(executor, command, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: `Failed to execute focus step ${step.id}`,
    path: step.id,
    details: { command },
  })
}

const executeTerminalCommands = async ({
  terminals,
  executor,
  paneMap,
}: {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly executor: CommandExecutor
  readonly paneMap: Map<string, string>
}): Promise<void> => {
  for (const terminal of terminals) {
    const realPaneId = ensureNonEmpty(resolvePaneId(paneMap, terminal.virtualPaneId), () =>
      raiseExecutionError("UNKNOWN_PANE", {
        message: `Unknown terminal pane: ${terminal.virtualPaneId}`,
        path: terminal.virtualPaneId,
      }),
    )

    if (typeof terminal.cwd === "string" && terminal.cwd.length > 0) {
      const escapedCwd = terminal.cwd.split(DOUBLE_QUOTE).join(ESCAPED_DOUBLE_QUOTE)
      await executeCommand(executor, ["send-keys", "-t", realPaneId, `cd "${escapedCwd}"`, "Enter"], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: `Failed to change directory for pane ${terminal.virtualPaneId}`,
        path: terminal.virtualPaneId,
        details: { cwd: terminal.cwd },
      })
    }

    if (terminal.env !== undefined) {
      for (const [key, value] of Object.entries(terminal.env)) {
        const escaped = String(value).split(DOUBLE_QUOTE).join(ESCAPED_DOUBLE_QUOTE)
        await executeCommand(executor, ["send-keys", "-t", realPaneId, `export ${key}="${escaped}"`, "Enter"], {
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: `Failed to set environment variable ${key}`,
          path: terminal.virtualPaneId,
        })
      }
    }

    if (typeof terminal.command === "string" && terminal.command.length > 0) {
      await executeCommand(executor, ["send-keys", "-t", realPaneId, terminal.command, "Enter"], {
        code: ErrorCodes.TMUX_COMMAND_FAILED,
        message: `Failed to execute command for pane ${terminal.virtualPaneId}`,
        path: terminal.virtualPaneId,
        details: { command: terminal.command },
      })
    }
  }
}

const executeCommand = async (
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
      throw createFunctionalError("execution", {
        code: typeof candidate.code === "string" ? candidate.code : context.code,
        message: candidate.message ?? context.message,
        path: context.path,
        details: candidate.details ?? context.details,
      })
    }

    throw createFunctionalError("execution", {
      code: context.code,
      message: context.message,
      path: context.path,
      details: context.details,
    })
  }
}

const resolveCurrentPaneId = async ({
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
    throw createFunctionalError("execution", {
      code: ErrorCodes.NOT_IN_TMUX_SESSION,
      message: "Unable to determine current tmux pane",
      path: contextPath,
    })
  }

  return normalizePaneId(paneId)
}

const listWindowPaneIds = async (executor: CommandExecutor, contextPath: string): Promise<string[]> => {
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

const replaceTarget = (command: ReadonlyArray<string>, realTarget: string): string[] => {
  const next = [...command]
  const targetIndex = next.findIndex((value, index) => value === "-t" && index + 1 < next.length)
  if (targetIndex >= 0) {
    next[targetIndex + 1] = realTarget
    return next
  }

  if (next.length > 0) {
    next[next.length - 1] = realTarget
  }
  return next
}

const normalizePaneId = (raw: string): string => {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? "%0" : trimmed
}

const registerPane = (paneMap: Map<string, string>, virtualId: string, realId: string): void => {
  paneMap.set(virtualId, realId)
}

const resolvePaneId = (paneMap: Map<string, string>, virtualId: string): string | undefined => {
  const direct = paneMap.get(virtualId)
  if (typeof direct === "string" && direct.length > 0) {
    return direct
  }

  let ancestor = virtualId
  while (ancestor.includes(".")) {
    ancestor = ancestor.slice(0, ancestor.lastIndexOf("."))
    const candidate = paneMap.get(ancestor)
    if (typeof candidate === "string" && candidate.length > 0) {
      paneMap.set(virtualId, candidate)
      return candidate
    }
  }

  for (const [key, value] of paneMap.entries()) {
    if (key.startsWith(`${virtualId}.`)) {
      if (typeof value === "string" && value.length > 0) {
        paneMap.set(virtualId, value)
        return value
      }
    }
  }

  return undefined
}

const ensureNonEmpty = <T extends string>(value: T | undefined, buildError: () => never): T => {
  if (value === undefined || value.length === 0) {
    return buildError()
  }
  return value
}

const raiseExecutionError = (
  code: string,
  error: {
    readonly message: string
    readonly path: string
    readonly details?: Record<string, unknown>
  },
): never => {
  throw createFunctionalError("execution", {
    code,
    message: error.message,
    path: error.path,
    details: error.details,
  })
}
