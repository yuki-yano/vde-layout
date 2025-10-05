import { describe, expect, it, vi } from "vitest"
import { executePlan } from "../plan-runner.ts"
import type { PlanEmission } from "../../core/index.ts"
import { createMockExecutor } from "../mock-executor.ts"

const baseEmission: PlanEmission = {
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
  terminals: [
    {
      virtualPaneId: "root.0",
      command: "nvim",
      cwd: "/workspace",
      env: { NODE_ENV: "test" },
      focus: true,
      name: "main",
    },
    {
      virtualPaneId: "root.1",
      command: "npm run dev",
      cwd: undefined,
      env: undefined,
      focus: false,
      name: "aux",
    },
  ],
}

describe("executePlan", () => {
  it("executes all steps with the provided executor", async () => {
    const executor = createMockExecutor()
    const result = await executePlan({ emission: baseEmission, executor })

    expect(result.executedSteps).toBe(2)
    expect(executor.getExecutedCommands()).toEqual([
      ["new-window", "-P", "-F", "#{pane_id}"],
      ["list-panes", "-F", "#{pane_id}"],
      ["split-window", "-h", "-t", "%0", "-p", "50"],
      ["list-panes", "-F", "#{pane_id}"],
      ["select-pane", "-t", "%0"],
      ["send-keys", "-t", "%0", 'cd "/workspace"', "Enter"],
      ["send-keys", "-t", "%0", 'export NODE_ENV="test"', "Enter"],
      ["send-keys", "-t", "%0", "nvim", "Enter"],
      ["send-keys", "-t", "%1", "npm run dev", "Enter"],
      ["select-pane", "-t", "%0"],
    ])
  })

  it("creates new tmux window with provided name", async () => {
    const executor = createMockExecutor()
    await executePlan({ emission: baseEmission, executor, windowName: "dev layout" })

    const commands = executor.getExecutedCommands()
    expect(commands[0]).toEqual(["new-window", "-P", "-F", "#{pane_id}", "-n", "dev layout"])
  })

  it("throws FunctionalCoreError when tmux command fails", async () => {
    const executor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce("%0")
        .mockResolvedValueOnce("%0")
        .mockRejectedValueOnce(new Error("tmux failed")),
      executeMany: vi.fn(),
      isDryRun: () => false,
      logCommand: vi.fn(),
    }

    await expect(executePlan({ emission: baseEmission, executor })).rejects.toThrowError(/Failed to execute split step/)
  })

  it("supports resolving ancestor and descendant virtual pane identifiers", async () => {
    const nestedEmission: PlanEmission = {
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
          id: "root.1:split:1",
          kind: "split",
          command: ["split-window", "-v", "-t", "root.1.0", "-p", "50"],
          summary: "split root.1.0 (-v)",
          targetPaneId: "root.1.0",
          createdPaneId: "root.1.1",
        },
        {
          id: "root.1.1:focus",
          kind: "focus",
          command: ["select-pane", "-t", "root.1.1"],
          summary: "select pane root.1.1",
          targetPaneId: "root.1.1",
        },
      ],
      hash: "hash",
      summary: {
        focusPaneId: "root.1.1",
        stepsCount: 3,
        initialPaneId: "root.0",
      },
      terminals: [
        {
          virtualPaneId: "root.0",
          command: undefined,
          cwd: undefined,
          env: undefined,
          focus: false,
          name: "root",
        },
        {
          virtualPaneId: "root.1.1",
          command: "htop",
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "monitor",
        },
      ],
    }

    const executor = createMockExecutor()
    const result = await executePlan({ emission: nestedEmission, executor })

    expect(result.executedSteps).toBe(3)
    expect(executor.getExecutedCommands()).toEqual([
      ["new-window", "-P", "-F", "#{pane_id}"],
      ["list-panes", "-F", "#{pane_id}"],
      ["split-window", "-h", "-t", "%0", "-p", "50"],
      ["list-panes", "-F", "#{pane_id}"],
      ["list-panes", "-F", "#{pane_id}"],
      ["split-window", "-v", "-t", "%1", "-p", "50"],
      ["list-panes", "-F", "#{pane_id}"],
      ["select-pane", "-t", "%2"],
      ["send-keys", "-t", "%2", "htop", "Enter"],
      ["select-pane", "-t", "%2"],
    ])
  })
})
