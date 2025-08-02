/**
 * Base class for VDELayout errors
 */
export class VDELayoutError extends Error {
  public readonly code: string
  public readonly details: Record<string, unknown>

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "VDELayoutError"
    this.code = code
    this.details = details

    // Configuration for TypeScript error inheritance
    Object.setPrototypeOf(this, VDELayoutError.prototype)
  }
}

/**
 * Configuration file related errors
 */
export class ConfigError extends VDELayoutError {
  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message, code, details)
    this.name = "ConfigError"
    Object.setPrototypeOf(this, ConfigError.prototype)
  }
}

/**
 * Validation errors
 */
export class ValidationError extends VDELayoutError {
  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message, code, details)
    this.name = "ValidationError"
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

/**
 * tmux command execution errors
 */
export class TmuxError extends VDELayoutError {
  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message, code, details)
    this.name = "TmuxError"
    Object.setPrototypeOf(this, TmuxError.prototype)
  }
}

/**
 * Environment errors (e.g., tmux not installed)
 */
export class EnvironmentError extends VDELayoutError {
  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message, code, details)
    this.name = "EnvironmentError"
    Object.setPrototypeOf(this, EnvironmentError.prototype)
  }
}

/**
 * Error code constants
 */
export const ErrorCodes = {
  // Configuration errors
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_PARSE_ERROR: "CONFIG_PARSE_ERROR",
  CONFIG_PERMISSION_ERROR: "CONFIG_PERMISSION_ERROR",

  // Validation errors
  INVALID_PRESET: "INVALID_PRESET",
  PRESET_NOT_FOUND: "PRESET_NOT_FOUND",
  INVALID_LAYOUT: "INVALID_LAYOUT",
  INVALID_PANE: "INVALID_PANE",

  // tmux errors
  TMUX_NOT_RUNNING: "TMUX_NOT_RUNNING",
  TMUX_COMMAND_FAILED: "TMUX_COMMAND_FAILED",
  NOT_IN_TMUX_SESSION: "NOT_IN_TMUX_SESSION",
  NOT_IN_TMUX: "NOT_IN_TMUX",
  TMUX_NOT_FOUND: "TMUX_NOT_FOUND",

  // Environment errors
  TMUX_NOT_INSTALLED: "TMUX_NOT_INSTALLED",
  UNSUPPORTED_TMUX_VERSION: "UNSUPPORTED_TMUX_VERSION",
} as const

/**
 * Type guard to determine if error is VDELayoutError
 */
export function isVDELayoutError(error: unknown): error is VDELayoutError {
  return error instanceof VDELayoutError
}

/**
 * Format error into user-friendly message
 */
export function formatError(error: Error): string {
  if (!isVDELayoutError(error)) {
    return `${error.name}: ${error.message}`
  }

  let message = `Error: ${error.message}\n`

  // Add context-specific formatting based on error type and code
  const formatter = errorFormatters[error.code]
  if (formatter) {
    message += formatter(error)
  }

  // Add generic detail formatting
  if (error.details.preset !== undefined) {
    message += `\nPreset: ${error.details.preset}\n`
  }

  if (error.details.command !== undefined) {
    message += `\nCommand: ${error.details.command}\n`
  }

  if (error.details.exitCode !== undefined) {
    message += `Exit code: ${error.details.exitCode}\n`
  }

  if (error.details.stderr !== undefined) {
    message += `Error output: ${error.details.stderr}\n`
  }

  if (error.details.errors !== undefined && Array.isArray(error.details.errors)) {
    message += "\nValidation errors:\n"
    error.details.errors.forEach((err: string) => {
      message += `  - ${err}\n`
    })
  }

  return message
}

// Map of error code to specific formatting function
const errorFormatters: Record<string, (error: VDELayoutError) => string> = {
  [ErrorCodes.CONFIG_NOT_FOUND]: (error) => {
    let msg = ""
    if (error.details.searchPaths !== undefined) {
      msg += "\nSearched in the following locations:\n"
      const paths = error.details.searchPaths as string[]
      paths.forEach((path) => {
        msg += `  - ${path}\n`
      })
      msg += "\nTo create a configuration file, run:\n"
      msg += "  mkdir -p ~/.config/vde\n"
      msg += '  echo "presets: {}" > ~/.config/vde/layout.yml\n'
    }
    return msg
  },

  [ErrorCodes.NOT_IN_TMUX_SESSION]: () => {
    return "\nThis command must be run inside a tmux session.\nStart tmux first with: tmux\n"
  },

  [ErrorCodes.TMUX_NOT_INSTALLED]: () => {
    return (
      "\ntmux is required but not installed.\n" +
      "Install tmux using your package manager:\n" +
      "  - macOS: brew install tmux\n" +
      "  - Ubuntu/Debian: sudo apt-get install tmux\n" +
      "  - Fedora: sudo dnf install tmux\n"
    )
  },

  [ErrorCodes.UNSUPPORTED_TMUX_VERSION]: (error) => {
    let msg = ""
    if (error.details.requiredVersion !== undefined) {
      msg += `\nRequired tmux version: ${error.details.requiredVersion} or higher\n`
    }
    return msg
  },
}
