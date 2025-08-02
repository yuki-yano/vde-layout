import { describe, expect, it, beforeEach } from "vitest"
import { TmuxCommandGenerator } from "../commands"

describe("TmuxCommandGenerator", () => {
  let generator: TmuxCommandGenerator

  beforeEach(() => {
    generator = new TmuxCommandGenerator()
  })

  describe("splitWindow", () => {
    it("should generate horizontal split command", () => {
      const result = generator.splitWindow("horizontal")
      expect(result).toEqual(["split-window", "-h"])
    })

    it("should generate vertical split command", () => {
      const result = generator.splitWindow("vertical")
      expect(result).toEqual(["split-window", "-v"])
    })

    it("should generate split command with target pane", () => {
      const result = generator.splitWindow("horizontal", "%1")
      expect(result).toEqual(["split-window", "-h", "-t", "%1"])
    })

    it("should generate split command with percentage", () => {
      const result = generator.splitWindow("vertical", undefined, 30)
      expect(result).toEqual(["split-window", "-v", "-p", "30"])
    })

    it("should generate split command with all options", () => {
      const result = generator.splitWindow("horizontal", "%2", 25)
      expect(result).toEqual(["split-window", "-h", "-t", "%2", "-p", "25"])
    })
  })

  describe("resizePane", () => {
    it("should generate resize command for horizontal layout", () => {
      const result = generator.resizePane("%0", "horizontal", 50)
      expect(result).toEqual(["resize-pane", "-t", "%0", "-x", "50%"])
    })

    it("should generate resize command for vertical layout", () => {
      const result = generator.resizePane("%1", "vertical", 75)
      expect(result).toEqual(["resize-pane", "-t", "%1", "-y", "75%"])
    })

    it("should handle percentage values correctly", () => {
      const result = generator.resizePane("%2", "horizontal", 33.33)
      expect(result).toEqual(["resize-pane", "-t", "%2", "-x", "33%"])
    })
  })

  describe("sendKeys", () => {
    it("should generate send-keys command", () => {
      const result = generator.sendKeys("%0", "echo hello")
      expect(result).toEqual(["send-keys", "-t", "%0", "echo hello", "Enter"])
    })

    it("should handle empty command", () => {
      const result = generator.sendKeys("%1", "")
      expect(result).toEqual(["send-keys", "-t", "%1", "", "Enter"])
    })

    it("should handle command with special characters", () => {
      const result = generator.sendKeys("%0", 'echo "Hello, World!"')
      expect(result).toEqual(["send-keys", "-t", "%0", 'echo "Hello, World!"', "Enter"])
    })
  })

  describe("selectPane", () => {
    it("should generate select-pane command", () => {
      const result = generator.selectPane("%2")
      expect(result).toEqual(["select-pane", "-t", "%2"])
    })
  })

  describe("setPaneOption", () => {
    it("should generate set-option command for pane", () => {
      const result = generator.setPaneOption("%0", "remain-on-exit", "on")
      expect(result).toEqual(["set-option", "-p", "-t", "%0", "remain-on-exit", "on"])
    })

    it("should handle boolean value", () => {
      const result = generator.setPaneOption("%1", "synchronize-panes", "off")
      expect(result).toEqual(["set-option", "-p", "-t", "%1", "synchronize-panes", "off"])
    })
  })

  describe("setEnvironment", () => {
    it("should generate single environment variable command", () => {
      const result = generator.setEnvironment("%0", { NODE_ENV: "development" })
      expect(result).toEqual([["send-keys", "-t", "%0", 'export NODE_ENV="development"', "Enter"]])
    })

    it("should generate multiple environment variable commands", () => {
      const result = generator.setEnvironment("%1", {
        NODE_ENV: "production",
        PORT: "3000",
        DEBUG: "true",
      })
      expect(result).toEqual([
        ["send-keys", "-t", "%1", 'export NODE_ENV="production"', "Enter"],
        ["send-keys", "-t", "%1", 'export PORT="3000"', "Enter"],
        ["send-keys", "-t", "%1", 'export DEBUG="true"', "Enter"],
      ])
    })

    it("should handle empty environment object", () => {
      const result = generator.setEnvironment("%0", {})
      expect(result).toEqual([])
    })

    it("should escape special characters in values", () => {
      const result = generator.setEnvironment("%0", {
        MESSAGE: 'Hello "World"',
        PATH: "/usr/bin:$PATH",
      })
      expect(result).toEqual([
        ["send-keys", "-t", "%0", 'export MESSAGE="Hello \\"World\\""', "Enter"],
        ["send-keys", "-t", "%0", 'export PATH="/usr/bin:$PATH"', "Enter"],
      ])
    })
  })

  describe("setPaneTitle", () => {
    it("should generate pane title command", () => {
      const result = generator.setPaneTitle("%0", "Editor")
      expect(result).toEqual(["select-pane", "-t", "%0", "-T", "Editor"])
    })

    it("should handle title with spaces", () => {
      const result = generator.setPaneTitle("%1", "Development Server")
      expect(result).toEqual(["select-pane", "-t", "%1", "-T", "Development Server"])
    })
  })

  describe("changeDirectory", () => {
    it("should generate cd command", () => {
      const result = generator.changeDirectory("%0", "/home/user/projects")
      expect(result).toEqual(["send-keys", "-t", "%0", 'cd "/home/user/projects"', "Enter"])
    })

    it("should handle paths with spaces", () => {
      const result = generator.changeDirectory("%1", "/home/user/My Documents")
      expect(result).toEqual(["send-keys", "-t", "%1", 'cd "/home/user/My Documents"', "Enter"])
    })

    it("should handle home directory shortcut", () => {
      const result = generator.changeDirectory("%0", "~/projects")
      expect(result).toEqual(["send-keys", "-t", "%0", 'cd "~/projects"', "Enter"])
    })
  })

  describe("killAllPanes", () => {
    it("should generate kill all panes except current", () => {
      const result = generator.killAllPanes()
      expect(result).toEqual(["kill-pane", "-a"])
    })
  })

  describe("Complex command sequences", () => {
    it("should handle creating a complex layout", () => {
      // Create a 3-pane layout: editor | server/logs
      const commands = [
        generator.splitWindow("horizontal"),
        generator.splitWindow("vertical", "%1"),
        generator.resizePane("%0", "horizontal", 60),
        generator.resizePane("%1", "vertical", 70),
        generator.sendKeys("%0", "vim"),
        generator.sendKeys("%1", "npm run dev"),
        generator.sendKeys("%2", "tail -f logs/app.log"),
        generator.selectPane("%0"),
      ]

      expect(commands).toEqual([
        ["split-window", "-h"],
        ["split-window", "-v", "-t", "%1"],
        ["resize-pane", "-t", "%0", "-x", "60%"],
        ["resize-pane", "-t", "%1", "-y", "70%"],
        ["send-keys", "-t", "%0", "vim", "Enter"],
        ["send-keys", "-t", "%1", "npm run dev", "Enter"],
        ["send-keys", "-t", "%2", "tail -f logs/app.log", "Enter"],
        ["select-pane", "-t", "%0"],
      ])
    })
  })
})
