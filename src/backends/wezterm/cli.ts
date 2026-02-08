import { execa } from "execa"
import { createEnvironmentError, ErrorCodes } from "../../utils/errors"
import { createCoreError } from "../../core/errors"

const WEZTERM_BINARY = "wezterm"
const MINIMUM_VERSION = "20220624-141144-bd1b7c5d"
const VERSION_REGEX = /(\d{8})-(\d{6})-([0-9a-fA-F]+)/i

type ExecaLikeError = Error & {
  readonly exitCode?: number
  readonly code?: string
  readonly stderr?: string
  readonly stdout?: string
}

type WeztermListPane = {
  readonly paneId: string
  readonly isActive: boolean
}

type WeztermListTab = {
  readonly tabId: string
  readonly isActive: boolean
  readonly panes: ReadonlyArray<WeztermListPane>
}

export type WeztermListWindow = {
  readonly windowId: string
  readonly isActive: boolean
  readonly workspace?: string
  readonly tabs: ReadonlyArray<WeztermListTab>
}

export type WeztermListResult = {
  readonly windows: ReadonlyArray<WeztermListWindow>
}

export const verifyWeztermAvailability = async (): Promise<{ version: string }> => {
  let stdout: string
  try {
    const result = await execa(WEZTERM_BINARY, ["--version"])
    stdout = result.stdout
  } catch (error) {
    const execaError = error as ExecaLikeError
    if (execaError.code === "ENOENT") {
      throw createEnvironmentError("wezterm is not installed", ErrorCodes.BACKEND_NOT_FOUND, {
        backend: "wezterm",
        binary: WEZTERM_BINARY,
      })
    }
    throw createEnvironmentError("Failed to execute wezterm --version", ErrorCodes.WEZTERM_NOT_FOUND, {
      backend: "wezterm",
      binary: WEZTERM_BINARY,
      stderr: execaError.stderr,
    })
  }

  const detectedVersion = extractVersion(stdout)
  if (detectedVersion === undefined) {
    throw createEnvironmentError("Unable to determine wezterm version", ErrorCodes.UNSUPPORTED_WEZTERM_VERSION, {
      requiredVersion: MINIMUM_VERSION,
      detectedVersion: stdout.trim(),
    })
  }

  if (!isVersionSupported(detectedVersion, MINIMUM_VERSION)) {
    throw createEnvironmentError("Unsupported wezterm version", ErrorCodes.UNSUPPORTED_WEZTERM_VERSION, {
      requiredVersion: MINIMUM_VERSION,
      detectedVersion,
    })
  }

  return { version: detectedVersion }
}

export type RunWeztermErrorContext = {
  readonly message: string
  readonly path?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export const runWeztermCli = async (args: string[], errorContext: RunWeztermErrorContext): Promise<string> => {
  try {
    const result = await execa(WEZTERM_BINARY, ["cli", ...args])
    return result.stdout
  } catch (error) {
    const execaError = error as ExecaLikeError
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: errorContext.message,
      path: errorContext.path,
      details: {
        command: [WEZTERM_BINARY, "cli", ...args],
        stderr: execaError.stderr,
        exitCode: execaError.exitCode,
        backend: "wezterm",
        ...(errorContext.details ?? {}),
      },
    })
  }
}

export const listWeztermWindows = async (): Promise<WeztermListResult> => {
  const stdout = await runWeztermCli(["list", "--format", "json"], { message: "Failed to list wezterm panes" })
  const result = parseListResult(stdout)
  if (result === undefined) {
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "Invalid wezterm list output",
      details: { stdout },
    })
  }
  return result
}

export const killWeztermPane = async (paneId: string): Promise<void> => {
  await runWeztermCli(["kill-pane", "--pane-id", paneId], {
    message: `Failed to kill wezterm pane ${paneId}`,
    path: paneId,
  })
}

const extractVersion = (raw: string): string | undefined => {
  const match = raw.match(VERSION_REGEX)
  if (!match) {
    return undefined
  }
  const date = match[1]
  const time = match[2]
  const commit = match[3]
  if (date === undefined || time === undefined || commit === undefined) {
    return undefined
  }
  return `${date}-${time}-${commit.toLowerCase()}`
}

const isVersionSupported = (detected: string, minimum: string): boolean => {
  const parse = (version: string): { build: number; commit: string } | undefined => {
    const match = version.match(VERSION_REGEX)
    if (!match) {
      return undefined
    }
    const date = match[1]
    const time = match[2]
    const commit = match[3]
    if (date === undefined || time === undefined || commit === undefined) {
      return undefined
    }
    const build = Number(`${date}${time}`)
    if (Number.isNaN(build)) {
      return undefined
    }
    return { build, commit: commit.toLowerCase() }
  }

  const detectedInfo = parse(detected)
  const minimumInfo = parse(minimum)
  if (detectedInfo === undefined || minimumInfo === undefined) {
    return false
  }

  if (detectedInfo.build > minimumInfo.build) {
    return true
  }
  if (detectedInfo.build < minimumInfo.build) {
    return false
  }

  return detectedInfo.commit >= minimumInfo.commit
}

const toIdString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number") {
    return value.toString()
  }
  return undefined
}

const isNonEmptyString = (value: string | undefined): value is string => {
  return typeof value === "string" && value.length > 0
}

const toWorkspaceString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  return undefined
}

type RawListPane = {
  readonly pane_id?: number | string
  readonly is_active?: unknown
}

type RawListTab = {
  readonly tab_id?: number | string
  readonly is_active?: unknown
  readonly panes?: RawListPane[]
}

type RawListWindow = {
  readonly window_id?: number | string
  readonly is_active?: unknown
  readonly workspace?: unknown
  readonly tabs?: RawListTab[]
}

type RawListEntry = {
  readonly window_id?: number | string
  readonly tab_id?: number | string
  readonly pane_id?: number | string
  readonly workspace?: unknown
  readonly is_active?: unknown
}

type RawListResult = {
  readonly windows?: RawListWindow[]
}

const parseListResult = (stdout: string): WeztermListResult | undefined => {
  try {
    const parsed: unknown = JSON.parse(stdout)

    if (Array.isArray(parsed)) {
      const windowMap = new Map<
        string,
        {
          windowId: string
          isActive: boolean
          workspace?: string
          tabs: Map<
            string,
            {
              tabId: string
              isActive: boolean
              panes: WeztermListPane[]
            }
          >
        }
      >()

      for (const entry of parsed) {
        if (typeof entry !== "object" || entry === null) {
          continue
        }
        const listEntry = entry as RawListEntry
        const windowIdRaw = toIdString(listEntry.window_id)
        const paneIdRaw = toIdString(listEntry.pane_id)
        const tabIdRaw = toIdString(listEntry.tab_id) ?? windowIdRaw
        if (!isNonEmptyString(windowIdRaw) || !isNonEmptyString(tabIdRaw) || !isNonEmptyString(paneIdRaw)) {
          continue
        }
        const windowId = windowIdRaw
        const tabId = tabIdRaw
        const paneId = paneIdRaw
        const workspace = toWorkspaceString(listEntry.workspace)

        let windowRecord = windowMap.get(windowId)
        if (!windowRecord) {
          windowRecord = {
            windowId,
            isActive: false,
            workspace,
            tabs: new Map(),
          }
          windowMap.set(windowId, windowRecord)
        } else if (workspace !== undefined && windowRecord.workspace === undefined) {
          windowRecord.workspace = workspace
        }

        let tabRecord = windowRecord.tabs.get(tabId)
        if (!tabRecord) {
          tabRecord = {
            tabId,
            isActive: false,
            panes: [],
          }
          windowRecord.tabs.set(tabId, tabRecord)
        }

        const pane: WeztermListPane = {
          paneId,
          isActive: listEntry.is_active === true,
        }

        windowRecord.isActive ||= listEntry.is_active === true
        tabRecord.isActive ||= listEntry.is_active === true
        tabRecord.panes.push(pane)
      }

      const windows = Array.from(windowMap.values()).map(
        (windowRecord): WeztermListWindow => ({
          windowId: windowRecord.windowId,
          isActive: windowRecord.isActive,
          workspace: windowRecord.workspace,
          tabs: Array.from(windowRecord.tabs.values()).map(
            (tabRecord): WeztermListTab => ({
              tabId: tabRecord.tabId,
              isActive: tabRecord.isActive,
              panes: tabRecord.panes.map(
                (pane): WeztermListPane => ({
                  paneId: pane.paneId,
                  isActive: pane.isActive,
                }),
              ),
            }),
          ),
        }),
      )

      return {
        windows,
      }
    }

    if (typeof parsed === "object" && parsed !== null) {
      const candidate = parsed as Partial<RawListResult>
      const windows = Array.isArray(candidate.windows) ? candidate.windows : []
      const mappedWindows: WeztermListWindow[] = []

      for (const window of windows) {
        if (typeof window !== "object" || window === null) {
          continue
        }
        const rawWindow = window as RawListWindow
        const windowIdRaw = toIdString(rawWindow.window_id)
        if (!isNonEmptyString(windowIdRaw)) {
          continue
        }
        const windowId = windowIdRaw
        const workspace = toWorkspaceString(rawWindow.workspace)

        const mappedTabs: WeztermListTab[] = []
        const tabs = Array.isArray(rawWindow.tabs) ? rawWindow.tabs : []
        for (const tab of tabs) {
          if (typeof tab !== "object" || tab === null) {
            continue
          }
          const rawTab = tab as RawListTab
          const tabIdRaw = toIdString(rawTab.tab_id)
          if (!isNonEmptyString(tabIdRaw)) {
            continue
          }
          const tabId = tabIdRaw

          const paneRecords = Array.isArray(rawTab.panes) ? rawTab.panes : []
          const mappedPanes: WeztermListPane[] = []
          for (const pane of paneRecords) {
            if (typeof pane !== "object" || pane === null) {
              continue
            }
            const rawPane = pane as RawListPane
            const paneIdRaw = toIdString(rawPane.pane_id)
            if (!isNonEmptyString(paneIdRaw)) {
              continue
            }
            const paneId = paneIdRaw

            mappedPanes.push({
              paneId,
              isActive: rawPane.is_active === true,
            })
          }

          mappedTabs.push({
            tabId,
            isActive: rawTab.is_active === true,
            panes: mappedPanes,
          })
        }

        mappedWindows.push({
          windowId,
          isActive: rawWindow.is_active === true,
          workspace,
          tabs: mappedTabs,
        })
      }

      return { windows: mappedWindows }
    }

    return undefined
  } catch {
    return undefined
  }
}
