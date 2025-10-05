import { describe, expect, it, vi } from "vitest"
import { executePlan } from "../plan-runner"
import type { PlanEmission } from "../../functional-core"
import { MockExecutor } from "../mock-executor"

const emission: PlanEmission = {
  steps: [
    {
      id: "root:split:1",
      kind: "split",
      command: ["split-window", "-h", "-t", "root.0", "-p", "50"],
      summary: "split root.0 (-h)",
    },
    {
      id: "root.0:focus",
      kind: "focus",
      command: ["select-pane", "-t", "root.0"],
      summary: "select pane root.0",
    },
  ],
  hash: "hash",
  summary: {
    focusPaneId: "root.0",
    stepsCount: 2,
  },
}

describe("executePlan", () => {
  it("executes all steps with the provided executor", async () => {
    const executor = new MockExecutor()
    const result = await executePlan({ emission, executor })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }

    expect(result.value.executedSteps).toBe(2)
    expect(executor.getExecutedCommands()).toHaveLength(2)
    expect(executor.getExecutedCommands()[0]).toEqual(["split-window", "-h", "-t", "root.0", "-p", "50"])
  })

  it("stops on failure and returns StructuredError", async () => {
    const executor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce("")
        .mockRejectedValueOnce(new Error("tmux failed")),
      executeMany: vi.fn(),
      isDryRun: () => false,
      logCommand: vi.fn(),
    }

    const result = await executePlan({ emission, executor })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected failure")
    }

    expect(result.error.path).toBe("root.0:focus")
    expect(result.error.code).toBe("TMUX_COMMAND_FAILED")
    expect(result.error.details?.command).toEqual(["select-pane", "-t", "root.0"])
  })
})
