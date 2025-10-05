import type { ICommandExecutor } from "../interfaces/command-executor"
import type { PlanEmission, CommandStep, StructuredError } from "../core/index.ts"
import { ErrorCodes } from "../utils/errors"

export interface ExecutePlanInput {
  readonly emission: PlanEmission
  readonly executor: ICommandExecutor
  readonly windowName?: string
}

export interface ExecutePlanSuccess {
  readonly executedSteps: number
}

export type ExecutePlanResult = { ok: true; value: ExecutePlanSuccess } | { ok: false; error: StructuredError }

export async function executePlan({ emission, executor, windowName }: ExecutePlanInput): Promise<ExecutePlanResult> {
  const initialVirtualPaneId = emission.summary.initialPaneId
  if (typeof initialVirtualPaneId !== "string" || initialVirtualPaneId.length === 0) {
    return errorResult({
      code: ErrorCodes.TMUX_COMMAND_FAILED,
      message: "Plan emission is missing initial pane metadata",
      path: "plan",
    })
  }

  const paneMap = new Map<string, string>()

  const newWindowCommand: string[] = ["new-window", "-P", "-F", "#{pane_id}"]
  if (typeof windowName === "string" && windowName.trim().length > 0) {
    newWindowCommand.push("-n", windowName.trim())
  }

  const initialPaneIdResult = await safeExecute(executor, newWindowCommand, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: "Failed to create tmux window",
    path: initialVirtualPaneId,
  })

  if (!initialPaneIdResult.ok) {
    return initialPaneIdResult
  }

  const initialPaneId = normalizePaneId(initialPaneIdResult.value)
  registerPane(paneMap, initialVirtualPaneId, initialPaneId)

  let executedSteps = 0

  for (const step of emission.steps) {
    if (step.kind === "split") {
      const targetVirtualId = step.targetPaneId
      if (typeof targetVirtualId !== "string" || targetVirtualId.length === 0) {
        return errorResult({
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: "Split step missing target pane metadata",
          path: step.id,
        })
      }

      const targetRealId = resolvePaneId(paneMap, targetVirtualId)
      if (typeof targetRealId !== "string" || targetRealId.length === 0) {
        return errorResult({
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: `Unknown target pane: ${targetVirtualId}`,
          path: step.id,
        })
      }

      const panesBeforeResult = await listPaneIds(executor, step)
      if (!panesBeforeResult.ok) {
        return panesBeforeResult
      }

      const splitCommand = replaceTarget(step.command, targetRealId)
      const executionResult = await safeExecute(executor, splitCommand, step)
      if (!executionResult.ok) {
        return executionResult
      }

      const panesAfterResult = await listPaneIds(executor, step)
      if (!panesAfterResult.ok) {
        return panesAfterResult
      }

      const newPaneId = findNewPaneId(panesBeforeResult.value, panesAfterResult.value)
      if (newPaneId === undefined) {
        return errorResult({
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: "Unable to determine newly created pane",
          path: step.id,
        })
      }

      if (typeof step.createdPaneId === "string" && step.createdPaneId.length > 0) {
        registerPane(paneMap, step.createdPaneId, newPaneId)
      }
    } else {
      const targetVirtualId = step.targetPaneId
      if (typeof targetVirtualId !== "string" || targetVirtualId.length === 0) {
        return errorResult({
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: "Focus step missing target pane metadata",
          path: step.id,
        })
      }

      const targetRealId = resolvePaneId(paneMap, targetVirtualId)
      if (typeof targetRealId !== "string" || targetRealId.length === 0) {
        return errorResult({
          code: ErrorCodes.TMUX_COMMAND_FAILED,
          message: `Unknown focus pane: ${targetVirtualId}`,
          path: step.id,
        })
      }

      const focusCommand = replaceTarget(step.command, targetRealId)
      const executionResult = await safeExecute(executor, focusCommand, step)
      if (!executionResult.ok) {
        return executionResult
      }
    }

    executedSteps += 1
  }

  return {
    ok: true,
    value: {
      executedSteps,
    },
  }
}

const toStructuredError = (error: unknown, step: CommandStep): StructuredError => {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown
      message?: unknown
      details?: unknown
    }
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      const details = candidate.details
      const recordDetails =
        typeof details === "object" && details !== null ? (details as Record<string, unknown>) : undefined
      return {
        code: candidate.code,
        message: candidate.message,
        path: step.id,
        details: {
          command: step.command,
          ...(recordDetails ?? {}),
        },
      }
    }
  }

  return {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: error instanceof Error ? error.message : "Unknown tmux execution error",
    path: step.id,
    details: {
      command: step.command,
    },
  }
}

interface ErrorContext {
  readonly code: string
  readonly message: string
  readonly path: string
}

const safeExecute = async (
  executor: ICommandExecutor,
  command: string[],
  context: CommandStep | ErrorContext,
): Promise<{ ok: true; value: string } | { ok: false; error: StructuredError }> => {
  try {
    const result = await executor.execute([...command])
    return { ok: true, value: result }
  } catch (error) {
    if (!("kind" in context)) {
      return {
        ok: false,
        error: {
          code: context.code,
          message: context.message,
          path: context.path,
        },
      }
    }
    return {
      ok: false,
      error: toStructuredError(error, context as CommandStep),
    }
  }
}

const listPaneIds = async (
  executor: ICommandExecutor,
  step: CommandStep,
): Promise<{ ok: true; value: string[] } | { ok: false; error: StructuredError }> => {
  const result = await safeExecute(executor, ["list-panes", "-F", "#{pane_id}"], step)
  if (!result.ok) {
    return result
  }

  const ids = result.value
    .split("\n")
    .map((pane) => pane.trim())
    .filter((pane) => pane.length > 0)

  return { ok: true, value: ids }
}

const findNewPaneId = (before: string[], after: string[]): string | undefined => {
  const beforeSet = new Set(before)
  for (const id of after) {
    if (!beforeSet.has(id)) {
      return id
    }
  }
  return undefined
}

const replaceTarget = (command: ReadonlyArray<string>, realTarget: string): string[] => {
  const next = [...command]
  const targetIndex = next.findIndex((value, index) => value === "-t" && index + 1 < next.length)
  if (targetIndex >= 0) {
    next[targetIndex + 1] = realTarget
    return next
  }

  // fallback: replace last argument if there is no -t flag
  if (next.length > 0) {
    next[next.length - 1] = realTarget
  }
  return next
}

const normalizePaneId = (raw: string): string => {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return "%0"
  }
  return trimmed
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

  let bestKey: string | undefined
  let bestValue: string | undefined
  for (const [key, value] of paneMap.entries()) {
    if (key.startsWith(`${virtualId}.`)) {
      if (bestKey === undefined || key.length < bestKey.length) {
        bestKey = key
        bestValue = value
      }
    }
  }

  if (typeof bestValue === "string" && bestValue.length > 0) {
    paneMap.set(virtualId, bestValue)
    return bestValue
  }

  return undefined
}

const errorResult = ({ code, message, path }: ErrorContext): ExecutePlanResult => ({
  ok: false,
  error: {
    code,
    message,
    path,
  },
})
