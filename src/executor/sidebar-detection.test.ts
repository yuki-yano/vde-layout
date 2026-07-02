import { describe, expect, it } from "vitest"
import { classifyWindowPanes } from "./sidebar-detection"
import { createMockExecutor } from "./mock-executor"
import { ErrorCodes } from "../utils/errors"

describe("classifyWindowPanes", () => {
  it("splits panes into sidebar and normal groups based on the @vde_sidebar pane option", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0", "%1", "%2"])
    executor.setMockProtectedPaneIds(["%1"])

    const result = await classifyWindowPanes(executor, "root.0")

    expect(result).toEqual({
      sidebarPanes: ["%1"],
      normalPanes: ["%0", "%2"],
    })
  })

  it("returns all panes as normal when no pane has the sidebar option set", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0", "%1"])

    const result = await classifyWindowPanes(executor, "root.0")

    expect(result).toEqual({
      sidebarPanes: [],
      normalPanes: ["%0", "%1"],
    })
  })

  it("issues a single list-panes query combining pane id and the sidebar option", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0"])

    await classifyWindowPanes(executor, "root.0")

    expect(executor.getExecutedCommands()).toEqual([["list-panes", "-F", "#{pane_id}\t#{@vde_sidebar}"]])
  })

  it("scopes list-panes to the target pane's window via -t when targetPaneId is provided", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0"])

    await classifyWindowPanes(executor, "root.0", "%3")

    expect(executor.getExecutedCommands()).toEqual([["list-panes", "-t", "%3", "-F", "#{pane_id}\t#{@vde_sidebar}"]])
  })

  it("falls back to the untargeted list-panes query when targetPaneId is an empty string", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0"])

    await classifyWindowPanes(executor, "root.0", "")

    expect(executor.getExecutedCommands()).toEqual([["list-panes", "-F", "#{pane_id}\t#{@vde_sidebar}"]])
  })

  it("throws a TMUX_COMMAND_FAILED CoreError when the executor rejects", async () => {
    const executor = {
      execute: async () => {
        throw new Error("tmux failed")
      },
      executeMany: async () => {},
      isDryRun: () => false,
      logCommand: () => {},
    }

    await expect(classifyWindowPanes(executor, "root.0")).rejects.toMatchObject({
      code: ErrorCodes.TMUX_COMMAND_FAILED,
    })
  })
})
