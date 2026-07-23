import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PlanEmission } from "../core/emitter"
import { createHerdrBackend } from "../backends/herdr/backend"
import type { HerdrPaneInfo } from "../backends/herdr/cli"
import type { HerdrTerminalBackendContext } from "./terminal-backend"
import type { Logger } from "../utils/logger"
import { LogLevel } from "../utils/logger"

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  current: vi.fn(),
  list: vi.fn(),
  createTab: vi.fn(),
  split: vi.fn(),
  layout: vi.fn(),
  close: vi.fn(),
  rename: vi.fn(),
  run: vi.fn(),
}))

vi.mock("../backends/herdr/cli", () => ({
  verifyHerdrAvailability: mocks.verify,
  currentHerdrPane: mocks.current,
  listHerdrPanes: mocks.list,
  createHerdrTab: mocks.createTab,
  splitHerdrPane: mocks.split,
  getHerdrPaneLayout: mocks.layout,
  closeHerdrPane: mocks.close,
  renameHerdrPane: mocks.rename,
  runInHerdrPane: mocks.run,
  HERDR_MINIMUM_VERSION: "0.7.4",
}))

const pane = (paneId: string, tabId = "tab-1", focused = false): HerdrPaneInfo => ({
  pane_id: paneId,
  workspace_id: "ws-1",
  tab_id: tabId,
  focused,
})

const logger = (): Logger => {
  const value: Logger = {
    level: LogLevel.INFO,
    prefix: "",
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    createChild: vi.fn(() => value),
  }
  return value
}

const context = (overrides: Partial<HerdrTerminalBackendContext> = {}): HerdrTerminalBackendContext => ({
  logger: logger(),
  dryRun: false,
  verbose: false,
  cwd: "/repo",
  ...overrides,
})

const minimalEmission = (): PlanEmission => ({
  steps: [],
  summary: { stepsCount: 0, focusPaneId: "root", initialPaneId: "root" },
  terminals: [
    {
      virtualPaneId: "root",
      name: "editor",
      focus: true,
      cwd: "/repo/editor",
      env: { MODE: "dev" },
      title: "Editor",
      command: "nvim",
    },
  ],
  hash: "hash",
})

const splitEmission = (percentage = 35): PlanEmission => ({
  steps: [
    {
      id: "root:split:1",
      kind: "split",
      summary: "split root (-h)",
      targetPaneId: "root",
      createdPaneId: "root.1",
      orientation: "horizontal",
      percentage,
      splitSizing: { mode: "percent", percentage },
    },
    {
      id: "root.1:focus",
      kind: "focus",
      summary: "select pane root.1",
      targetPaneId: "root.1",
    },
  ],
  summary: { stepsCount: 2, focusPaneId: "root.1", initialPaneId: "root.0" },
  terminals: [
    { virtualPaneId: "root.0", name: "editor", focus: false },
    { virtualPaneId: "root.1", name: "server", focus: true },
  ],
  hash: "hash",
})

describe("createHerdrBackend", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.createTab.mockResolvedValue({ pane: pane("pane-1", "tab-2", true), tabId: "tab-2" })
    mocks.split.mockResolvedValue(pane("pane-2", "tab-2", true))
    mocks.current.mockResolvedValue(pane("pane-1", "tab-1", true))
    mocks.list.mockResolvedValue([pane("pane-1", "tab-1", true)])
  })

  it("skips availability checks in dry-run mode", async () => {
    await createHerdrBackend(context({ dryRun: true })).verifyEnvironment()
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it("requires herdr for a real execution", async () => {
    await createHerdrBackend(context()).verifyEnvironment()
    expect(mocks.verify).toHaveBeenCalledOnce()
  })

  it("creates a tab and applies terminal metadata and commands", async () => {
    const result = await createHerdrBackend(context({ workspaceId: "ws-1" })).applyPlan({
      emission: minimalEmission(),
      windowMode: "new-window",
      windowName: "Development",
    })

    expect(mocks.createTab).toHaveBeenCalledWith({ workspaceId: "ws-1", cwd: "/repo/editor", label: "Development" })
    expect(mocks.rename).toHaveBeenCalledWith("pane-1", "Editor")
    expect(mocks.run.mock.calls).toEqual([
      ["pane-1", "cd -- '/repo/editor'"],
      ["pane-1", "export MODE='dev'"],
      ["pane-1", "nvim"],
    ])
    expect(result).toMatchObject({ focusPaneId: "pane-1", windowId: "tab-2", executedSteps: 0 })
    expect(result.paneNameToRealId?.get("editor")).toBe("pane-1")
  })

  it("reuses the current tab after confirming sibling closure", async () => {
    const prompt = vi.fn().mockResolvedValue(true)
    mocks.list.mockResolvedValue([pane("pane-1", "tab-1", true), pane("pane-2"), pane("other", "tab-2")])

    const result = await createHerdrBackend(context({ paneId: "pane-1", prompt })).applyPlan({
      emission: minimalEmission(),
      windowMode: "current-window",
    })

    expect(mocks.current).toHaveBeenCalledWith("pane-1")
    expect(prompt).toHaveBeenCalledWith({ panesToClose: ["pane-2"], dryRun: false })
    expect(mocks.close).toHaveBeenCalledWith("pane-2")
    expect(mocks.close).not.toHaveBeenCalledWith("other")
    expect(result.windowId).toBe("tab-1")
  })

  it("converts the created-pane percentage to herdr's first-pane ratio", async () => {
    const result = await createHerdrBackend(context()).applyPlan({
      emission: splitEmission(35),
      windowMode: "new-window",
    })

    expect(mocks.split).toHaveBeenCalledWith({ paneId: "pane-1", direction: "right", ratio: 0.65, focus: true })
    expect(result).toMatchObject({ focusPaneId: "pane-2", executedSteps: 2 })
  })

  it("focuses a created ancestor branch that contains the final focus pane", async () => {
    const emission = splitEmission(50)
    const nestedFocus: PlanEmission = {
      ...emission,
      steps: emission.steps.map((step) => (step.kind === "focus" ? { ...step, targetPaneId: "root.1.0" } : step)),
      summary: { ...emission.summary, focusPaneId: "root.1.0" },
      terminals: [
        { virtualPaneId: "root.0", name: "left", focus: false },
        { virtualPaneId: "root.1.0", name: "nested", focus: true },
      ],
    }

    await createHerdrBackend(context()).applyPlan({ emission: nestedFocus, windowMode: "new-window" })

    expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({ focus: true }))
  })

  it("rejects ratios that herdr would silently clamp", async () => {
    await expect(
      createHerdrBackend(context()).applyPlan({ emission: splitEmission(95), windowMode: "new-window" }),
    ).rejects.toMatchObject({
      code: "SPLIT_SIZE_RESOLUTION_FAILED",
      message: "Herdr requires both sides of a split to occupy at least 10%",
    })
    expect(mocks.split).not.toHaveBeenCalled()
  })

  it("renders herdr dry-run commands", () => {
    const steps = createHerdrBackend(context({ dryRun: true })).getDryRunSteps(splitEmission(35))
    expect(steps).toEqual([
      {
        backend: "herdr",
        summary: "split root (-h)",
        command: "herdr pane split root --direction right --ratio 0.65 --focus",
      },
      {
        backend: "herdr",
        summary: "select pane root.1",
        command: "# herdr focus for root.1 is selected during pane creation",
      },
    ])
  })
})
