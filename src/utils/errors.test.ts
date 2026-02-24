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

  it("rejects invalid VDE error candidates in type guard", () => {
    expect(isVDELayoutError(null)).toBe(false)
    expect(isVDELayoutError("error")).toBe(false)
    expect(isVDELayoutError({})).toBe(false)
    expect(isVDELayoutError({ code: 123, details: {} })).toBe(false)
    expect(isVDELayoutError({ code: ErrorCodes.INVALID_LAYOUT })).toBe(false)
  })

  it("omits config search path help when searchPaths is not an array", () => {
    const error = createConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
      searchPaths: "/home/user/.config/vde/layout.yml",
    })

    const formatted = formatError(error)
    expect(formatted).toContain("Error: Configuration file not found")
    expect(formatted).not.toContain("Searched in the following locations:")
    expect(formatted).not.toContain("To create a configuration file, run:")
  })

  it("formats tmux environment guidance messages", () => {
    const notInSession = createTmuxError("not in session", ErrorCodes.NOT_IN_TMUX_SESSION)
    const tmuxMissing = createEnvironmentError("tmux missing", ErrorCodes.TMUX_NOT_INSTALLED)

    expect(formatError(notInSession)).toContain("must be run inside a tmux session")
    expect(formatError(tmuxMissing)).toContain("Install tmux using your package manager")
  })

  it("formats unsupported tmux version only when required version exists", () => {
    const withRequired = createEnvironmentError("unsupported", ErrorCodes.UNSUPPORTED_TMUX_VERSION, {
      requiredVersion: "3.4",
    })
    const withoutRequired = createEnvironmentError("unsupported", ErrorCodes.UNSUPPORTED_TMUX_VERSION, {
      requiredVersion: 34,
    })

    expect(formatError(withRequired)).toContain("Required tmux version: 3.4 or higher")
    expect(formatError(withoutRequired)).toContain("Error: unsupported")
    expect(formatError(withoutRequired)).not.toContain("Required tmux version:")
  })

  it("formats backend not found message with wezterm specific guidance", () => {
    const genericBackend = createEnvironmentError("backend not found", ErrorCodes.BACKEND_NOT_FOUND, {
      backend: "tmux",
      binary: "tmux",
    })
    const weztermBackend = createEnvironmentError("backend not found", ErrorCodes.BACKEND_NOT_FOUND, {
      backend: "wezterm",
    })
    const fallbackBackend = createEnvironmentError("backend not found", ErrorCodes.BACKEND_NOT_FOUND, {
      backend: 42,
    })

    expect(formatError(genericBackend)).toContain("Missing binary: tmux")
    expect(formatError(genericBackend)).not.toContain("Install wezterm")

    const weztermFormatted = formatError(weztermBackend)
    expect(weztermFormatted).toContain("Missing binary: wezterm")
    expect(weztermFormatted).toContain("Install wezterm using your package manager")

    expect(formatError(fallbackBackend)).toContain("Missing binary: terminal backend")
  })

  it("formats wezterm guidance and version details", () => {
    const missing = createEnvironmentError("wezterm missing", ErrorCodes.WEZTERM_NOT_FOUND)
    const unsupported = createEnvironmentError("wezterm version", ErrorCodes.UNSUPPORTED_WEZTERM_VERSION, {
      detectedVersion: "20240203-110809",
      requiredVersion: "20240203-110000",
    })
    const unsupportedWithoutVersions = createEnvironmentError(
      "wezterm version",
      ErrorCodes.UNSUPPORTED_WEZTERM_VERSION,
      {
        detectedVersion: 1,
        requiredVersion: 2,
      },
    )

    expect(formatError(missing)).toContain("wezterm command was not found")
    expect(formatError(unsupported)).toContain("Detected version: 20240203-110809")
    expect(formatError(unsupported)).toContain("Required version: 20240203-110000 or higher")
    const unsupportedWithoutVersionsFormatted = formatError(unsupportedWithoutVersions)
    expect(unsupportedWithoutVersionsFormatted).toContain("Error: wezterm version")
    expect(unsupportedWithoutVersionsFormatted).toContain("Unsupported wezterm version detected.")
  })

  it("formats split size resolution errors with pane/version details", () => {
    const error = createEnvironmentError("split size failed", ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED, {
      paneId: "100",
      paneCells: 80,
      detectedVersion: "20240203-110809",
      requiredVersion: "20220624-141144-bd1b7c5d",
    })

    const formatted = formatError(error)
    expect(formatted).toContain("Unable to resolve split size from pane dimensions.")
    expect(formatted).toContain("Pane ID: 100")
    expect(formatted).toContain("Pane cells: 80")
    expect(formatted).toContain("Detected version: 20240203-110809")
    expect(formatted).toContain("Required version: 20220624-141144-bd1b7c5d")
  })
})
