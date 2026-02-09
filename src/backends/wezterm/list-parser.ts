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

type MutableTabRecord = {
  tabId: string
  isActive: boolean
  panes: WeztermListPane[]
}

type MutableWindowRecord = {
  windowId: string
  isActive: boolean
  workspace?: string
  tabs: Map<string, MutableTabRecord>
}

type NormalizedArrayEntry = {
  windowId: string
  tabId: string
  paneId: string
  workspace?: string
  isActive: boolean
}

const toImmutablePanes = (panes: ReadonlyArray<WeztermListPane>): WeztermListPane[] => {
  return panes.map(
    (pane): WeztermListPane => ({
      paneId: pane.paneId,
      isActive: pane.isActive,
    }),
  )
}

const toImmutableTabs = (tabs: ReadonlyMap<string, MutableTabRecord>): WeztermListTab[] => {
  return Array.from(tabs.values()).map(
    (tabRecord): WeztermListTab => ({
      tabId: tabRecord.tabId,
      isActive: tabRecord.isActive,
      panes: toImmutablePanes(tabRecord.panes),
    }),
  )
}

const toImmutableWindows = (windows: ReadonlyMap<string, MutableWindowRecord>): WeztermListWindow[] => {
  return Array.from(windows.values()).map(
    (windowRecord): WeztermListWindow => ({
      windowId: windowRecord.windowId,
      isActive: windowRecord.isActive,
      workspace: windowRecord.workspace,
      tabs: toImmutableTabs(windowRecord.tabs),
    }),
  )
}

const normalizeArrayEntry = (entry: unknown): NormalizedArrayEntry | undefined => {
  if (typeof entry !== "object" || entry === null) {
    return undefined
  }
  const listEntry = entry as RawListEntry
  const windowIdRaw = toIdString(listEntry.window_id)
  const paneIdRaw = toIdString(listEntry.pane_id)
  const tabIdRaw = toIdString(listEntry.tab_id) ?? windowIdRaw
  if (!isNonEmptyString(windowIdRaw) || !isNonEmptyString(tabIdRaw) || !isNonEmptyString(paneIdRaw)) {
    return undefined
  }
  return {
    windowId: windowIdRaw,
    tabId: tabIdRaw,
    paneId: paneIdRaw,
    workspace: toWorkspaceString(listEntry.workspace),
    isActive: listEntry.is_active === true,
  }
}

const getOrCreateWindowRecord = (
  windows: Map<string, MutableWindowRecord>,
  entry: NormalizedArrayEntry,
): MutableWindowRecord => {
  const existingWindow = windows.get(entry.windowId)
  if (existingWindow) {
    if (entry.workspace !== undefined && existingWindow.workspace === undefined) {
      existingWindow.workspace = entry.workspace
    }
    return existingWindow
  }
  const createdWindow: MutableWindowRecord = {
    windowId: entry.windowId,
    isActive: false,
    workspace: entry.workspace,
    tabs: new Map(),
  }
  windows.set(entry.windowId, createdWindow)
  return createdWindow
}

const getOrCreateTabRecord = (windowRecord: MutableWindowRecord, tabId: string): MutableTabRecord => {
  const existingTab = windowRecord.tabs.get(tabId)
  if (existingTab) {
    return existingTab
  }
  const createdTab: MutableTabRecord = {
    tabId,
    isActive: false,
    panes: [],
  }
  windowRecord.tabs.set(tabId, createdTab)
  return createdTab
}

const parseArrayResponse = (parsed: unknown): WeztermListResult | undefined => {
  if (!Array.isArray(parsed)) {
    return undefined
  }

  const windowMap = new Map<string, MutableWindowRecord>()
  for (const entry of parsed) {
    const normalizedEntry = normalizeArrayEntry(entry)
    if (!normalizedEntry) {
      continue
    }

    const windowRecord = getOrCreateWindowRecord(windowMap, normalizedEntry)
    const tabRecord = getOrCreateTabRecord(windowRecord, normalizedEntry.tabId)

    windowRecord.isActive ||= normalizedEntry.isActive
    tabRecord.isActive ||= normalizedEntry.isActive
    tabRecord.panes.push({
      paneId: normalizedEntry.paneId,
      isActive: normalizedEntry.isActive,
    })
  }

  return { windows: toImmutableWindows(windowMap) }
}

const parseObjectPane = (pane: unknown): WeztermListPane | undefined => {
  if (typeof pane !== "object" || pane === null) {
    return undefined
  }
  const rawPane = pane as RawListPane
  const paneIdRaw = toIdString(rawPane.pane_id)
  if (!isNonEmptyString(paneIdRaw)) {
    return undefined
  }
  return {
    paneId: paneIdRaw,
    isActive: rawPane.is_active === true,
  }
}

const parseObjectTab = (tab: unknown): WeztermListTab | undefined => {
  if (typeof tab !== "object" || tab === null) {
    return undefined
  }
  const rawTab = tab as RawListTab
  const tabIdRaw = toIdString(rawTab.tab_id)
  if (!isNonEmptyString(tabIdRaw)) {
    return undefined
  }

  const paneRecords = Array.isArray(rawTab.panes) ? rawTab.panes : []
  const panes: WeztermListPane[] = []
  for (const pane of paneRecords) {
    const mappedPane = parseObjectPane(pane)
    if (mappedPane) {
      panes.push(mappedPane)
    }
  }

  return {
    tabId: tabIdRaw,
    isActive: rawTab.is_active === true,
    panes,
  }
}

const parseObjectWindow = (window: unknown): WeztermListWindow | undefined => {
  if (typeof window !== "object" || window === null) {
    return undefined
  }
  const rawWindow = window as RawListWindow
  const windowIdRaw = toIdString(rawWindow.window_id)
  if (!isNonEmptyString(windowIdRaw)) {
    return undefined
  }

  const tabs: WeztermListTab[] = []
  const rawTabs = Array.isArray(rawWindow.tabs) ? rawWindow.tabs : []
  for (const tab of rawTabs) {
    const mappedTab = parseObjectTab(tab)
    if (mappedTab) {
      tabs.push(mappedTab)
    }
  }

  return {
    windowId: windowIdRaw,
    isActive: rawWindow.is_active === true,
    workspace: toWorkspaceString(rawWindow.workspace),
    tabs,
  }
}

const parseObjectResponse = (parsed: unknown): WeztermListResult | undefined => {
  if (typeof parsed !== "object" || parsed === null) {
    return undefined
  }

  const candidate = parsed as Partial<RawListResult>
  const rawWindows = Array.isArray(candidate.windows) ? candidate.windows : []
  const windows: WeztermListWindow[] = []
  for (const window of rawWindows) {
    const mappedWindow = parseObjectWindow(window)
    if (mappedWindow) {
      windows.push(mappedWindow)
    }
  }
  return { windows }
}

export const parseWeztermListResult = (stdout: string): WeztermListResult | undefined => {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return parseArrayResponse(parsed) ?? parseObjectResponse(parsed)
  } catch {
    return undefined
  }
}
