import { describe, it, expect } from "vitest"
import {
  createConfigError,
  createEnvironmentError,
  createTmuxError,
  createValidationError,
  formatError,
  isVDELayoutError,
  ErrorCodes,
} from "./errors"

describe("error helpers", () => {
  it("creates configuration errors with metadata", () => {
    const error = createConfigError("Config file not found", ErrorCodes.CONFIG_NOT_FOUND, {
      searchPaths: ["/path1", "/path2"],
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("ConfigError")
    expect(error.code).toBe(ErrorCodes.CONFIG_NOT_FOUND)
    expect(error.details).toEqual({ searchPaths: ["/path1", "/path2"] })
    expect(isVDELayoutError(error)).toBe(true)
  })

  it("creates validation errors", () => {
    const error = createValidationError("Invalid preset definition", ErrorCodes.INVALID_PRESET, {
      preset: "development",
      errors: ["ratio mismatch"],
    })

    expect(error.name).toBe("ValidationError")
    expect(error.details.errors).toEqual(["ratio mismatch"])
  })

  it("creates tmux errors", () => {
    const error = createTmuxError("tmux command failed", ErrorCodes.TMUX_COMMAND_FAILED, {
      command: "tmux split-window",
      exitCode: 1,
    })

    expect(error.name).toBe("TmuxError")
    expect(error.details.exitCode).toBe(1)
  })

  it("creates environment errors", () => {
    const error = createEnvironmentError("tmux not installed", ErrorCodes.TMUX_NOT_INSTALLED, {
      hint: "brew install tmux",
    })

    expect(error.name).toBe("EnvironmentError")
    expect(error.details.hint).toBe("brew install tmux")
  })

  it("formats configuration errors with search paths", () => {
    const error = createConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
      searchPaths: ["/home/user/.config/vde/layout.yml", "/etc/xdg/vde/layout.yml"],
    })

    const formatted = formatError(error)

    expect(formatted).toContain("Error: Configuration file not found")
    expect(formatted).toContain("Searched in the following locations:")
    expect(formatted).toContain("/home/user/.config/vde/layout.yml")
    expect(formatted).toContain("To create a configuration file, run:")
  })

  it("formats validation errors with nested details", () => {
    const error = createValidationError("Invalid layout definition", ErrorCodes.INVALID_LAYOUT, {
      preset: "development",
      errors: ["ratio must match panes"],
    })

    const formatted = formatError(error)

    expect(formatted).toContain("Error: Invalid layout definition")
    expect(formatted).toContain("preset: development")
    expect(formatted).toContain("ratio must match panes")
  })

  it("formats tmux errors with command info", () => {
    const error = createTmuxError("tmux command failed", ErrorCodes.TMUX_COMMAND_FAILED, {
      command: "tmux split-window -h",
      stderr: "can't find session",
    })

    const formatted = formatError(error)
    expect(formatted).toContain('Command: "tmux split-window -h"')
    expect(formatted).toContain("stderr: can't find session")
  })

  it("falls back to regular error formatting for non-VDE errors", () => {
    const standardError = new TypeError("Invalid type")
    expect(formatError(standardError)).toBe("TypeError: Invalid type")
  })

  it("detects VDE layout errors via type guard", () => {
    const vdeError = createConfigError("test", ErrorCodes.CONFIG_NOT_FOUND)
    const standardError = new Error("test")

    expect(isVDELayoutError(vdeError)).toBe(true)
    expect(isVDELayoutError(standardError)).toBe(false)
  })
})
