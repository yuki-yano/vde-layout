import { describe, expect, it, vi } from "vitest"
import { executePlan } from "./plan-runner"
import type { PlanEmission } from "../core/index"
import { createMockExecutor } from "./mock-executor"
import { ErrorCodes } from "../utils/errors"

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

const [baseSplitStep, baseFocusStep] = baseEmission.steps
if (baseSplitStep === undefined || baseFocusStep === undefined) {
  throw new Error("baseEmission must include split and focus steps")
}

describe("executePlan", () => {
  it("executes all steps with the provided executor", async () => {
    const executor = createMockExecutor()
    const result = await executePlan({ emission: baseEmission, executor, windowMode: "new-window" })

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

  it("prefers structured split metadata over raw command arguments when provided", async () => {
    const executor = createMockExecutor()
    const emission: PlanEmission = {
      ...baseEmission,
      steps: [
        {
          ...baseSplitStep,
          command: ["split-window", "-h", "-t", "root.0", "-p", "99"],
          orientation: "vertical",
          percentage: 33,
        },
        baseFocusStep,
      ],
    }

    await executePlan({ emission, executor, windowMode: "new-window" })

    const splitCommand = executor.getExecutedCommands().find((command) => command[0] === "split-window")
    expect(splitCommand).toEqual(["split-window", "-v", "-t", "%0", "-p", "33"])
  })

  it("defaults legacy split commands without direction flag to vertical", async () => {
    const executor = createMockExecutor()
    const emission: PlanEmission = {
      ...baseEmission,
      steps: [
        {
          ...baseSplitStep,
          command: ["split-window", "-t", "root.0", "-p", "40"],
          orientation: undefined,
        },
        baseFocusStep,
      ],
    }

    await executePlan({ emission, executor, windowMode: "new-window" })

    const splitCommand = executor.getExecutedCommands().find((command) => command[0] === "split-window")
    expect(splitCommand).toEqual(["split-window", "-v", "-t", "%0", "-p", "40"])
  })

  it("reuses current window and closes other panes when current-window mode is selected", async () => {
    const executor = createMockExecutor()
    executor.setMockPaneIds(["%2", "%3"])
    const originalPane = process.env.TMUX_PANE
    process.env.TMUX_PANE = "%2"
    const onConfirmKill = vi.fn().mockResolvedValue(true)

    const result = await executePlan({
      emission: baseEmission,
      executor,
      windowMode: "current-window",
      onConfirmKill,
    })

    expect(result.executedSteps).toBe(2)
    expect(onConfirmKill).toHaveBeenCalledWith({ panesToClose: ["%3"], dryRun: true })

    const commands = executor.getExecutedCommands()
    expect(commands[0]).toEqual(["list-panes", "-F", "#{pane_id}"])
    expect(commands[1]).toEqual(["kill-pane", "-a", "-t", "%2"])
    expect(commands.find((cmd) => cmd[0] === "new-window")).toBeUndefined()

    if (originalPane === undefined) {
      delete process.env.TMUX_PANE
    } else {
      process.env.TMUX_PANE = originalPane
    }
  })

  it("creates new tmux window with provided name", async () => {
    const executor = createMockExecutor()
    await executePlan({ emission: baseEmission, executor, windowName: "dev layout", windowMode: "new-window" })

    const commands = executor.getExecutedCommands()
    expect(commands[0]).toEqual(["new-window", "-P", "-F", "#{pane_id}", "-n", "dev layout"])
  })

  it("throws CoreError when tmux command fails", async () => {
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

    await expect(executePlan({ emission: baseEmission, executor, windowMode: "new-window" })).rejects.toThrowError(
      /Failed to execute split step/,
    )
  })

  it("aborts execution when user declines to close existing panes", async () => {
    const baseExecutor = createMockExecutor()
    baseExecutor.setMockPaneIds(["%2", "%3", "%4"])
    const executor = {
      ...baseExecutor,
      isDryRun: () => false,
    }
    const originalPane = process.env.TMUX_PANE
    process.env.TMUX_PANE = "%2"
    const onConfirmKill = vi.fn().mockResolvedValue(false)

    await expect(
      executePlan({
        emission: baseEmission,
        executor,
        windowMode: "current-window",
        onConfirmKill,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.USER_CANCELLED })

    const commands = executor.getExecutedCommands()
    expect(commands).toEqual([["list-panes", "-F", "#{pane_id}"]])

    if (originalPane === undefined) {
      delete process.env.TMUX_PANE
    } else {
      process.env.TMUX_PANE = originalPane
    }
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
    const result = await executePlan({ emission: nestedEmission, executor, windowMode: "new-window" })

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

  it("replaces template tokens in terminal commands", async () => {
    const emissionWithTokens: PlanEmission = {
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
          id: "root.1:focus",
          kind: "focus",
          command: ["select-pane", "-t", "root.1"],
          summary: "select pane root.1",
          targetPaneId: "root.1",
        },
      ],
      hash: "hash",
      summary: {
        focusPaneId: "root.1",
        stepsCount: 2,
        initialPaneId: "root.0",
      },
      terminals: [
        {
          virtualPaneId: "root.0",
          command: 'echo "I am {{this_pane}}, focus is {{focus_pane}}"',
          cwd: undefined,
          env: undefined,
          focus: false,
          name: "left",
        },
        {
          virtualPaneId: "root.1",
          command: 'echo "I am {{this_pane}}, left pane is {{pane_id:left}}"',
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "right",
        },
      ],
    }

    const executor = createMockExecutor()
    const result = await executePlan({ emission: emissionWithTokens, executor, windowMode: "new-window" })

    expect(result.executedSteps).toBe(2)
    const commands = executor.getExecutedCommands()

    // Check that template tokens were replaced in the commands
    expect(commands).toContainEqual(["send-keys", "-t", "%0", 'echo "I am %0, focus is %1"', "Enter"])
    expect(commands).toContainEqual(["send-keys", "-t", "%1", 'echo "I am %1, left pane is %0"', "Enter"])
  })

  it("throws when focus pane cannot be resolved even if {{focus_pane}} is not used", async () => {
    const emission: PlanEmission = {
      ...baseEmission,
      summary: {
        ...baseEmission.summary,
        focusPaneId: "root.unknown",
      },
      terminals: [
        {
          virtualPaneId: "root.0",
          command: "echo no focus token here",
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "main",
        },
      ],
    }

    const executor = createMockExecutor()
    await expect(executePlan({ emission, executor, windowMode: "new-window" })).rejects.toMatchObject({
      code: ErrorCodes.INVALID_PANE,
      path: "root.unknown",
    })
  })

  it("throws when focus pane cannot be resolved and {{focus_pane}} is used", async () => {
    const emission: PlanEmission = {
      ...baseEmission,
      summary: {
        ...baseEmission.summary,
        focusPaneId: "root.missing",
      },
      terminals: [
        {
          virtualPaneId: "root.0",
          command: "echo focus is {{focus_pane}}",
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "main",
        },
      ],
    }

    const executor = createMockExecutor()
    await expect(executePlan({ emission, executor, windowMode: "new-window" })).rejects.toMatchObject({
      code: ErrorCodes.INVALID_PANE,
      path: "root.missing",
    })
  })

  it("applies pane title and waits for delay before command execution", async () => {
    vi.useFakeTimers()
    try {
      const emission: PlanEmission = {
        steps: [
          {
            id: "root:focus",
            kind: "focus",
            command: ["select-pane", "-t", "root.0"],
            summary: "select pane root.0",
            targetPaneId: "root.0",
          },
        ],
        hash: "hash",
        summary: {
          focusPaneId: "root.0",
          stepsCount: 1,
          initialPaneId: "root.0",
        },
        terminals: [
          {
            virtualPaneId: "root.0",
            command: "npm test",
            cwd: undefined,
            env: undefined,
            focus: true,
            name: "main",
            title: "Main Pane",
            delay: 250,
          },
        ],
      }

      const executor = createMockExecutor()
      const execution = executePlan({ emission, executor, windowMode: "new-window" })

      await vi.advanceTimersByTimeAsync(249)
      expect(executor.getExecutedCommands()).not.toContainEqual(["send-keys", "-t", "%0", "npm test", "Enter"])

      await vi.advanceTimersByTimeAsync(1)
      const result = await execution
      const commands = executor.getExecutedCommands()

      expect(result.executedSteps).toBe(1)
      expect(commands).toContainEqual(["select-pane", "-t", "%0", "-T", "Main Pane"])
      expect(commands).toContainEqual(["send-keys", "-t", "%0", "npm test", "Enter"])

      const titleCommandIndex = commands.findIndex(
        (command) => command[0] === "select-pane" && command[3] === "-T" && command[4] === "Main Pane",
      )
      const commandExecutionIndex = commands.findIndex(
        (command) => command[0] === "send-keys" && command[2] === "%0" && command[3] === "npm test",
      )
      expect(titleCommandIndex).toBeGreaterThanOrEqual(0)
      expect(commandExecutionIndex).toBeGreaterThan(titleCommandIndex)
    } finally {
      vi.useRealTimers()
    }
  })

  it("handles ephemeral panes with closeOnError=false (default)", async () => {
    const ephemeralEmission: PlanEmission = {
      steps: [
        {
          id: "root:focus",
          kind: "focus",
          command: ["select-pane", "-t", "root.0"],
          summary: "select pane root.0",
          targetPaneId: "root.0",
        },
      ],
      hash: "hash",
      summary: {
        focusPaneId: "root.0",
        stepsCount: 1,
        initialPaneId: "root.0",
      },
      terminals: [
        {
          virtualPaneId: "root.0",
          command: "npm test",
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "test",
          ephemeral: true,
          closeOnError: false, // Explicitly set to false (default)
        },
      ],
    }

    const executor = createMockExecutor()
    const result = await executePlan({ emission: ephemeralEmission, executor, windowMode: "new-window" })

    expect(result.executedSteps).toBe(1)
    const commands = executor.getExecutedCommands()

    // Check that the command includes exit only on success
    expect(commands).toContainEqual(["send-keys", "-t", "%0", "npm test; [ $? -eq 0 ] && exit", "Enter"])
  })

  it("handles ephemeral panes with closeOnError=true", async () => {
    const ephemeralEmission: PlanEmission = {
      steps: [
        {
          id: "root:focus",
          kind: "focus",
          command: ["select-pane", "-t", "root.0"],
          summary: "select pane root.0",
          targetPaneId: "root.0",
        },
      ],
      hash: "hash",
      summary: {
        focusPaneId: "root.0",
        stepsCount: 1,
        initialPaneId: "root.0",
      },
      terminals: [
        {
          virtualPaneId: "root.0",
          command: "npm run build",
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "build",
          ephemeral: true,
          closeOnError: true,
        },
      ],
    }

    const executor = createMockExecutor()
    const result = await executePlan({ emission: ephemeralEmission, executor, windowMode: "new-window" })

    expect(result.executedSteps).toBe(1)
    const commands = executor.getExecutedCommands()

    // Check that the command includes unconditional exit
    expect(commands).toContainEqual(["send-keys", "-t", "%0", "npm run build; exit", "Enter"])
  })

  it("combines template tokens with ephemeral panes", async () => {
    const combinedEmission: PlanEmission = {
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
          cwd: undefined,
          env: undefined,
          focus: true,
          name: "editor",
        },
        {
          virtualPaneId: "root.1",
          command: 'echo "Editor is {{pane_id:editor}}"',
          cwd: undefined,
          env: undefined,
          focus: false,
          name: "watcher",
          ephemeral: true,
        },
      ],
    }

    const executor = createMockExecutor()
    const result = await executePlan({ emission: combinedEmission, executor, windowMode: "new-window" })

    expect(result.executedSteps).toBe(2)
    const commands = executor.getExecutedCommands()

    // Check that template tokens are replaced AND ephemeral logic is applied
    expect(commands).toContainEqual(["send-keys", "-t", "%1", 'echo "Editor is %0"; [ $? -eq 0 ] && exit', "Enter"])
  })
})
