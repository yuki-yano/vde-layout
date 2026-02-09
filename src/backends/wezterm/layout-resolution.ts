import { createCoreError } from "../../core/errors"
import type { WindowMode } from "../../models/types"
import type { ConfirmPaneClosure } from "../../contracts"
import { waitForDelay } from "../../utils/async"
import { ErrorCodes } from "../../utils/errors"
import { killWeztermPane, type WeztermListResult } from "./cli"
import type { ExecuteWeztermCommand, ListWeztermWindows } from "./shared"

const PANE_REGISTRATION_RETRIES = 5
const PANE_REGISTRATION_DELAY_MS = 100

type InitialPaneResolution = {
  readonly paneId: string
  readonly windowId: string
}

type CurrentWindowResolution = InitialPaneResolution & {
  readonly panesToClose: ReadonlyArray<string>
}

const resolveCurrentWindow = async (context: {
  readonly list: WeztermListResult
  readonly prompt?: ConfirmPaneClosure
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

export const findWorkspaceForPane = (list: WeztermListResult, paneId: string): string | undefined => {
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

export const collectPaneIdsForWindow = (list: WeztermListResult, windowId: string): Set<string> => {
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

const waitForPaneRegistration = async ({
  paneId,
  listWindows,
  windowHint,
}: {
  readonly paneId: string
  readonly listWindows: ListWeztermWindows
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

export const resolveInitialPane = async ({
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
  readonly windowMode: WindowMode
  readonly prompt?: ConfirmPaneClosure
  readonly dryRun: boolean
  readonly listWindows: ListWeztermWindows
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
