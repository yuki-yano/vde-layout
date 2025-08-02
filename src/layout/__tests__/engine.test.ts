import { describe, expect, it, beforeEach } from "vitest"
import { LayoutEngine } from "../engine"
import type { Preset } from "../../models/types"
import { MockExecutor } from "../../executor/mock-executor"

describe("LayoutEngine", () => {
  let engine: LayoutEngine
  let mockExecutor: MockExecutor

  beforeEach(() => {
    mockExecutor = new MockExecutor()
    engine = new LayoutEngine({ executor: mockExecutor })
  })

  describe("constructor", () => {
    it("should create an instance with default options", () => {
      // In test environment, it will automatically use MockExecutor
      const defaultEngine = new LayoutEngine()
      expect(defaultEngine).toBeInstanceOf(LayoutEngine)
    })

    it("should create an instance with custom executor", () => {
      const customExecutor = new MockExecutor()
      const engineWithExecutor = new LayoutEngine({ executor: customExecutor })
      expect(engineWithExecutor).toBeInstanceOf(LayoutEngine)
    })
  })

  describe("createLayout - basic layouts", () => {
    it("should handle a simple terminal pane layout", async () => {
      const preset: Preset = {
        name: "simple",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [{ command: "vim" }, { command: "htop" }],
        },
      }

      await engine.createLayout(preset)

      const commands = mockExecutor.getExecutedCommands()
      // Should create new window, split, and run commands
      expect(commands.some((cmd) => cmd.includes("new-window"))).toBe(true)
      expect(commands.some((cmd) => cmd.includes("split-window"))).toBe(true)
      expect(commands.some((cmd) => cmd.includes("vim"))).toBe(true)
      expect(commands.some((cmd) => cmd.includes("htop"))).toBe(true)
    })

    it("should handle a horizontal split layout", async () => {
      const preset: Preset = {
        name: "horizontal-split",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [{ command: "vim" }, { command: "htop" }],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle a vertical split layout", async () => {
      const preset: Preset = {
        name: "vertical-split",
        layout: {
          type: "vertical",
          ratio: [70, 30],
          panes: [{ command: "npm run dev" }, { command: "npm test" }],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle empty command", async () => {
      const preset: Preset = {
        name: "empty-command",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [{}, {}], // without command
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })
  })

  describe("createLayout - complex layouts", () => {
    it("should handle a complex nested layout", async () => {
      const preset: Preset = {
        name: "complex",
        layout: {
          type: "horizontal",
          ratio: [60, 40],
          panes: [
            { command: "vim" },
            {
              type: "vertical",
              ratio: [70, 30],
              panes: [{ command: "npm run dev" }, { command: "tail -f logs/app.log" }],
            },
          ],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle deeply nested layouts", async () => {
      const preset: Preset = {
        name: "deeply-nested",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [
            {
              type: "vertical",
              ratio: [50, 50],
              panes: [
                { command: "cmd1" },
                {
                  type: "horizontal",
                  ratio: [50, 50],
                  panes: [{ command: "cmd2" }, { command: "cmd3" }],
                },
              ],
            },
            {
              type: "vertical",
              ratio: [30, 70],
              panes: [{ command: "cmd4" }, { command: "cmd5" }],
            },
          ],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })
  })

  describe("createLayout - pane options", () => {
    it("should handle pane options", async () => {
      const preset: Preset = {
        name: "with-options",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [
            {
              command: "vim",
              cwd: "/home/user/project",
              env: { NODE_ENV: "development" },
              name: "Editor",
              focus: true,
            },
            {
              command: "npm run dev",
              delay: 1000,
            },
          ],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle multiple environment variables", async () => {
      const preset: Preset = {
        name: "multi-env",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [
            {
              command: "node server.js",
              env: {
                NODE_ENV: "production",
                PORT: "3000",
                DATABASE_URL: "postgres://localhost:5432/mydb",
                API_KEY: 'secret-key-with-"quotes"',
              },
            },
            {
              command: "htop",
            },
          ],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle focus on multiple panes", async () => {
      const preset: Preset = {
        name: "multiple-focus",
        layout: {
          type: "horizontal",
          ratio: [33, 34, 33],
          panes: [
            { command: "vim", focus: true },
            { command: "htop" },
            { command: "logs", focus: true }, // Last focus: true takes precedence
          ],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })
  })

  describe("createLayout - options", () => {
    it("should respect clearExisting option", async () => {
      const preset: Preset = {
        name: "simple",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [{ command: "vim" }, { command: "htop" }],
        },
      }

      await expect(engine.createLayout(preset, { clearExisting: false })).resolves.toBeUndefined()
    })
  })

  describe("createLayout - edge cases", () => {
    it("should handle three-way split", async () => {
      const preset: Preset = {
        name: "three-way",
        layout: {
          type: "horizontal",
          ratio: [33, 34, 33],
          panes: [{ command: "vim" }, { command: "htop" }, { command: "logs" }],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle uneven ratio splits", async () => {
      const preset: Preset = {
        name: "uneven",
        layout: {
          type: "horizontal",
          ratio: [70, 30],
          panes: [{ command: "main" }, { command: "sidebar" }],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })

    it("should handle panes with all options", async () => {
      const preset: Preset = {
        name: "full-options",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [
            {
              command: 'complex command && echo "done"',
              cwd: "~/workspace",
              env: {
                VAR1: "value1",
                VAR2: "value2",
              },
              name: "Main Workspace",
              focus: true,
              delay: 500,
            },
            {
              command: "htop",
              name: "Monitor",
            },
          ],
        },
      }

      await expect(engine.createLayout(preset)).resolves.toBeUndefined()
    })
  })

  describe("error handling", () => {
    it("should throw error when not in tmux session", async () => {
      // Test outside actual tmux environment
      delete process.env.TMUX
      const realEngine = new LayoutEngine({ dryRun: false })

      const preset: Preset = {
        name: "simple",
        layout: {
          type: "horizontal",
          ratio: [50, 50],
          panes: [{ command: "vim" }, { command: "htop" }],
        },
      }

      await expect(realEngine.createLayout(preset)).rejects.toThrow("Must be run inside a tmux session")
    })
  })
})
