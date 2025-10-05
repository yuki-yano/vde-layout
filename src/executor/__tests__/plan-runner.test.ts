import { describe, expect, it, vi } from "vitest"
import { executePlan } from "../plan-runner.ts"
import type { PlanEmission } from "../../core/index.ts"
import { createMockExecutor } from "../mock-executor.ts"

const emission: PlanEmission = {
  steps: [
    {
      id: "root:split:1",
      kind: "split",
      command: ["split-window", "-h", "-t", "root.0", "-p", "50"],
      summary: "split root.0 (-h)",
      targetPaneId: "root.0",
      createdPaneId: "root.1",
    },
    {
      id: "root.0:focus",
      kind: "focus",
      command: ["select-pane", "-t", "root.0"],
      summary: "select pane root.0",
      targetPaneId: "root.0",
    },
  ],
  hash: "hash",
  summary: {
    focusPaneId: "root.0",
    stepsCount: 2,
    initialPaneId: "root.0",
  },
}

describe("executePlan", () => {
  it("executes all steps with the provided executor", async () => {
    const executor = createMockExecutor()
    const result = await executePlan({ emission, executor })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }

    expect(result.value.executedSteps).toBe(2)
    expect(executor.getExecutedCommands()).toEqual([
      ["display-message", "-p", "#{pane_id}"],
      ["list-panes", "-F", "#{pane_id}"],
      ["split-window", "-h", "-t", "%0", "-p", "50"],
      ["list-panes", "-F", "#{pane_id}"],
      ["select-pane", "-t", "%0"],
    ])
  })

  it("stops on failure and returns StructuredError", async () => {
    const executor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce("%0") // display-message
        .mockResolvedValueOnce("%0") // list-panes before split
        .mockRejectedValueOnce(new Error("tmux failed")), // split-window
      executeMany: vi.fn(),
      isDryRun: () => false,
      logCommand: vi.fn(),
    }

    const result = await executePlan({ emission, executor })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected failure")
    }

    expect(result.error.path).toBe("root:split:1")
    expect(result.error.code).toBe("TMUX_COMMAND_FAILED")
    expect(result.error.details?.command).toEqual(["split-window", "-h", "-t", "root.0", "-p", "50"])
  })
})
