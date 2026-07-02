import { describe, expect, it } from "vitest"
import { createMockExecutor } from "./mock-executor"

describe("createMockExecutor protected panes", () => {
  it("reports pane user option values via the sidebar list-panes format", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0", "%1", "%2"])
    executor.setMockProtectedPaneIds(["%1"])

    const output = await executor.execute(["list-panes", "-F", "#{pane_id}\t#{@vde_sidebar}"])

    expect(output).toBe("%0\t\n%1\t1\n%2\t")
  })

  it("keeps protected panes alive when kill-pane -a targets another pane", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0", "%1", "%2"])
    executor.setMockProtectedPaneIds(["%1"])

    await executor.execute(["kill-pane", "-a", "-t", "%0"])

    expect(executor.getPaneIds()).toEqual(["%0", "%1"])
  })

  it("still collapses to the target pane when no panes are protected", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%0", "%1", "%2"])

    await executor.execute(["kill-pane", "-a", "-t", "%0"])

    expect(executor.getPaneIds()).toEqual(["%0"])
  })
})
