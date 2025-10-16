import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("execa", () => ({
  execa: vi.fn(),
}))

import { execa } from "execa"
import { listWeztermWindows, runWeztermCli } from "../cli.ts"

const execaMock = vi.mocked(execa)

describe("runWeztermCli", () => {
  beforeEach(() => {
    execaMock.mockReset()
  })

  it("executes wezterm cli and returns stdout", async () => {
    execaMock.mockResolvedValue({ stdout: "ok" } as unknown as { stdout: string })

    const result = await runWeztermCli(["list"], { message: "List windows" })

    expect(result).toBe("ok")
    expect(execaMock).toHaveBeenCalledWith("wezterm", ["cli", "list"])
  })

  it("wraps errors with backend details", async () => {
    execaMock.mockRejectedValue({ exitCode: 2, stderr: "boom" })

    await expect(
      runWeztermCli(["split-pane"], {
        message: "Split failed",
        path: "root",
        details: { hint: "check config" },
      }),
    ).rejects.toMatchObject({
      code: "TERMINAL_COMMAND_FAILED",
      message: "Split failed",
      path: "root",
      details: {
        backend: "wezterm",
        command: ["wezterm", "cli", "split-pane"],
        stderr: "boom",
        exitCode: 2,
        hint: "check config",
      },
    })
  })

  it("parses array-based list output into windows and panes", async () => {
    const listResponse = JSON.stringify([
      { window_id: 5, tab_id: 7, pane_id: 10, is_active: true },
      { window_id: 5, tab_id: 7, pane_id: 11, is_active: false },
      { window_id: 5, tab_id: 8, pane_id: 12, is_active: false },
      { window_id: 6, tab_id: 9, pane_id: 13, is_active: true },
    ])
    execaMock.mockResolvedValueOnce({ stdout: listResponse } as unknown as { stdout: string })

    const result = await listWeztermWindows()

    expect(result.windows).toEqual([
      {
        windowId: "5",
        isActive: true,
        workspace: undefined,
        tabs: [
          {
            tabId: "7",
            isActive: true,
            panes: [
              { paneId: "10", isActive: true },
              { paneId: "11", isActive: false },
            ],
          },
          {
            tabId: "8",
            isActive: false,
            panes: [{ paneId: "12", isActive: false }],
          },
        ],
      },
      {
        windowId: "6",
        isActive: true,
        workspace: undefined,
        tabs: [
          {
            tabId: "9",
            isActive: true,
            panes: [{ paneId: "13", isActive: true }],
          },
        ],
      },
    ])
  })
})
