import type { PlanEmission } from "../../core/emitter"
import { createCoreError } from "../../core/errors"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  WeztermTerminalBackendContext,
} from "../../executor/terminal-backend"
import { ErrorCodes } from "../../utils/errors"
import { listWeztermWindows, runWeztermCli, verifyWeztermAvailability, type WeztermListResult } from "./cli"
import { buildDryRunSteps } from "./dry-run"
import { findWorkspaceForPane, resolveInitialPane } from "./layout-resolution"
import { parseWeztermListResult } from "./list-parser"
import { registerPaneWithAncestors } from "./pane-map"
import { applyFocusStep, applySplitStep, applyTerminalCommands } from "./step-execution"
import type { ExecuteWeztermCommand, PaneMap } from "./shared"
import { execFileSync } from "node:child_process"

const ensureVirtualPaneId = (emission: PlanEmission): string => {
  const { initialPaneId } = emission.summary
  if (typeof initialPaneId !== "string" || initialPaneId.length === 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Plan emission is missing initial pane metadata",
      path: "plan.initialPaneId",
    })
  }
  return initialPaneId
}

export const createWeztermBackend = (context: WeztermTerminalBackendContext): TerminalBackend => {
  let detectedVersion: string | undefined

  const formatCommand = (args: ReadonlyArray<string>): string => {
    return `wezterm cli ${args.join(" ")}`
  }

  const logCommand = (args: ReadonlyArray<string>): void => {
    const message = `[wezterm] ${formatCommand(args)}`
    if (context.verbose) {
      context.logger.info(message)
    } else {
      context.logger.debug(message)
    }
  }

  const logPaneMapping = (virtualId: string, realId: string): void => {
    const message = `[wezterm] pane ${virtualId} -> ${realId}`
    if (context.verbose) {
      context.logger.info(message)
    } else {
      context.logger.debug(message)
    }
  }

  const runCommand: ExecuteWeztermCommand = async (args, errorContext) => {
    const commandArgs = [...args]
    logCommand(commandArgs)
    return runWeztermCli(commandArgs, errorContext)
  }

  const listWindows = async (): Promise<WeztermListResult> => {
    logCommand(["list", "--format", "json"])
    return listWeztermWindows()
  }

  const verifyEnvironment = async (): Promise<void> => {
    if (context.dryRun) {
      return
    }
    const verification = await verifyWeztermAvailability()
    detectedVersion = verification.version
  }

  const applyPlan = async ({ emission, windowMode }: ApplyPlanParameters): Promise<ApplyPlanResult> => {
    const initialVirtualPaneId = ensureVirtualPaneId(emission)
    const paneMap: PaneMap = new Map()
    const initialTerminal = emission.terminals.find((terminal) => terminal.virtualPaneId === initialVirtualPaneId)
    const initialCwd =
      typeof initialTerminal?.cwd === "string" && initialTerminal.cwd.length > 0 ? initialTerminal.cwd : context.cwd

    let cachedInitialList: WeztermListResult | undefined
    let workspaceHint: string | undefined
    if (typeof context.paneId === "string" && context.paneId.length > 0) {
      try {
        cachedInitialList = await listWindows()
        workspaceHint = findWorkspaceForPane(cachedInitialList, context.paneId)
      } catch {
        cachedInitialList = undefined
        workspaceHint = undefined
      }
    }

    const { paneId: initialPaneId, windowId } = await resolveInitialPane({
      windowMode,
      prompt: context.prompt,
      dryRun: context.dryRun,
      listWindows,
      runCommand,
      logCommand,
      initialCwd,
      workspaceHint,
      initialList: cachedInitialList,
      preferredPaneId: context.paneId,
    })
    registerPaneWithAncestors(paneMap, initialVirtualPaneId, initialPaneId)
    logPaneMapping(initialVirtualPaneId, initialPaneId)

    let executedSteps = 0

    for (const step of emission.steps) {
      if (step.kind === "split") {
        await applySplitStep({
          step,
          paneMap,
          windowId,
          runCommand,
          listWindows,
          logPaneMapping,
          detectedVersion,
        })
        executedSteps += 1
      } else if (step.kind === "focus") {
        await applyFocusStep({
          step,
          paneMap,
          runCommand,
        })
        executedSteps += 1
      } else {
        throw createCoreError("execution", {
          code: ErrorCodes.INVALID_PLAN,
          message: `Unsupported step kind in emission: ${String((step as { kind?: unknown }).kind)}`,
          path: step.id,
        })
      }
    }

    await applyTerminalCommands({
      terminals: emission.terminals,
      paneMap,
      runCommand,
      focusPaneVirtualId: emission.summary.focusPaneId,
    })

    const focusVirtual = emission.summary.focusPaneId
    const focusPaneId = typeof focusVirtual === "string" ? paneMap.get(focusVirtual) : undefined

    return {
      executedSteps,
      focusPaneId,
    }
  }

  return {
    verifyEnvironment,
    applyPlan,
    getDryRunSteps: (emission: PlanEmission): DryRunStep[] => {
      const actualPaneId =
        typeof context.paneId === "string" && context.paneId.length > 0 ? context.paneId : process.env.WEZTERM_PANE
      const initialPaneSize = resolveInitialWeztermPaneSize(actualPaneId)
      return buildDryRunSteps(emission, {
        initialPaneId: emission.summary.initialPaneId,
        initialPaneSize,
        detectedVersion,
      })
    },
  }
}

const resolveInitialWeztermPaneSize = (
  paneId: string | undefined,
): { readonly cols: number; readonly rows: number } | undefined => {
  if (typeof paneId !== "string" || paneId.length === 0) {
    return undefined
  }

  try {
    const stdout = execFileSync("wezterm", ["cli", "list", "--format", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const parsed = parseWeztermListResult(stdout)
    if (parsed === undefined) {
      return undefined
    }
    for (const window of parsed.windows) {
      for (const tab of window.tabs) {
        for (const pane of tab.panes) {
          if (pane.paneId === paneId) {
            if (typeof pane.size?.cols === "number" && typeof pane.size?.rows === "number") {
              return { cols: pane.size.cols, rows: pane.size.rows }
            }
            return undefined
          }
        }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}
