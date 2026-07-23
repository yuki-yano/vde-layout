import type { CommandStep, EmittedTerminal, PlanEmission } from "../../core/emitter"
import { createCoreError, type CoreError } from "../../core/errors"
import { resolveSplitOrientation, resolveSplitSize } from "../../executor/split-step"
import { prepareTerminalCommands } from "../../executor/terminal-command-preparation"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  HerdrTerminalBackendContext,
  TerminalBackend,
} from "../../executor/terminal-backend"
import { waitForDelay } from "../../utils/async"
import { ErrorCodes } from "../../utils/errors"
import { resolvePaneMapping } from "../../utils/pane-map"
import { buildNameToRealIdMap } from "../../utils/template-tokens"
import {
  closeHerdrPane,
  createHerdrTab,
  currentHerdrPane,
  getHerdrPaneLayout,
  HERDR_MINIMUM_VERSION,
  listHerdrPanes,
  renameHerdrPane,
  runInHerdrPane,
  splitHerdrPane,
  verifyHerdrAvailability,
} from "./cli"

type PaneMap = Map<string, string>
const MIN_HERDR_RATIO = 0.1
const MAX_HERDR_RATIO = 0.9

export const createHerdrBackend = (context: HerdrTerminalBackendContext): TerminalBackend => {
  const verifyEnvironment = async (): Promise<void> => {
    if (!context.dryRun) {
      await verifyHerdrAvailability()
    }
  }

  const applyPlan = async ({ emission, windowMode, windowName }: ApplyPlanParameters): Promise<ApplyPlanResult> => {
    const initialVirtualPaneId = requireInitialPaneId(emission)
    const initialTerminal = emission.terminals.find((terminal) => terminal.virtualPaneId === initialVirtualPaneId)
    const initialCwd = initialTerminal?.cwd ?? context.cwd
    const initial = await resolveInitialPane({
      context,
      windowMode,
      initialCwd,
      windowName,
    })

    const paneMap: PaneMap = new Map()
    registerPaneWithAncestors(paneMap, initialVirtualPaneId, initial.paneId)
    logPaneMapping(context, initialVirtualPaneId, initial.paneId)

    let executedSteps = 0
    for (const step of emission.steps) {
      if (step.kind === "split") {
        await applySplitStep({ step, emission, paneMap, context })
        executedSteps += 1
        continue
      }
      if (step.kind === "focus") {
        requireRealPaneId(paneMap, step.targetPaneId, step.id)
        executedSteps += 1
        continue
      }
      throw unsupportedStep(step)
    }

    await applyTerminalCommands({ terminals: emission.terminals, emission, paneMap })

    const focusPaneId = requireRealPaneId(paneMap, emission.summary.focusPaneId, emission.summary.focusPaneId)
    return {
      executedSteps,
      focusPaneId,
      paneNameToRealId: buildNameToRealIdMap(emission.terminals, paneMap),
      windowId: initial.tabId,
    }
  }

  return {
    verifyEnvironment,
    applyPlan,
    getDryRunSteps: buildDryRunSteps,
  }
}

const resolveInitialPane = async ({
  context,
  windowMode,
  initialCwd,
  windowName,
}: {
  readonly context: HerdrTerminalBackendContext
  readonly windowMode: ApplyPlanParameters["windowMode"]
  readonly initialCwd: string
  readonly windowName?: string
}): Promise<{ readonly paneId: string; readonly tabId: string }> => {
  if (windowMode === "new-window") {
    const created = await createHerdrTab({
      workspaceId: context.workspaceId,
      cwd: initialCwd,
      label: windowName,
    })
    return { paneId: created.pane.pane_id, tabId: created.tabId }
  }

  const current = await currentHerdrPane(context.paneId)
  const panes = await listHerdrPanes(current.workspace_id)
  const panesToClose = panes.filter((pane) => pane.tab_id === current.tab_id && pane.pane_id !== current.pane_id)

  if (panesToClose.length > 0) {
    const paneIds = panesToClose.map((pane) => pane.pane_id)
    const confirmed = context.prompt ? await context.prompt({ panesToClose: paneIds, dryRun: context.dryRun }) : true
    if (!confirmed) {
      throw createCoreError("execution", {
        code: ErrorCodes.USER_CANCELLED,
        message: "Aborted layout application for current herdr tab",
        path: current.pane_id,
        details: { panes: paneIds },
      })
    }
    for (const paneId of paneIds) {
      await closeHerdrPane(paneId)
    }
  }

  return { paneId: current.pane_id, tabId: current.tab_id }
}

const applySplitStep = async ({
  step,
  emission,
  paneMap,
  context,
}: {
  readonly step: CommandStep
  readonly emission: PlanEmission
  readonly paneMap: PaneMap
  readonly context: HerdrTerminalBackendContext
}): Promise<void> => {
  const targetPaneId = requireRealPaneId(paneMap, step.targetPaneId, step.id)
  const orientation = resolveSplitOrientation(step)
  const ratio = await resolveHerdrRatio(step, targetPaneId, orientation)
  assertSupportedRatio(step, ratio)
  const shouldFocus = createdPaneContainsFocus(step.createdPaneId, emission.summary.focusPaneId)
  const created = await splitHerdrPane({
    paneId: targetPaneId,
    direction: orientation === "horizontal" ? "right" : "down",
    ratio,
    focus: shouldFocus,
  })

  if (step.createdPaneId !== undefined && step.createdPaneId.length > 0) {
    registerPaneWithAncestors(paneMap, step.createdPaneId, created.pane_id)
    logPaneMapping(context, step.createdPaneId, created.pane_id)
  }
}

const resolveHerdrRatio = async (
  step: CommandStep,
  paneId: string,
  orientation: "horizontal" | "vertical",
): Promise<number> => {
  if (step.splitSizing?.mode !== "dynamic-cells") {
    const splitSize = resolveSplitSize(step)
    if (splitSize.mode !== "percent") {
      throw unsupportedStep(step)
    }
    return roundRatio(1 - Number(splitSize.percentage) / 100)
  }

  const layout = await getHerdrPaneLayout(paneId)
  const pane = layout.panes.find((candidate) => candidate.pane_id === paneId)
  const paneCells = orientation === "horizontal" ? pane?.rect.width : pane?.rect.height
  const splitSize = resolveSplitSize(step, {
    paneCells,
    paneId,
    requiredVersion: HERDR_MINIMUM_VERSION,
    rawPaneRecord: pane,
  })
  if (splitSize.mode !== "cells") {
    throw unsupportedStep(step)
  }
  return roundRatio(splitSize.targetCells / (splitSize.targetCells + splitSize.createdCells))
}

const applyTerminalCommands = async ({
  terminals,
  emission,
  paneMap,
}: {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly emission: PlanEmission
  readonly paneMap: PaneMap
}): Promise<void> => {
  const prepared = prepareTerminalCommands({
    terminals,
    focusPaneVirtualId: emission.summary.focusPaneId,
    resolveRealPaneId: (virtualPaneId) => requireRealPaneId(paneMap, virtualPaneId, virtualPaneId),
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
    const { realPaneId } = commandSet
    if (commandSet.title !== undefined) {
      await renameHerdrPane(realPaneId, commandSet.title)
    }
    if (commandSet.cwdCommand !== undefined) {
      await runInHerdrPane(realPaneId, commandSet.cwdCommand)
    }
    for (const envEntry of commandSet.envCommands) {
      await runInHerdrPane(realPaneId, envEntry.command)
    }
    if (commandSet.command !== undefined) {
      if (commandSet.command.delayMs > 0) {
        await waitForDelay(commandSet.command.delayMs)
      }
      await runInHerdrPane(realPaneId, commandSet.command.text)
    }
  }
}

const buildDryRunSteps = (emission: PlanEmission): DryRunStep[] => {
  const steps: DryRunStep[] = []
  for (const step of emission.steps) {
    const targetPaneId = requireStepTarget(step)
    if (step.kind === "split") {
      const orientation = resolveSplitOrientation(step)
      const ratio = resolveDryRunRatio(step)
      const focus = createdPaneContainsFocus(step.createdPaneId, emission.summary.focusPaneId)
        ? "--focus"
        : "--no-focus"
      steps.push({
        backend: "herdr",
        summary: step.splitSizing?.mode === "dynamic-cells" ? `${step.summary} [dynamic-cells]` : step.summary,
        command: `herdr pane split ${targetPaneId} --direction ${orientation === "horizontal" ? "right" : "down"} --ratio ${ratio} ${focus}`,
      })
      continue
    }
    if (step.kind === "focus") {
      steps.push({
        backend: "herdr",
        summary: step.summary,
        command: `# herdr focus for ${targetPaneId} is selected during pane creation`,
      })
      continue
    }
    throw unsupportedStep(step)
  }

  appendDryRunTerminalSteps(steps, emission)
  return steps
}

const appendDryRunTerminalSteps = (steps: DryRunStep[], emission: PlanEmission): void => {
  const prepared = prepareTerminalCommands({
    terminals: emission.terminals,
    focusPaneVirtualId: emission.summary.focusPaneId,
    resolveRealPaneId: (virtualPaneId) => virtualPaneId,
    onTemplateTokenError: ({ terminal, error }): never => {
      throw createCoreError("execution", {
        code: ErrorCodes.TEMPLATE_TOKEN_ERROR,
        message: `Template token resolution failed for pane ${terminal.virtualPaneId}: ${error.message}`,
        path: terminal.virtualPaneId,
      })
    },
  })

  for (const commandSet of prepared.commands) {
    const paneId = commandSet.terminal.virtualPaneId
    if (commandSet.title !== undefined) {
      steps.push(dryRunStep(`set title for ${paneId}`, ["pane", "rename", paneId, commandSet.title]))
    }
    if (commandSet.cwdCommand !== undefined) {
      steps.push(dryRunStep(`set cwd for ${paneId}`, ["pane", "run", paneId, commandSet.cwdCommand]))
    }
    for (const envEntry of commandSet.envCommands) {
      steps.push(dryRunStep(`set env ${envEntry.key} for ${paneId}`, ["pane", "run", paneId, envEntry.command]))
    }
    if (commandSet.command !== undefined) {
      steps.push(dryRunStep(`run command for ${paneId}`, ["pane", "run", paneId, commandSet.command.text]))
    }
  }
}

const dryRunStep = (summary: string, args: ReadonlyArray<string>): DryRunStep => ({
  backend: "herdr",
  summary,
  command: `herdr ${args.map(quoteForDisplay).join(" ")}`,
})

const resolveDryRunRatio = (step: CommandStep): string => {
  if (step.splitSizing?.mode === "dynamic-cells") {
    return "<dynamic>"
  }
  const splitSize = resolveSplitSize(step)
  if (splitSize.mode !== "percent") {
    return "<dynamic>"
  }
  const ratio = roundRatio(1 - Number(splitSize.percentage) / 100)
  assertSupportedRatio(step, ratio)
  return String(ratio)
}

const assertSupportedRatio = (step: CommandStep, ratio: number): void => {
  if (!Number.isFinite(ratio) || ratio < MIN_HERDR_RATIO || ratio > MAX_HERDR_RATIO) {
    throw createCoreError("execution", {
      code: ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED,
      message: "Herdr requires both sides of a split to occupy at least 10%",
      path: step.id,
      details: { ratio, minimumRatio: MIN_HERDR_RATIO, maximumRatio: MAX_HERDR_RATIO },
    })
  }
}

const registerPaneWithAncestors = (paneMap: PaneMap, virtualId: string, realId: string): void => {
  paneMap.set(virtualId, realId)
  let ancestor = virtualId
  while (ancestor.includes(".")) {
    ancestor = ancestor.slice(0, ancestor.lastIndexOf("."))
    if (paneMap.has(ancestor)) {
      break
    }
    paneMap.set(ancestor, realId)
  }
}

const requireRealPaneId = (paneMap: PaneMap, virtualId: string | undefined, stepId: string): string => {
  if (virtualId !== undefined) {
    const resolved = resolvePaneMapping(paneMap, virtualId)
    if (resolved !== undefined && resolved.length > 0) {
      return resolved
    }
  }
  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PANE,
    message: `Unknown herdr pane mapping for ${String(virtualId)}`,
    path: stepId,
  })
}

const requireInitialPaneId = (emission: PlanEmission): string => {
  if (emission.summary.initialPaneId.length === 0) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: "Plan emission is missing initial pane metadata",
      path: "plan.initialPaneId",
    })
  }
  return emission.summary.initialPaneId
}

const requireStepTarget = (step: CommandStep): string => {
  if (step.targetPaneId !== undefined && step.targetPaneId.length > 0) {
    return step.targetPaneId
  }
  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PANE,
    message: `${step.kind} step missing target pane metadata`,
    path: step.id,
  })
}

const unsupportedStep = (step: CommandStep): CoreError => {
  return createCoreError("execution", {
    code: ErrorCodes.INVALID_PLAN,
    message: `Unsupported step kind in emission: ${String((step as { kind?: unknown }).kind)}`,
    path: step.id,
  })
}

const roundRatio = (value: number): number => Number(value.toFixed(6))

const createdPaneContainsFocus = (createdPaneId: string | undefined, focusPaneId: string): boolean => {
  return createdPaneId !== undefined && (createdPaneId === focusPaneId || focusPaneId.startsWith(`${createdPaneId}.`))
}

const quoteForDisplay = (value: string): string => {
  if (/^[A-Za-z0-9_./:=<>-]+$/.test(value)) {
    return value
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

const logPaneMapping = (context: HerdrTerminalBackendContext, virtualId: string, realId: string): void => {
  const message = `[herdr] pane ${virtualId} -> ${realId}`
  if (context.verbose) {
    context.logger.info(message)
  } else {
    context.logger.debug(message)
  }
}
