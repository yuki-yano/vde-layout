import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("execa", () => ({ execa: vi.fn() }))

import { execa } from "execa"
import { createHerdrTab, splitHerdrPane, verifyHerdrAvailability } from "./cli"

const execaMock = vi.mocked(execa)
const success = (stdout: string): Awaited<ReturnType<typeof execa>> => ({ stdout }) as Awaited<ReturnType<typeof execa>>

describe("herdr cli", () => {
  beforeEach(() => execaMock.mockReset())

  it("accepts herdr 0.7.4 and newer", async () => {
    execaMock.mockResolvedValueOnce(success("herdr 0.7.4"))
    await expect(verifyHerdrAvailability()).resolves.toEqual({ version: "0.7.4" })
    expect(execaMock).toHaveBeenCalledWith("herdr", ["--version"])
  })

  it("rejects older herdr versions", async () => {
    execaMock.mockResolvedValueOnce(success("herdr 0.7.3"))
    await expect(verifyHerdrAvailability()).rejects.toMatchObject({
      code: "UNSUPPORTED_HERDR_VERSION",
      details: { requiredVersion: "0.7.4", detectedVersion: "0.7.3" },
    })
  })

  it("reports a missing herdr binary", async () => {
    execaMock.mockRejectedValueOnce({ code: "ENOENT" })
    await expect(verifyHerdrAvailability()).rejects.toMatchObject({
      code: "BACKEND_NOT_FOUND",
      details: { backend: "herdr", binary: "herdr" },
    })
  })

  it("creates a focused tab and parses its root pane", async () => {
    execaMock.mockResolvedValueOnce(
      success(
        JSON.stringify({
          result: {
            type: "tab_created",
            tab: { tab_id: "tab-2" },
            root_pane: {
              pane_id: "pane-2",
              workspace_id: "ws-1",
              tab_id: "tab-2",
              focused: true,
            },
          },
        }),
      ),
    )

    await expect(createHerdrTab({ workspaceId: "ws-1", cwd: "/repo", label: "Dev" })).resolves.toEqual({
      pane: expect.objectContaining({ pane_id: "pane-2" }),
      tabId: "tab-2",
    })
    expect(execaMock).toHaveBeenCalledWith("herdr", [
      "tab",
      "create",
      "--workspace",
      "ws-1",
      "--cwd",
      "/repo",
      "--label",
      "Dev",
      "--focus",
    ])
  })

  it("splits with the requested first-pane ratio", async () => {
    execaMock.mockResolvedValueOnce(
      success(
        JSON.stringify({
          result: {
            type: "pane_info",
            pane: { pane_id: "pane-2", workspace_id: "ws-1", tab_id: "tab-1", focused: true },
          },
        }),
      ),
    )

    await splitHerdrPane({ paneId: "pane-1", direction: "right", ratio: 0.65, focus: true })
    expect(execaMock).toHaveBeenCalledWith("herdr", [
      "pane",
      "split",
      "pane-1",
      "--direction",
      "right",
      "--ratio",
      "0.65",
      "--focus",
    ])
  })
})
