import type { PlanEmission, CommandStep, EmittedTerminal } from "../../core/emitter.ts"
import { createFunctionalError } from "../../core/errors.ts"
import { ErrorCodes } from "../../utils/errors.ts"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  TerminalBackendContext,
} from "../terminal-backend.ts"
import {
  killWeztermPane,
  listWeztermWindows,
  runWeztermCli,
  verifyWeztermAvailability,
  type WeztermListResult,
} from "../../wezterm/cli.ts"

type PaneMap = Map<string, string>

type ExecuteWeztermCommand = (
  args: ReadonlyArray<string>,
  errorContext: Parameters<typeof runWeztermCli>[1],
) => Promise<string>

type InitialPaneResolution = {
  readonly paneId: string
  readonly windowId: string
}

type CurrentWindowResolution = InitialPaneResolution & {
  readonly panesToClose: ReadonlyArray<string>
}

const ensureVirtualPaneId = (emission: PlanEmission): string => {
  const { initialPaneId } = emission.summary
  if (typeof initialPaneId !== "string" || initialPaneId.length === 0) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.INVALID_PANE,
      message: "Plan emission is missing initial pane metadata",
      path: "plan.initialPaneId",
    })
  }
  return initialPaneId
}

const registerPaneWithAncestors = (map: PaneMap, virtualId: string, realId: string): void => {
  map.set(virtualId, realId)

  let ancestor = virtualId
  while (ancestor.includes(".")) {
    ancestor = ancestor.slice(0, ancestor.lastIndexOf("."))
    if (!map.has(ancestor)) {
      map.set(ancestor, realId)
    } else {
      break
    }
  }
}
const resolveRealPaneId = (paneMap: PaneMap, virtualId: string, context: { readonly stepId: string }): string => {
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

  throw createFunctionalError("execution", {
    code: ErrorCodes.INVALID_PANE,
    message: `Unknown wezterm pane mapping for ${virtualId}`,
    path: context.stepId,
  })
}

const buildDryRunSteps = (emission: PlanEmission): DryRunStep[] => {
  const steps: DryRunStep[] = []

  for (const step of emission.steps) {
    if (step.kind === "split") {
      const target = step.targetPaneId ?? "<unknown>"
      const args = buildSplitArguments({
        targetPaneId: target,
        percent: extractPercent(step.command),
        horizontal: isHorizontalSplit(step.command),
      })
      steps.push({
        backend: "wezterm",
        summary: step.summary,
        command: `wezterm cli ${args.join(" ")}`,
      })
      continue
    }

    if (step.kind === "focus") {
      const target = step.targetPaneId ?? "<unknown>"
      steps.push({
        backend: "wezterm",
        summary: step.summary,
        command: `wezterm cli activate-pane --pane-id ${target}`,
      })
      continue
    }

    steps.push({
      backend: "wezterm",
      summary: step.summary,
      command: `wezterm cli # ${step.command.join(" ")}`,
    })
  }

  for (const terminal of emission.terminals) {
    const paneId = terminal.virtualPaneId
    if (typeof terminal.cwd === "string" && terminal.cwd.length > 0) {
      const cwdCommand = `cd "${terminal.cwd.split('"').join('\\"')}"`
      steps.push({
        backend: "wezterm",
        summary: `set cwd for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- '${cwdCommand.replace(/'/g, "\\'")}'`,
      })
    }

    if (terminal.env !== undefined) {
      for (const [key, value] of Object.entries(terminal.env)) {
        const envCommand = `export ${key}="${String(value).split('"').join('\\"')}"`
        steps.push({
          backend: "wezterm",
          summary: `set env ${key} for ${paneId}`,
          command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- '${envCommand.replace(/'/g, "\\'")}'`,
        })
      }
    }

    if (typeof terminal.command === "string" && terminal.command.length > 0) {
      steps.push({
        backend: "wezterm",
        summary: `run command for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- '${terminal.command.replace(/'/g, "\\'")}'`,
      })
    }
  }

  return steps
}

const resolveCurrentWindow = async (context: {
  readonly list: WeztermListResult
  readonly prompt?: TerminalBackendContext["prompt"]
  readonly dryRun: boolean
  readonly logCommand: (args: ReadonlyArray<string>) => void
}): Promise<CurrentWindowResolution> => {
  const activeWindow = context.list.windows.find((window) => window.isActive) ?? context.list.windows[0]

  if (!activeWindow) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "No active wezterm window detected",
      details: { hint: "Launch wezterm and ensure a window is focused, or run with --new-window." },
    })
  }

  const activeTab = activeWindow.tabs.find((tab) => tab.isActive) ?? activeWindow.tabs[0]

  if (!activeTab) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "No active wezterm tab detected",
      path: activeWindow.windowId,
      details: { hint: "Ensure a wezterm tab is focused before using --current-window." },
    })
  }

  const activePane = activeTab.panes.find((pane) => pane.isActive) ?? activeTab.panes[0]

  if (!activePane) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "No active wezterm pane detected",
      path: activeTab.tabId,
      details: { hint: "Ensure a wezterm pane is active before using --current-window." },
    })
  }

  const panesToClose = activeTab.panes.filter((pane) => pane.paneId !== activePane.paneId).map((pane) => pane.paneId)

  if (panesToClose.length > 0) {
    let confirmed = true
    if (context.prompt) {
      confirmed = await context.prompt({ panesToClose, dryRun: context.dryRun })
    }

    if (confirmed !== true) {
      throw createFunctionalError("execution", {
        code: ErrorCodes.USER_CANCELLED,
        message: "Aborted layout application for current wezterm window",
        path: activePane.paneId,
        details: { panes: panesToClose },
      })
    }

    for (const paneId of panesToClose) {
      context.logCommand(["kill-pane", "--pane-id", paneId])
      await killWeztermPane(paneId)
    }
  }

  return {
    paneId: activePane.paneId,
    windowId: activeWindow.windowId,
    panesToClose,
  }
}

const findActiveWindow = (
  list: WeztermListResult,
): { windowId: string; tabs: (typeof list.windows)[number]["tabs"] } | undefined => {
  return list.windows.find((window) => window.isActive) ?? list.windows[0]
}

const findWindowContainingPane = (list: WeztermListResult, paneId: string): string | undefined => {
  for (const window of list.windows) {
    for (const tab of window.tabs) {
      for (const pane of tab.panes) {
        if (pane.paneId === paneId) {
          return window.windowId
        }
      }
    }
  }
  return undefined
}

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const waitForPaneRegistration = async ({
  paneId,
  listWindows,
  windowHint,
}: {
  readonly paneId: string
  readonly listWindows: () => Promise<WeztermListResult>
  readonly windowHint?: string
}): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const snapshot = await listWindows()

    if (typeof windowHint === "string") {
      try {
        const panes = collectPaneIdsForWindow(snapshot, windowHint)
        if (panes.has(paneId)) {
          return windowHint
        }
      } catch {
        // window may not be ready yet; fall through to global search.
      }
    }

    const located = findWindowContainingPane(snapshot, paneId)
    if (typeof located === "string" && located.length > 0) {
      return located
    }

    if (attempt < 4) {
      await delay(100)
    }
  }

  throw createFunctionalError("execution", {
    code: ErrorCodes.TERMINAL_COMMAND_FAILED,
    message: "Unable to locate spawned wezterm window",
    details: { paneId, hint: "Verify that wezterm is running and the CLI client can connect." },
  })
}

const resolveInitialPane = async ({
  windowMode,
  prompt,
  dryRun,
  listWindows,
  runCommand,
  logCommand,
}: {
  readonly windowMode: ApplyPlanParameters["windowMode"]
  readonly prompt?: TerminalBackendContext["prompt"]
  readonly dryRun: boolean
  readonly listWindows: () => Promise<WeztermListResult>
  readonly runCommand: ExecuteWeztermCommand
  readonly logCommand: (args: ReadonlyArray<string>) => void
}): Promise<InitialPaneResolution> => {
  if (windowMode === "current-window") {
    const list = await listWindows()
    return resolveCurrentWindow({ list, prompt, dryRun, logCommand })
  }

  const existing = await listWindows()
  const activeWindow = findActiveWindow(existing)

  if (activeWindow) {
    const spawnOutput = await runCommand(["spawn", "--window-id", activeWindow.windowId], {
      message: "Failed to spawn wezterm tab",
    })
    const paneId = extractSpawnPaneId(spawnOutput)
    if (paneId.length === 0) {
      throw createFunctionalError("execution", {
        code: ErrorCodes.TERMINAL_COMMAND_FAILED,
        message: "wezterm spawn did not return a pane id",
        details: { stdout: spawnOutput },
      })
    }
    const windowId = await waitForPaneRegistration({
      paneId,
      listWindows,
      windowHint: activeWindow.windowId,
    })
    return { paneId, windowId }
  }

  const spawnOutput = await runCommand(["spawn", "--new-window"], {
    message: "Failed to spawn wezterm window",
  })
  const paneId = extractSpawnPaneId(spawnOutput)
  if (paneId.length === 0) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "wezterm spawn did not return a pane id",
      details: { stdout: spawnOutput },
    })
  }

  const newWindowId = await waitForPaneRegistration({
    paneId,
    listWindows,
  })
  return { paneId, windowId: newWindowId }
}

const collectPaneIdsForWindow = (list: WeztermListResult, windowId: string): Set<string> => {
  const targetWindow = list.windows.find((window) => window.windowId === windowId)
  if (!targetWindow) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: `Wezterm window ${windowId} not found`,
      details: { windowId },
    })
  }

  const paneIds = targetWindow.tabs.flatMap((tab) => tab.panes.map((pane) => pane.paneId))
  return new Set(paneIds)
}

const extractSpawnPaneId = (output: string): string => {
  const trimmed = output.trim()
  if (trimmed.length === 0) {
    return ""
  }

  const lastLine = trimmed.split("\n").pop() ?? ""
  const tokens = lastLine.split(/\s+/).filter((segment) => segment.length > 0)
  if (tokens.length === 0) {
    return ""
  }
  // wezterm cli spawn --new-window outputs pane-id and window-id separated by space
  const candidateIndex = tokens.length > 1 ? tokens.length - 2 : 0
  const candidate = tokens[candidateIndex]
  if (typeof candidate !== "string") {
    return ""
  }
  return candidate.trim()
}

const findNewPaneId = (before: Set<string>, after: Set<string>): string | undefined => {
  for (const paneId of after) {
    if (!before.has(paneId)) {
      return paneId
    }
  }
  return undefined
}

const isHorizontalSplit = (command: ReadonlyArray<string>): boolean => {
  return command.includes("-h")
}

const extractPercent = (command: ReadonlyArray<string>): string => {
  const index = command.findIndex((segment) => segment === "-p")
  if (index >= 0 && index + 1 < command.length) {
    const value = command[index + 1]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return "50"
}

const buildSplitArguments = (params: {
  readonly targetPaneId: string
  readonly percent: string
  readonly horizontal: boolean
}): string[] => {
  const directionFlag = params.horizontal ? "--right" : "--bottom"
  return ["split-pane", directionFlag, "--percent", params.percent, "--pane-id", params.targetPaneId]
}

const applyFocusStep = async ({
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
    throw createFunctionalError("execution", {
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

const escapeDoubleQuotes = (value: string): string => {
  return value.split('"').join('\\"')
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

const applyTerminalCommands = async ({
  terminals,
  paneMap,
  runCommand,
}: {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly paneMap: PaneMap
  readonly runCommand: ExecuteWeztermCommand
}): Promise<void> => {
  for (const terminal of terminals) {
    const realPaneId = resolveRealPaneId(paneMap, terminal.virtualPaneId, { stepId: terminal.virtualPaneId })

    if (typeof terminal.cwd === "string" && terminal.cwd.length > 0) {
      const escapedCwd = escapeDoubleQuotes(terminal.cwd)
      await sendTextToPane({
        paneId: realPaneId,
        text: `cd "${escapedCwd}"`,
        runCommand,
        context: {
          message: `Failed to change directory for pane ${terminal.virtualPaneId}`,
          path: terminal.virtualPaneId,
          details: { cwd: terminal.cwd },
        },
      })
    }

    if (terminal.env !== undefined) {
      for (const [key, value] of Object.entries(terminal.env)) {
        const escapedValue = escapeDoubleQuotes(String(value))
        await sendTextToPane({
          paneId: realPaneId,
          text: `export ${key}="${escapedValue}"`,
          runCommand,
          context: {
            message: `Failed to set environment variable ${key}`,
            path: terminal.virtualPaneId,
          },
        })
      }
    }

    if (typeof terminal.command === "string" && terminal.command.length > 0) {
      await sendTextToPane({
        paneId: realPaneId,
        text: terminal.command,
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

const applySplitStep = async ({
  step,
  paneMap,
  windowId,
  runCommand,
  listWindows,
  logPaneMapping,
}: {
  readonly step: CommandStep
  readonly paneMap: PaneMap
  readonly windowId: string
  readonly runCommand: ExecuteWeztermCommand
  readonly listWindows: () => Promise<WeztermListResult>
  readonly logPaneMapping: (virtualId: string, realId: string) => void
}): Promise<void> => {
  const targetVirtualId = step.targetPaneId
  if (typeof targetVirtualId !== "string" || targetVirtualId.length === 0) {
    throw createFunctionalError("execution", {
      code: ErrorCodes.INVALID_PANE,
      message: "Split step missing target pane metadata",
      path: step.id,
    })
  }

  const targetRealId = resolveRealPaneId(paneMap, targetVirtualId, { stepId: step.id })

  const beforeList = await listWindows()
  const beforePaneIds = collectPaneIdsForWindow(beforeList, windowId)

  const args = buildSplitArguments({
    targetPaneId: targetRealId,
    percent: extractPercent(step.command),
    horizontal: isHorizontalSplit(step.command),
  })

  await runCommand(args, {
    message: `Failed to execute split step ${step.id}`,
    path: step.id,
  })

  const afterList = await listWindows()
  const afterPaneIds = collectPaneIdsForWindow(afterList, windowId)

  const newPaneId = findNewPaneId(beforePaneIds, afterPaneIds)
  if (typeof newPaneId !== "string" || newPaneId.length === 0) {
    throw createFunctionalError("execution", {
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

export const createWeztermBackend = (context: TerminalBackendContext): TerminalBackend => {
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
    await verifyWeztermAvailability()
  }

  const applyPlan = async ({ emission, windowMode }: ApplyPlanParameters): Promise<ApplyPlanResult> => {
    const initialVirtualPaneId = ensureVirtualPaneId(emission)
    const paneMap: PaneMap = new Map()

    const { paneId: initialPaneId, windowId } = await resolveInitialPane({
      windowMode,
      prompt: context.prompt,
      dryRun: context.dryRun,
      listWindows,
      runCommand,
      logCommand,
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
        })
        executedSteps += 1
      } else if (step.kind === "focus") {
        await applyFocusStep({
          step,
          paneMap,
          runCommand,
        })
        executedSteps += 1
      }
    }

    await applyTerminalCommands({
      terminals: emission.terminals,
      paneMap,
      runCommand,
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
    getDryRunSteps: buildDryRunSteps,
  }
}
