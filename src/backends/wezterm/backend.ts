import type { PlanEmission, CommandStep, EmittedTerminal } from "../../core/emitter"
import { createCoreError } from "../../core/errors"
import { ErrorCodes } from "../../utils/errors"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  TerminalBackendContext,
} from "../../executor/terminal-backend"
import {
  killWeztermPane,
  listWeztermWindows,
  runWeztermCli,
  verifyWeztermAvailability,
  type RunWeztermErrorContext,
  type WeztermListResult,
} from "./cli"
import { buildNameToRealIdMap, replaceTemplateTokens, TemplateTokenError } from "../../utils/template-tokens"
import { waitForDelay } from "../../utils/async"
import {
  resolveSplitOrientation as resolveSplitOrientationFromStep,
  resolveSplitPercentage as resolveSplitPercentageFromStep,
} from "../../executor/split-step"

type PaneMap = Map<string, string>

type ExecuteWeztermCommand = (args: ReadonlyArray<string>, errorContext: RunWeztermErrorContext) => Promise<string>

const PANE_REGISTRATION_RETRIES = 5
const PANE_REGISTRATION_DELAY_MS = 100

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
    throw createCoreError("execution", {
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

  throw createCoreError("execution", {
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
        percent: resolveSplitPercentageFromStep(step),
        horizontal: resolveSplitOrientationFromStep(step) === "horizontal",
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
      command: `wezterm cli # ${(step.command ?? []).join(" ")}`,
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
  readonly preferredPaneId?: string
}): Promise<CurrentWindowResolution> => {
  const hasPreferredPane = typeof context.preferredPaneId === "string" && context.preferredPaneId.length > 0
  const preferredPaneId = hasPreferredPane ? (context.preferredPaneId as string) : undefined
  const preferredWindowId =
    preferredPaneId !== undefined ? findWindowContainingPane(context.list, preferredPaneId) : undefined

  const activeWindow =
    (preferredWindowId !== undefined
      ? context.list.windows.find((window) => window.windowId === preferredWindowId)
      : undefined) ??
    context.list.windows.find((window) => window.isActive) ??
    context.list.windows[0]

  if (!activeWindow) {
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "No active wezterm window detected",
      details: { hint: "Launch wezterm and ensure a window is focused, or run with --new-window." },
    })
  }

  const activeTab =
    (preferredPaneId !== undefined
      ? activeWindow.tabs.find((tab) => tab.panes.some((pane) => pane.paneId === preferredPaneId))
      : undefined) ??
    activeWindow.tabs.find((tab) => tab.isActive) ??
    activeWindow.tabs[0]

  if (!activeTab) {
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "No active wezterm tab detected",
      path: activeWindow.windowId,
      details: { hint: "Ensure a wezterm tab is focused before using --current-window." },
    })
  }

  const activePane =
    (preferredPaneId !== undefined ? activeTab.panes.find((pane) => pane.paneId === preferredPaneId) : undefined) ??
    activeTab.panes.find((pane) => pane.isActive) ??
    activeTab.panes[0]

  if (!activePane) {
    throw createCoreError("execution", {
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
      throw createCoreError("execution", {
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

const findWorkspaceForPane = (list: WeztermListResult, paneId: string): string | undefined => {
  for (const window of list.windows) {
    for (const tab of window.tabs) {
      for (const pane of tab.panes) {
        if (pane.paneId === paneId) {
          return window.workspace
        }
      }
    }
  }
  return undefined
}

const filterWindowsByWorkspace = (list: WeztermListResult, workspace?: string): WeztermListResult => {
  if (workspace === undefined || workspace.length === 0) {
    return list
  }
  const scoped = list.windows.filter((window) => window.workspace === workspace)
  if (scoped.length === 0) {
    return list
  }
  return { windows: scoped }
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
  for (let attempt = 0; attempt < PANE_REGISTRATION_RETRIES; attempt += 1) {
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

    if (attempt < PANE_REGISTRATION_RETRIES - 1) {
      await waitForDelay(PANE_REGISTRATION_DELAY_MS)
    }
  }

  throw createCoreError("execution", {
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
  initialCwd,
  workspaceHint,
  initialList,
  preferredPaneId,
}: {
  readonly windowMode: ApplyPlanParameters["windowMode"]
  readonly prompt?: TerminalBackendContext["prompt"]
  readonly dryRun: boolean
  readonly listWindows: () => Promise<WeztermListResult>
  readonly runCommand: ExecuteWeztermCommand
  readonly logCommand: (args: ReadonlyArray<string>) => void
  readonly initialCwd?: string
  readonly workspaceHint?: string
  readonly initialList?: WeztermListResult
  readonly preferredPaneId?: string
}): Promise<InitialPaneResolution> => {
  const hasPreferredPane = typeof preferredPaneId === "string" && preferredPaneId.length > 0
  const preferredPaneIdValue = hasPreferredPane ? (preferredPaneId as string) : undefined

  if (windowMode === "current-window") {
    const snapshot = initialList ?? (await listWindows())
    const scoped = filterWindowsByWorkspace(snapshot, workspaceHint)
    return resolveCurrentWindow({ list: scoped, prompt, dryRun, logCommand, preferredPaneId: preferredPaneIdValue })
  }

  const existingSnapshot = initialList ?? (await listWindows())
  const scopedExisting = filterWindowsByWorkspace(existingSnapshot, workspaceHint)
  const scopedPreferredWindowId =
    preferredPaneIdValue !== undefined ? findWindowContainingPane(scopedExisting, preferredPaneIdValue) : undefined
  const activeWindow =
    (scopedPreferredWindowId !== undefined
      ? scopedExisting.windows.find((window) => window.windowId === scopedPreferredWindowId)
      : undefined) ?? findActiveWindow(scopedExisting)

  if (activeWindow) {
    const args = ["spawn", "--window-id", activeWindow.windowId] as string[]
    if (typeof initialCwd === "string" && initialCwd.length > 0) {
      args.push("--cwd", initialCwd)
    }
    const spawnOutput = await runCommand(args, {
      message: "Failed to spawn wezterm tab",
    })
    const paneId = extractSpawnPaneId(spawnOutput)
    if (paneId.length === 0) {
      throw createCoreError("execution", {
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

  const args = ["spawn", "--new-window"] as string[]
  if (typeof initialCwd === "string" && initialCwd.length > 0) {
    args.push("--cwd", initialCwd)
  }
  if (typeof workspaceHint === "string" && workspaceHint.length > 0) {
    args.push("--workspace", workspaceHint)
  }
  const spawnOutput = await runCommand(args, {
    message: "Failed to spawn wezterm window",
  })
  const paneId = extractSpawnPaneId(spawnOutput)
  if (paneId.length === 0) {
    throw createCoreError("execution", {
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
    throw createCoreError("execution", {
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
  // wezterm cli spawn outputs pane-id first, followed by optional window or tab metadata
  const [paneId] = tokens
  if (typeof paneId !== "string") {
    return ""
  }
  return paneId.trim()
}

const findNewPaneId = (before: Set<string>, after: Set<string>): string | undefined => {
  for (const paneId of after) {
    if (!before.has(paneId)) {
      return paneId
    }
  }
  return undefined
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
  focusPaneVirtualId,
}: {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly paneMap: PaneMap
  readonly runCommand: ExecuteWeztermCommand
  readonly focusPaneVirtualId: string
}): Promise<void> => {
  // Build name-to-real-ID mapping for template token replacement
  const nameToRealIdMap = buildNameToRealIdMap(terminals, paneMap)

  // Validate focus pane upfront so layout errors are caught even if {{focus_pane}} is unused
  if (!paneMap.has(focusPaneVirtualId)) {
    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PANE,
      message: `Unknown focus pane: ${focusPaneVirtualId}`,
      path: focusPaneVirtualId,
    })
  }
  const focusPaneRealId = resolveRealPaneId(paneMap, focusPaneVirtualId, { stepId: focusPaneVirtualId })

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
      // Replace template tokens in the command
      const commandUsesFocusToken = terminal.command.includes("{{focus_pane}}")
      const focusPaneRealIdForCommand = commandUsesFocusToken ? focusPaneRealId : ""

      let commandWithTokensReplaced: string
      try {
        commandWithTokensReplaced = replaceTemplateTokens({
          command: terminal.command,
          currentPaneRealId: realPaneId,
          focusPaneRealId: focusPaneRealIdForCommand,
          nameToRealIdMap,
        })
      } catch (error) {
        if (error instanceof TemplateTokenError) {
          throw createCoreError("execution", {
            code: "TEMPLATE_TOKEN_ERROR",
            message: `Template token resolution failed for pane ${terminal.virtualPaneId}: ${error.message}`,
            path: terminal.virtualPaneId,
            details: {
              command: terminal.command,
              tokenType: error.tokenType,
              availablePanes: error.availablePanes,
            },
          })
        }
        throw error
      }

      // Handle ephemeral panes
      if (terminal.ephemeral === true) {
        const closeOnError = terminal.closeOnError === true
        if (closeOnError) {
          // Close pane regardless of command success/failure
          commandWithTokensReplaced = `${commandWithTokensReplaced}; exit`
        } else {
          // Close pane only on success (default behavior)
          commandWithTokensReplaced = `${commandWithTokensReplaced}; [ $? -eq 0 ] && exit`
        }
      }

      if (typeof terminal.delay === "number" && Number.isFinite(terminal.delay) && terminal.delay > 0) {
        await waitForDelay(terminal.delay)
      }

      await sendTextToPane({
        paneId: realPaneId,
        text: commandWithTokensReplaced,
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
    throw createCoreError("execution", {
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
    percent: resolveSplitPercentageFromStep(step),
    horizontal: resolveSplitOrientationFromStep(step) === "horizontal",
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
    getDryRunSteps: buildDryRunSteps,
  }
}
