import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("execa", () => ({
  execa: vi.fn(),
}))

import { execa } from "execa"
import { killWeztermPane, listWeztermWindows, runWeztermCli, verifyWeztermAvailability } from "../cli.ts"

const execaMock = vi.mocked(execa)

const mockExecaSuccess = (stdout: string): Awaited<ReturnType<typeof execa>> => {
  return { stdout } as Awaited<ReturnType<typeof execa>>
}

describe("runWeztermCli", () => {
  beforeEach(() => {
    execaMock.mockReset()
  })

  it("executes wezterm cli and returns stdout", async () => {
    execaMock.mockResolvedValue(mockExecaSuccess("ok"))

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
    execaMock.mockResolvedValueOnce(mockExecaSuccess(listResponse))

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

  it("parses object-based list output into windows, tabs, and panes", async () => {
    const listResponse = JSON.stringify({
      windows: [
        {
          window_id: "w1",
          is_active: true,
          workspace: "dev",
          tabs: [
            {
              tab_id: "tab-1",
              is_active: true,
              panes: [
                { pane_id: "10", is_active: true },
                { pane_id: null, is_active: false },
              ],
            },
            {
              tab_id: null,
              panes: [{ pane_id: "20" }],
            },
          ],
        },
        {
          window_id: null,
          tabs: [],
        },
      ],
    })
    execaMock.mockResolvedValueOnce(mockExecaSuccess(listResponse))

    const result = await listWeztermWindows()

    expect(result.windows).toEqual([
      {
        windowId: "w1",
        isActive: true,
        workspace: "dev",
        tabs: [
          {
            tabId: "tab-1",
            isActive: true,
            panes: [{ paneId: "10", isActive: true }],
          },
        ],
      },
    ])
  })

  it("uses window_id as tab fallback and carries workspace from later entries", async () => {
    const listResponse = JSON.stringify([
      { window_id: "w1", pane_id: "10", is_active: false },
      { window_id: "w1", pane_id: "11", tab_id: "tab-2", workspace: "dev", is_active: true },
    ])
    execaMock.mockResolvedValueOnce(mockExecaSuccess(listResponse))

    const result = await listWeztermWindows()

    expect(result.windows).toEqual([
      {
        windowId: "w1",
        isActive: true,
        workspace: "dev",
        tabs: [
          {
            tabId: "w1",
            isActive: false,
            panes: [{ paneId: "10", isActive: false }],
          },
          {
            tabId: "tab-2",
            isActive: true,
            panes: [{ paneId: "11", isActive: true }],
          },
        ],
      },
    ])
  })

  it("throws structured error when list output is invalid json", async () => {
    execaMock.mockResolvedValueOnce(mockExecaSuccess("not-json"))

    await expect(listWeztermWindows()).rejects.toMatchObject({
      code: "TERMINAL_COMMAND_FAILED",
      message: "Invalid wezterm list output",
    })
  })

  it("kills a pane via wezterm cli", async () => {
    execaMock.mockResolvedValueOnce(mockExecaSuccess(""))

    await killWeztermPane("pane-1")

    expect(execaMock).toHaveBeenCalledWith("wezterm", ["cli", "kill-pane", "--pane-id", "pane-1"])
  })
})

describe("verifyWeztermAvailability", () => {
  beforeEach(() => {
    execaMock.mockReset()
  })

  it("returns normalized version when wezterm is available", async () => {
    execaMock.mockResolvedValueOnce(mockExecaSuccess("wezterm 20240908-123456-DEADBEEF"))

    const result = await verifyWeztermAvailability()

    expect(result.version).toBe("20240908-123456-deadbeef")
    expect(execaMock).toHaveBeenCalledWith("wezterm", ["--version"])
  })

  it("throws backend-not-found error when wezterm binary is missing", async () => {
    execaMock.mockRejectedValueOnce({ code: "ENOENT" })

    await expect(verifyWeztermAvailability()).rejects.toMatchObject({
      code: "BACKEND_NOT_FOUND",
      details: { backend: "wezterm", binary: "wezterm" },
    })
  })

  it("throws version detection error when version cannot be parsed", async () => {
    execaMock.mockResolvedValueOnce(mockExecaSuccess("wezterm unknown-version"))

    await expect(verifyWeztermAvailability()).rejects.toMatchObject({
      code: "UNSUPPORTED_WEZTERM_VERSION",
      message: "Unable to determine wezterm version",
    })
  })

  it("throws unsupported-version error when version is too old", async () => {
    execaMock.mockResolvedValueOnce(mockExecaSuccess("wezterm 20210101-000000-deadbeef"))

    await expect(verifyWeztermAvailability()).rejects.toMatchObject({
      code: "UNSUPPORTED_WEZTERM_VERSION",
      message: "Unsupported wezterm version",
    })
  })

  it("throws execution error when wezterm --version fails", async () => {
    execaMock.mockRejectedValueOnce({ stderr: "permission denied" })

    await expect(verifyWeztermAvailability()).rejects.toMatchObject({
      code: "WEZTERM_NOT_FOUND",
      message: "Failed to execute wezterm --version",
      details: { stderr: "permission denied" },
    })
  })
})
