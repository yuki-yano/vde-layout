import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { createTmuxExecutor, type TmuxExecutor } from "../executor"
import { createMockExecutor, type MockExecutor } from "../../executor/mock-executor"

describe("createTmuxExecutor", () => {
  let executor: TmuxExecutor
  let mockExecutor: MockExecutor
  let originalTMUX: string | undefined

  beforeEach(() => {
    mockExecutor = createMockExecutor()
    executor = createTmuxExecutor({ executor: mockExecutor })
    originalTMUX = process.env.TMUX
  })

  afterEach(() => {
    if (originalTMUX !== undefined) {
      process.env.TMUX = originalTMUX
    } else {
      delete process.env.TMUX
    }
    vi.restoreAllMocks()
  })

  describe("factory", () => {
    it("creates executor with default options", () => {
      const defaultExecutor = createTmuxExecutor()
      expect(typeof defaultExecutor.execute).toBe("function")
    })

    it("respects verbose option", () => {
      const verboseExecutor = createTmuxExecutor({ verbose: true })
      expect(typeof verboseExecutor.getCommandString).toBe("function")
    })

    it("respects dryRun option", () => {
      const dryRunExecutor = createTmuxExecutor({ dryRun: true })
      expect(dryRunExecutor.getExecutor().isDryRun()).toBe(true)
    })
  })

  describe("isInTmuxSession", () => {
    it("should return true when TMUX environment variable is set", () => {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
      expect(executor.isInTmuxSession()).toBe(true)
    })

    it("should return false when TMUX environment variable is not set", () => {
      delete process.env.TMUX
      expect(executor.isInTmuxSession()).toBe(false)
    })

    it("should return false when TMUX environment variable is empty", () => {
      process.env.TMUX = ""
      expect(executor.isInTmuxSession()).toBe(false)
    })
  })

  describe("verifyTmuxEnvironment", () => {
    it("should throw informative error when not in tmux session", async () => {
      delete process.env.TMUX

      await expect(executor.verifyTmuxEnvironment()).rejects.toThrow(/Must be run inside a tmux session/)
    })

    // Skip actual tmux command existence check (considering CI environment execution)
  })

  describe("execute", () => {
    it("should execute command using mock executor", async () => {
      const result = await executor.execute(["split-window", "-h"])
      expect(result).toBe("")
      expect(mockExecutor.getExecutedCommands()).toHaveLength(1)
      expect(mockExecutor.getExecutedCommands()[0]).toEqual(["split-window", "-h"])
    })

    it("should return mock pane ID when requested", async () => {
      const result = await executor.execute(["display-message", "-p", "#{pane_id}"])
      expect(result).toBe("%0")
    })

    it("should handle list-panes command", async () => {
      mockExecutor.setMockPaneIds(["%0", "%1", "%2"])
      const result = await executor.execute(["list-panes", "-F", "#{pane_id}"])
      expect(result).toBe("%0\n%1\n%2")
    })

    it("should add new pane ID for split-window", async () => {
      await executor.execute(["split-window", "-h"])
      expect(mockExecutor.getPaneIds()).toEqual(["%0", "%1"])
    })

    it("should log commands in verbose dry-run mode", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      const dryRunExecutor = createTmuxExecutor({ dryRun: true, verbose: true })

      await dryRunExecutor.execute(["new-window"])
      expect(logSpy).toHaveBeenCalledWith("[tmux] [DRY RUN] Would execute: tmux new-window")
    })
  })

  describe("executeMany", () => {
    it("should execute multiple commands", async () => {
      await executor.executeMany([["new-window"], ["split-window", "-h"], ["select-pane", "-t", "0"]])

      const commands = mockExecutor.getExecutedCommands()
      expect(commands).toHaveLength(3)
      expect(commands[0]).toEqual(["new-window"])
      expect(commands[1]).toEqual(["split-window", "-h"])
      expect(commands[2]).toEqual(["select-pane", "-t", "0"])
    })
  })

  describe("getCommandString", () => {
    it("should format command array as string", () => {
      const result = executor.getCommandString(["send-keys", "-t", "%0", "echo hello", "Enter"])
      expect(result).toBe("tmux send-keys -t %0 echo hello Enter")
    })

    it("should handle empty array", () => {
      const result = executor.getCommandString([])
      expect(result).toBe("tmux")
    })

    it("should handle single argument", () => {
      const result = executor.getCommandString(["list-sessions"])
      expect(result).toBe("tmux list-sessions")
    })
  })
})
