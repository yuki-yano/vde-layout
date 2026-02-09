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

export const parseWeztermListResult = (stdout: string): WeztermListResult | undefined => {
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
