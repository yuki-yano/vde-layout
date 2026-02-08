import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("execa", () => ({
  execa: vi.fn(),
}))

import { execa } from "execa"
import { createRealExecutor } from "../real-executor"
import { ErrorCodes } from "../../utils/errors"

const execaMock = vi.mocked(execa)

describe("createRealExecutor", () => {
  beforeEach(() => {
    execaMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("executes parsed tmux commands and returns stdout", async () => {
    execaMock.mockResolvedValue({ stdout: "ok" } as never)
    const executor = createRealExecutor()

    const stdout = await executor.execute("tmux list-panes")

    expect(stdout).toBe("ok")
    expect(execaMock).toHaveBeenCalledWith("tmux", ["list-panes"])
  })

  it("supports array commands and executeMany", async () => {
    execaMock.mockResolvedValue({ stdout: "" } as never)
    const executor = createRealExecutor()

    await executor.executeMany([["list-panes"], ["display-message", "-p", "#{pane_id}"]])

    expect(execaMock).toHaveBeenNthCalledWith(1, "tmux", ["list-panes"])
    expect(execaMock).toHaveBeenNthCalledWith(2, "tmux", ["display-message", "-p", "#{pane_id}"])
  })

  it("wraps execa errors with tmux command metadata", async () => {
    execaMock.mockRejectedValue({
      exitCode: 1,
      stderr: "boom",
      message: "tmux failed",
    })
    const executor = createRealExecutor()

    await expect(executor.execute(["list-panes"])).rejects.toMatchObject({
      code: ErrorCodes.TMUX_COMMAND_FAILED,
      message: "Failed to execute tmux command",
      details: {
        command: "tmux list-panes",
        exitCode: 1,
        stderr: "boom",
      },
    })
  })

  it("reports non-dry-run behavior and logs commands when verbose", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const executor = createRealExecutor({ verbose: true })

    expect(executor.isDryRun()).toBe(false)
    executor.logCommand("tmux list-panes")

    expect(logSpy).toHaveBeenCalledWith("[tmux] Executing: tmux list-panes")
  })
})
