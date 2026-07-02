import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("execa", () => ({
  execa: vi.fn(),
}))

import { execa } from "execa"
import { createDefaultRunHostCommand, runAfterApplyHook } from "./after-apply-hook"
import type { Logger } from "../utils/logger"
import { LogLevel } from "../utils/logger"

const execaMock = vi.mocked(execa)

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

describe("runAfterApplyHook", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does nothing when no hook command is configured", async () => {
    const logger = createMockLogger()
    const runHostCommand = vi.fn(async () => {})

    await runAfterApplyHook({
      hookCommand: undefined,
      context: { cwd: "/workspace" },
      logger,
      runHostCommand,
    })

    expect(runHostCommand).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("resolves {{pane_id:<name>}} tokens before running the host command once", async () => {
    const logger = createMockLogger()
    const runHostCommand = vi.fn(async () => {})

    await runAfterApplyHook({
      hookCommand: "vde-tmux-sidebar open {{pane_id:sidebar}}",
      context: {
        cwd: "/workspace",
        focusPaneId: "%0",
        paneNameToRealId: new Map([["sidebar", "%2"]]),
      },
      logger,
      runHostCommand,
    })

    expect(runHostCommand).toHaveBeenCalledTimes(1)
    expect(runHostCommand).toHaveBeenCalledWith("vde-tmux-sidebar open %2", { cwd: "/workspace" })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("resolves {{focus_pane}} and {{this_pane}} to the applied focus pane id", async () => {
    const logger = createMockLogger()
    const runHostCommand = vi.fn(async () => {})

    await runAfterApplyHook({
      hookCommand: "notify-focus {{focus_pane}} {{this_pane}}",
      context: { cwd: "/workspace", focusPaneId: "%1" },
      logger,
      runHostCommand,
    })

    expect(runHostCommand).toHaveBeenCalledWith("notify-focus %1 %1", { cwd: "/workspace" })
  })

  it("warns and skips execution when a template token cannot be resolved", async () => {
    const logger = createMockLogger()
    const runHostCommand = vi.fn(async () => {})

    await runAfterApplyHook({
      hookCommand: "vde-tmux-sidebar open {{pane_id:missing}}",
      context: { cwd: "/workspace", paneNameToRealId: new Map() },
      logger,
      runHostCommand,
    })

    expect(runHostCommand).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("missing"))
  })

  it("warns but does not throw when the host command fails", async () => {
    const logger = createMockLogger()
    const runHostCommand = vi.fn(async () => {
      throw new Error("command not found: vde-tmux-sidebar")
    })

    await expect(
      runAfterApplyHook({
        hookCommand: "vde-tmux-sidebar open",
        context: { cwd: "/workspace" },
        logger,
        runHostCommand,
      }),
    ).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("command not found: vde-tmux-sidebar"))
  })
})

describe("createDefaultRunHostCommand", () => {
  beforeEach(() => {
    execaMock.mockReset()
  })

  it("runs the command through the host shell so pipes and arguments work", async () => {
    execaMock.mockResolvedValue({ stdout: "" } as never)
    const runHostCommand = createDefaultRunHostCommand()

    await runHostCommand("vde-tmux-sidebar open %2 | logger", { cwd: "/workspace" })

    expect(execaMock).toHaveBeenCalledWith("vde-tmux-sidebar open %2 | logger", {
      shell: true,
      cwd: "/workspace",
    })
  })
})
