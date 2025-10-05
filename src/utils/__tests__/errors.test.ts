import { describe, it, expect } from "vitest"
import {
  VDELayoutError,
  ConfigError,
  ValidationError,
  TmuxError,
  EnvironmentError,
  formatError,
  isVDELayoutError,
} from "../errors.ts"

describe("Error class hierarchy", () => {
  describe("VDELayoutError", () => {
    it("holds basic error information", () => {
      const error = new VDELayoutError("Test error", "TEST_ERROR", { detail: "test" })

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(VDELayoutError)
      expect(error.message).toBe("Test error")
      expect(error.code).toBe("TEST_ERROR")
      expect(error.details).toEqual({ detail: "test" })
      expect(error.name).toBe("VDELayoutError")
    })

    it("can be instantiated without details", () => {
      const error = new VDELayoutError("Test error", "TEST_ERROR")

      expect(error.details).toEqual({})
    })
  })

  describe("ConfigError", () => {
    it("represents configuration file related errors", () => {
      const error = new ConfigError("Config file not found", "CONFIG_NOT_FOUND", {
        searchPaths: ["/path1", "/path2"],
        suggestions: ["Create a config file at ~/.config/vde/layout.yml"],
      })

      expect(error).toBeInstanceOf(VDELayoutError)
      expect(error).toBeInstanceOf(ConfigError)
      expect(error.name).toBe("ConfigError")
      expect(error.code).toBe("CONFIG_NOT_FOUND")
    })
  })

  describe("ValidationError", () => {
    it("represents validation errors", () => {
      const error = new ValidationError("Invalid preset definition", "INVALID_PRESET", {
        preset: "development",
        errors: ["ratio and panes mismatch"],
      })

      expect(error).toBeInstanceOf(VDELayoutError)
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.name).toBe("ValidationError")
    })
  })

  describe("TmuxError", () => {
    it("represents tmux command execution errors", () => {
      const error = new TmuxError("Failed to execute tmux command", "TMUX_COMMAND_FAILED", {
        command: "tmux split-window",
        exitCode: 1,
        stderr: "no current session",
      })

      expect(error).toBeInstanceOf(VDELayoutError)
      expect(error).toBeInstanceOf(TmuxError)
      expect(error.name).toBe("TmuxError")
    })
  })

  describe("EnvironmentError", () => {
    it("represents environment-related errors", () => {
      const error = new EnvironmentError("tmux not found", "TMUX_NOT_INSTALLED", {
        requiredVersion: "3.0",
        suggestions: ["Install tmux using your package manager"],
      })

      expect(error).toBeInstanceOf(VDELayoutError)
      expect(error).toBeInstanceOf(EnvironmentError)
      expect(error.name).toBe("EnvironmentError")
    })
  })

  describe("formatError", () => {
    it("formats ConfigError to user-friendly message", () => {
      const error = new ConfigError("Configuration file not found", "CONFIG_NOT_FOUND", {
        searchPaths: ["/home/user/.config/vde/layout.yml", "/etc/xdg/vde/layout.yml"],
      })

      const formatted = formatError(error)

      expect(formatted).toContain("Error: Configuration file not found")
      expect(formatted).toContain("Searched in the following locations:")
      expect(formatted).toContain("- /home/user/.config/vde/layout.yml")
      expect(formatted).toContain("- /etc/xdg/vde/layout.yml")
      expect(formatted).toContain("To create a configuration file, run:")
    })

    it("formats ValidationError with details", () => {
      const error = new ValidationError("Invalid layout definition", "INVALID_LAYOUT", {
        preset: "development",
        errors: ["ratio: Expected array with at least 2 elements", "panes: Mismatch with ratio array"],
      })

      const formatted = formatError(error)

      expect(formatted).toContain("Error: Invalid layout definition")
      expect(formatted).toContain("Preset: development")
      expect(formatted).toContain("Validation errors:")
      expect(formatted).toContain("- ratio: Expected array with at least 2 elements")
    })

    it("formats TmuxError with command information", () => {
      const error = new TmuxError("tmux command failed", "TMUX_COMMAND_FAILED", {
        command: "tmux split-window -h",
        exitCode: 1,
        stderr: "can't find session",
      })

      const formatted = formatError(error)

      expect(formatted).toContain("Error: tmux command failed")
      expect(formatted).toContain("Command: tmux split-window -h")
      expect(formatted).toContain("Exit code: 1")
      expect(formatted).toContain("Error output: can't find session")
    })

    it("formats regular Error as well", () => {
      const error = new Error("Something went wrong")
      const formatted = formatError(error)

      expect(formatted).toBe("Error: Something went wrong")
    })

    it("formats non-VDELayoutError errors simply", () => {
      const error = new TypeError("Invalid type")
      const formatted = formatError(error)

      expect(formatted).toBe("TypeError: Invalid type")
    })
  })

  describe("isVDELayoutError", () => {
    it("identifies VDELayoutError instances", () => {
      const vdeError = new VDELayoutError("test", "TEST")
      const configError = new ConfigError("test", "TEST")
      const normalError = new Error("test")

      expect(isVDELayoutError(vdeError)).toBe(true)
      expect(isVDELayoutError(configError)).toBe(true)
      expect(isVDELayoutError(normalError)).toBe(false)
    })
  })
})
