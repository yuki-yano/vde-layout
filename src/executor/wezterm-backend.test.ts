import { beforeEach, describe, expect, it, vi } from "vitest"

import { createWeztermBackend } from "../backends/wezterm/backend"
import type { WeztermTerminalBackendContext } from "./terminal-backend"
import type { Logger } from "../utils/logger"
import { LogLevel } from "../utils/logger"
import type { PlanEmission } from "../core/emitter"
import type { WeztermListResult } from "../backends/wezterm/cli"

const { verifyMock, listMock, killMock, runMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  listMock: vi.fn(),
  killMock: vi.fn(),
  runMock: vi.fn(),
}))

vi.mock("../backends/wezterm/cli", () => ({
  verifyWeztermAvailability: verifyMock,
  listWeztermWindows: listMock,
  killWeztermPane: killMock,
  runWeztermCli: runMock,
}))

const queueListResponses = (...responses: ReadonlyArray<WeztermListResult>): void => {
  const queue = [...responses]
  listMock.mockImplementation(() => {
    if (queue.length === 0) {
      return Promise.resolve({ windows: [] })
    }
    return Promise.resolve(queue.shift()!)
  })
}

const makeList = (
  windows: ReadonlyArray<{
    windowId: string
    workspace?: string
    panes: ReadonlyArray<{ paneId: string; active?: boolean }>
  }>,
): WeztermListResult => {
  return {
    windows: windows.map((window, index) => ({
      windowId: window.windowId,
      isActive: index === 0,
      workspace: window.workspace,
      tabs: [
        {
          tabId: `${window.windowId}-tab`,
          isActive: true,
          panes: window.panes.map((pane) => ({
            paneId: pane.paneId,
            isActive: pane.active === true,
          })),
        },
      ],
    })),
  }
}

const createMockLogger = (): Logger => {
  const logger: Logger = {
    level: LogLevel.INFO,
    prefix: "",
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    createChild: vi.fn((): Logger => logger),
  }
  return logger
}

const createContext = (overrides: Partial<WeztermTerminalBackendContext> = {}): WeztermTerminalBackendContext => ({
  logger: createMockLogger(),
  dryRun: false,
  verbose: false,
  prompt: undefined,
  cwd: "/workspace",
  paneId: undefined,
  ...overrides,
})

const minimalEmission = (): PlanEmission => ({
  steps: [],
  summary: {
    stepsCount: 0,
    focusPaneId: "root",
    initialPaneId: "root",
  },
  terminals: [],
  hash: "hash",
})

describe("createWeztermBackend", () => {
  beforeEach(() => {
    verifyMock.mockReset()
    listMock.mockReset()
    killMock.mockReset()
    runMock.mockReset()
  })

  it("verifies environment when not in dry-run mode", async () => {
    verifyMock.mockResolvedValue({ version: "20240420-000000-deadbeef" })
    const backend = createWeztermBackend(createContext())
    await backend.verifyEnvironment()
    expect(verifyMock).toHaveBeenCalledTimes(1)
  })

  it("skips environment verification during dry-run", async () => {
    const backend = createWeztermBackend(createContext({ dryRun: true }))
    await backend.verifyEnvironment()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it("uses structured split metadata for dry-run output when available", () => {
    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      ...minimalEmission(),
      steps: [
        {
          id: "root:split:1",
          kind: "split",
          summary: "split root",
          command: ["split-window", "-h", "-t", "root", "-p", "99"],
          targetPaneId: "root",
          createdPaneId: "root.1",
          orientation: "vertical",
          percentage: 35,
        },
        {
          id: "root:focus",
          kind: "focus",
          summary: "focus root.1",
          command: ["select-pane", "-t", "root.1"],
          targetPaneId: "root.1",
        },
      ],
      summary: { stepsCount: 2, focusPaneId: "root.1", initialPaneId: "root" },
    }

    expect(backend.getDryRunSteps(emission)[0]).toEqual({
      backend: "wezterm",
      summary: "split root",
      command: "wezterm cli split-pane --bottom --percent 35 --pane-id root",
    })
  })

  it("defaults legacy split commands without direction flag to bottom in dry-run", () => {
    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      ...minimalEmission(),
      steps: [
        {
          id: "root:split:1",
          kind: "split",
          summary: "split root",
          command: ["split-window", "-t", "root", "-p", "40"],
          targetPaneId: "root",
          createdPaneId: "root.1",
        },
      ],
      summary: { stepsCount: 1, focusPaneId: "root", initialPaneId: "root" },
    }

    expect(backend.getDryRunSteps(emission)[0]).toEqual({
      backend: "wezterm",
      summary: "split root",
      command: "wezterm cli split-pane --bottom --percent 40 --pane-id root",
    })
  })

  it("spawns a new tab when a wezterm window exists", async () => {
    queueListResponses(
      makeList([{ windowId: "7", panes: [{ paneId: "10", active: true }] }]),
      makeList([{ windowId: "7", panes: [{ paneId: "10", active: true }, { paneId: "42" }] }]),
    )
    runMock.mockResolvedValueOnce("42 7\n")

    const backend = createWeztermBackend(createContext())
    const emission = minimalEmission()
    const result = await backend.applyPlan({ emission, windowMode: "new-window" })

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      ["spawn", "--window-id", "7", "--cwd", "/workspace"],
      expect.objectContaining({ message: "Failed to spawn wezterm tab" }),
    )
    expect(result.focusPaneId).toBe("42")
  })

  it("targets the workspace of the current pane when multiple workspaces exist", async () => {
    queueListResponses(
      makeList([
        { windowId: "w-main", workspace: "main", panes: [{ paneId: "1", active: true }] },
        { windowId: "w-dev", workspace: "dev", panes: [{ paneId: "20", active: true }] },
      ]),
      makeList([
        { windowId: "w-main", workspace: "main", panes: [{ paneId: "1", active: true }] },
        { windowId: "w-dev", workspace: "dev", panes: [{ paneId: "20", active: true }, { paneId: "42" }] },
      ]),
    )
    runMock.mockResolvedValueOnce("42 w-dev\n")

    const backend = createWeztermBackend(createContext({ paneId: "20" }))
    const emission = minimalEmission()
    const result = await backend.applyPlan({ emission, windowMode: "new-window" })

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      ["spawn", "--window-id", "w-dev", "--cwd", "/workspace"],
      expect.objectContaining({ message: "Failed to spawn wezterm tab" }),
    )
    expect(result.focusPaneId).toBe("42")
  })

  it("prefers terminal cwd when spawning the initial tab", async () => {
    queueListResponses(
      makeList([{ windowId: "7", panes: [{ paneId: "10", active: true }] }]),
      makeList([{ windowId: "7", panes: [{ paneId: "10", active: true }, { paneId: "42" }] }]),
    )
    runMock.mockResolvedValueOnce("42 7\n")

    const backend = createWeztermBackend(createContext({ cwd: "/fallback" }))
    const emission: PlanEmission = {
      ...minimalEmission(),
      terminals: [
        {
          virtualPaneId: "root",
          command: undefined,
          cwd: "/project/app",
          env: undefined,
          focus: true,
          name: "root",
        },
      ],
    }

    await backend.applyPlan({ emission, windowMode: "new-window" })

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      ["spawn", "--window-id", "7", "--cwd", "/project/app"],
      expect.objectContaining({ message: "Failed to spawn wezterm tab" }),
    )
  })

  it("falls back to new window when no windows exist", async () => {
    queueListResponses({ windows: [] }, makeList([{ windowId: "9", panes: [{ paneId: "21" }] }]))
    runMock.mockResolvedValueOnce("21\n")

    const backend = createWeztermBackend(createContext())
    const emission = minimalEmission()
    const result = await backend.applyPlan({ emission, windowMode: "new-window" })

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      ["spawn", "--new-window", "--cwd", "/workspace"],
      expect.objectContaining({ message: "Failed to spawn wezterm window" }),
    )
    expect(result.focusPaneId).toBe("21")
  })

  it("resolves current window and closes extra panes when confirmed", async () => {
    queueListResponses(
      makeList([
        {
          windowId: "1",
          panes: [{ paneId: "A", active: true }, { paneId: "B" }],
        },
      ]),
    )
    runMock.mockResolvedValue("")
    killMock.mockResolvedValue(undefined)
    const prompt = vi.fn(async () => true)

    const backend = createWeztermBackend(createContext({ prompt }))
    const emission = minimalEmission()
    const result = await backend.applyPlan({ emission, windowMode: "current-window" })

    expect(prompt).toHaveBeenCalledWith({ panesToClose: ["B"], dryRun: false })
    expect(killMock).toHaveBeenCalledWith("B")
    expect(result.focusPaneId).toBe("A")
  })

  it("uses paneId to resolve the current window when it is not active", async () => {
    queueListResponses(
      makeList([
        {
          windowId: "w-main",
          panes: [{ paneId: "main", active: true }, { paneId: "main-extra" }],
        },
        {
          windowId: "w-dev",
          panes: [{ paneId: "pane-dev" }, { paneId: "dev-extra" }],
        },
      ]),
    )
    killMock.mockResolvedValue(undefined)
    const prompt = vi.fn(async () => true)

    const backend = createWeztermBackend(createContext({ paneId: "pane-dev", prompt }))
    const emission = minimalEmission()
    const result = await backend.applyPlan({ emission, windowMode: "current-window" })

    expect(prompt).toHaveBeenCalledWith({ panesToClose: ["dev-extra"], dryRun: false })
    expect(killMock).toHaveBeenCalledWith("dev-extra")
    expect(killMock).not.toHaveBeenCalledWith("main-extra")
    expect(result.focusPaneId).toBe("pane-dev")
  })

  it("aborts when pane closure is rejected", async () => {
    queueListResponses(
      makeList([
        {
          windowId: "1",
          panes: [{ paneId: "A", active: true }, { paneId: "B" }],
        },
      ]),
    )
    const prompt = vi.fn(async () => false)
    const backend = createWeztermBackend(createContext({ prompt }))
    await expect(
      backend.applyPlan({ emission: minimalEmission(), windowMode: "current-window" }),
    ).rejects.toMatchObject({
      code: "USER_CANCELLED",
    })
    expect(killMock).not.toHaveBeenCalled()
  })

  it("executes split steps and registers new panes", async () => {
    queueListResponses(
      makeList([{ windowId: "w1", panes: [{ paneId: "10", active: true }] }]),
      makeList([{ windowId: "w1", panes: [{ paneId: "10", active: true }, { paneId: "100" }] }]),
      makeList([{ windowId: "w1", panes: [{ paneId: "10", active: true }, { paneId: "100" }] }]),
      makeList([{ windowId: "w1", panes: [{ paneId: "10", active: false }, { paneId: "100" }, { paneId: "101" }] }]),
    )
    runMock.mockResolvedValueOnce("100 w1\n")
    runMock.mockResolvedValue("ok")

    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      steps: [
        {
          id: "root:split:1",
          kind: "split",
          summary: "split root",
          command: ["split-window", "-h", "-t", "root", "-p", "60"],
          targetPaneId: "root",
          createdPaneId: "root.1",
        },
        {
          id: "root:focus",
          kind: "focus",
          summary: "focus new",
          command: ["select-pane", "-t", "root.1"],
          targetPaneId: "root.1",
        },
      ],
      summary: { stepsCount: 2, focusPaneId: "root.1", initialPaneId: "root" },
      terminals: [],
      hash: "hash",
    }

    const result = await backend.applyPlan({ emission, windowMode: "new-window" })

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      ["spawn", "--window-id", "w1", "--cwd", "/workspace"],
      expect.objectContaining({ message: "Failed to spawn wezterm tab" }),
    )
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      ["split-pane", "--right", "--percent", "60", "--pane-id", "100"],
      expect.objectContaining({ message: expect.stringContaining("split step") }),
    )
    expect(runMock).toHaveBeenNthCalledWith(
      3,
      ["activate-pane", "--pane-id", "101"],
      expect.objectContaining({ message: expect.stringContaining("focus step") }),
    )
    expect(result.executedSteps).toBe(2)
    expect(result.focusPaneId).toBe("101")
  })

  it("applies terminal commands for cwd, env and command execution", async () => {
    queueListResponses(
      makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }] }]),
      makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }, { paneId: "200" }] }]),
    )
    runMock.mockResolvedValueOnce("200 win\n")
    runMock.mockResolvedValue("")

    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      ...minimalEmission(),
      terminals: [
        {
          virtualPaneId: "root",
          cwd: "/workspace/project",
          env: { NODE_ENV: "production" },
          command: "npm start",
          focus: true,
          name: "dev",
        },
      ],
    }

    const result = await backend.applyPlan({ emission, windowMode: "new-window" })

    expect(runMock).toHaveBeenNthCalledWith(
      1,
      ["spawn", "--window-id", "win", "--cwd", "/workspace/project"],
      expect.objectContaining({ message: "Failed to spawn wezterm tab" }),
    )
    expect(runMock).toHaveBeenNthCalledWith(
      2,
      ["send-text", "--pane-id", "200", "--no-paste", "--", "cd -- '/workspace/project'\r"],
      expect.objectContaining({ message: expect.stringContaining("change directory") }),
    )
    expect(runMock).toHaveBeenNthCalledWith(
      3,
      ["send-text", "--pane-id", "200", "--no-paste", "--", "export NODE_ENV='production'\r"],
      expect.objectContaining({ message: expect.stringContaining("set environment variable") }),
    )
    expect(runMock).toHaveBeenNthCalledWith(
      4,
      ["send-text", "--pane-id", "200", "--no-paste", "--", "npm start\r"],
      expect.objectContaining({ message: expect.stringContaining("execute command") }),
    )
    expect(result.focusPaneId).toBe("200")
  })

  it("waits for delay before sending terminal command", async () => {
    vi.useFakeTimers()
    try {
      queueListResponses(
        makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }] }]),
        makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }, { paneId: "200" }] }]),
      )
      runMock.mockResolvedValueOnce("200 win\n")
      runMock.mockResolvedValue("")

      const backend = createWeztermBackend(createContext())
      const emission: PlanEmission = {
        ...minimalEmission(),
        terminals: [
          {
            virtualPaneId: "root",
            cwd: undefined,
            env: undefined,
            command: "npm start",
            focus: true,
            name: "dev",
            delay: 300,
          },
        ],
      }

      const execution = backend.applyPlan({ emission, windowMode: "new-window" })

      await vi.advanceTimersByTimeAsync(299)
      expect(runMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await execution

      expect(runMock).toHaveBeenNthCalledWith(
        2,
        ["send-text", "--pane-id", "200", "--no-paste", "--", "npm start\r"],
        expect.objectContaining({ message: expect.stringContaining("execute command") }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("throws when focus pane cannot be resolved even if {{focus_pane}} is not used", async () => {
    queueListResponses(
      makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }] }]),
      makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }, { paneId: "200" }] }]),
    )
    runMock.mockResolvedValueOnce("200 win\n")

    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      ...minimalEmission(),
      summary: { ...minimalEmission().summary, focusPaneId: "root.missing" },
      terminals: [
        {
          virtualPaneId: "root",
          cwd: undefined,
          env: undefined,
          command: "echo hello",
          focus: true,
          name: "root",
        },
      ],
    }

    await expect(backend.applyPlan({ emission, windowMode: "new-window" })).rejects.toMatchObject({
      code: "INVALID_PANE",
      path: "root.missing",
    })
  })

  it("throws when focus pane cannot be resolved and {{focus_pane}} is used", async () => {
    queueListResponses(
      makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }] }]),
      makeList([{ windowId: "win", panes: [{ paneId: "5", active: true }, { paneId: "200" }] }]),
    )
    runMock.mockResolvedValueOnce("200 win\n")

    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      ...minimalEmission(),
      summary: { ...minimalEmission().summary, focusPaneId: "root.unknown" },
      terminals: [
        {
          virtualPaneId: "root",
          cwd: undefined,
          env: undefined,
          command: "echo {{focus_pane}}",
          focus: true,
          name: "root",
        },
      ],
    }

    await expect(backend.applyPlan({ emission, windowMode: "new-window" })).rejects.toMatchObject({
      code: "INVALID_PANE",
      path: "root.unknown",
    })
  })

  it("produces dry-run steps for splits, focus, and terminal commands", () => {
    const backend = createWeztermBackend(createContext())
    const emission: PlanEmission = {
      steps: [
        {
          id: "root:split:1",
          kind: "split",
          summary: "split root",
          command: ["split-window", "-h", "-t", "root", "-p", "60"],
          targetPaneId: "root",
          createdPaneId: "root:1",
        },
        {
          id: "root:focus",
          kind: "focus",
          summary: "focus root:1",
          command: ["select-pane", "-t", "root:1"],
          targetPaneId: "root:1",
        },
      ],
      summary: {
        stepsCount: 2,
        focusPaneId: "root:1",
        initialPaneId: "root",
      },
      terminals: [
        {
          virtualPaneId: "root:1",
          cwd: '/tmp/"workspace"',
          env: { NODE_ENV: "test" },
          command: "npm test",
          focus: true,
          name: "runner",
        },
      ],
      hash: "hash",
    }

    const steps = backend.getDryRunSteps(emission)

    expect(steps).toEqual([
      {
        backend: "wezterm",
        summary: "split root",
        command: "wezterm cli split-pane --right --percent 60 --pane-id root",
      },
      {
        backend: "wezterm",
        summary: "focus root:1",
        command: "wezterm cli activate-pane --pane-id root:1",
      },
      {
        backend: "wezterm",
        summary: "set cwd for root:1",
        command: "wezterm cli send-text --pane-id root:1 --no-paste -- 'cd -- '\"'\"'/tmp/\"workspace\"'\"'\"''",
      },
      {
        backend: "wezterm",
        summary: "set env NODE_ENV for root:1",
        command: "wezterm cli send-text --pane-id root:1 --no-paste -- 'export NODE_ENV='\"'\"'test'\"'\"''",
      },
      {
        backend: "wezterm",
        summary: "run command for root:1",
        command: "wezterm cli send-text --pane-id root:1 --no-paste -- 'npm test'",
      },
    ])
  })
})
