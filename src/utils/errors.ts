export type VDELayoutError = Error & {
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>
}

export const ErrorCodes = {
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_PARSE_ERROR: "CONFIG_PARSE_ERROR",
  CONFIG_PERMISSION_ERROR: "CONFIG_PERMISSION_ERROR",
  INVALID_PRESET: "INVALID_PRESET",
  PRESET_NOT_FOUND: "PRESET_NOT_FOUND",
  INVALID_LAYOUT: "INVALID_LAYOUT",
  INVALID_PANE: "INVALID_PANE",
  TMUX_NOT_RUNNING: "TMUX_NOT_RUNNING",
  TMUX_COMMAND_FAILED: "TMUX_COMMAND_FAILED",
  NOT_IN_TMUX_SESSION: "NOT_IN_TMUX_SESSION",
  NOT_IN_TMUX: "NOT_IN_TMUX",
  TMUX_NOT_FOUND: "TMUX_NOT_FOUND",
  TMUX_NOT_INSTALLED: "TMUX_NOT_INSTALLED",
  UNSUPPORTED_TMUX_VERSION: "UNSUPPORTED_TMUX_VERSION",
} as const

const createBaseError = (
  name: string,
  message: string,
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): VDELayoutError => {
  const error = new Error(message) as VDELayoutError
  error.name = name
  ;(error as { code: string }).code = code
  ;(error as { details: Readonly<Record<string, unknown>> }).details = details
  return error
}

export const createConfigError = (
  message: string,
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): VDELayoutError => {
  return createBaseError("ConfigError", message, code, details)
}

export const createValidationError = (
  message: string,
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): VDELayoutError => {
  return createBaseError("ValidationError", message, code, details)
}

export const createTmuxError = (
  message: string,
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): VDELayoutError => {
  return createBaseError("TmuxError", message, code, details)
}

export const createEnvironmentError = (
  message: string,
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): VDELayoutError => {
  return createBaseError("EnvironmentError", message, code, details)
}

export const isVDELayoutError = (error: unknown): error is VDELayoutError => {
  if (typeof error !== "object" || error === null) {
    return false
  }

  if (!("code" in error)) {
    return false
  }

  const { code } = error as { code?: unknown }
  if (typeof code !== "string") {
    return false
  }

  if (!("details" in error)) {
    return false
  }

  return true
}

const formatters: Record<string, (error: VDELayoutError) => string> = {
  [ErrorCodes.CONFIG_NOT_FOUND]: (error) => {
    const searchPaths = error.details.searchPaths
    if (!Array.isArray(searchPaths)) {
      return ""
    }

    const lines = ["", "Searched in the following locations:"]
    searchPaths.forEach((location) => lines.push(`  - ${location}`))
    lines.push("", "To create a configuration file, run:")
    lines.push("  mkdir -p ~/.config/vde")
    lines.push('  echo "presets: {}" > ~/.config/vde/layout.yml')
    return lines.join("\n")
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
    const requiredVersion = error.details.requiredVersion
    if (typeof requiredVersion !== "string") {
      return ""
    }
    return `\nRequired tmux version: ${requiredVersion} or higher\n`
  },
}

export const formatError = (error: Error): string => {
  if (!isVDELayoutError(error)) {
    return `${error.name}: ${error.message}`
  }

  let message = `Error: ${error.message}`

  const formatter = formatters[error.code]
  if (formatter) {
    message += `\n${formatter(error)}`
  }

  const commandDetail = error.details.command
  if (commandDetail !== undefined) {
    message += `\nCommand: ${JSON.stringify(commandDetail)}`
  }

  const stderrDetail = error.details.stderr
  if (stderrDetail !== undefined) {
    message += `\nstderr: ${String(stderrDetail)}`
  }

  const presetDetail = error.details.preset
  if (presetDetail !== undefined) {
    message += `\npreset: ${String(presetDetail)}`
  }

  const nestedErrors = error.details.errors
  if (Array.isArray(nestedErrors) && nestedErrors.length > 0) {
    message += "\nValidation errors:\n"
    nestedErrors.forEach((item) => {
      message += `  - ${String(item)}\n`
    })
  }

  return message
}
