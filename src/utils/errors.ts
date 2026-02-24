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
  INVALID_PLAN: "INVALID_PLAN",
  MISSING_TARGET: "MISSING_TARGET",
  TMUX_NOT_RUNNING: "TMUX_NOT_RUNNING",
  TMUX_COMMAND_FAILED: "TMUX_COMMAND_FAILED",
  NOT_IN_TMUX_SESSION: "NOT_IN_TMUX_SESSION",
  TMUX_NOT_FOUND: "TMUX_NOT_FOUND",
  TMUX_NOT_INSTALLED: "TMUX_NOT_INSTALLED",
  UNSUPPORTED_TMUX_VERSION: "UNSUPPORTED_TMUX_VERSION",
  BACKEND_NOT_FOUND: "BACKEND_NOT_FOUND",
  TERMINAL_COMMAND_FAILED: "TERMINAL_COMMAND_FAILED",
  TEMPLATE_TOKEN_ERROR: "TEMPLATE_TOKEN_ERROR",
  WEZTERM_NOT_FOUND: "WEZTERM_NOT_FOUND",
  UNSUPPORTED_WEZTERM_VERSION: "UNSUPPORTED_WEZTERM_VERSION",
  USER_CANCELLED: "USER_CANCELLED",
  SPLIT_SIZE_RESOLUTION_FAILED: "SPLIT_SIZE_RESOLUTION_FAILED",
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
  [ErrorCodes.BACKEND_NOT_FOUND]: (error) => {
    const backend = typeof error.details.backend === "string" ? error.details.backend : "terminal backend"
    const binary = typeof error.details.binary === "string" ? error.details.binary : backend
    const suggestion =
      backend === "wezterm"
        ? [
            "",
            `${backend} is required but not installed.`,
            "Install wezterm using your package manager:",
            "  - macOS: brew install --cask wezterm",
            "  - Ubuntu/Debian: sudo apt-get install wezterm",
            "  - Fedora: sudo dnf install wezterm",
          ].join("\n")
        : ""
    return `\nMissing binary: ${binary}${suggestion}`
  },
  [ErrorCodes.WEZTERM_NOT_FOUND]: () => {
    return (
      "\nwezterm command was not found.\n" +
      "Install wezterm using your package manager:\n" +
      "  - macOS: brew install --cask wezterm\n" +
      "  - Ubuntu/Debian: sudo apt-get install wezterm\n" +
      "  - Fedora: sudo dnf install wezterm\n"
    )
  },
  [ErrorCodes.UNSUPPORTED_WEZTERM_VERSION]: (error) => {
    const requiredVersion = typeof error.details.requiredVersion === "string" ? error.details.requiredVersion : ""
    const detected = typeof error.details.detectedVersion === "string" ? error.details.detectedVersion : ""
    const lines = ["", "Unsupported wezterm version detected."]
    if (detected) {
      lines.push(`Detected version: ${detected}`)
    }
    if (requiredVersion) {
      lines.push(`Required version: ${requiredVersion} or higher`)
    }
    return lines.join("\n")
  },
  [ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED]: (error) => {
    const paneId = typeof error.details.paneId === "string" ? error.details.paneId : ""
    const paneCells = typeof error.details.paneCells === "number" ? String(error.details.paneCells) : ""
    const detected = typeof error.details.detectedVersion === "string" ? error.details.detectedVersion : ""
    const required = typeof error.details.requiredVersion === "string" ? error.details.requiredVersion : ""
    const lines = ["", "Unable to resolve split size from pane dimensions."]
    if (paneId) {
      lines.push(`Pane ID: ${paneId}`)
    }
    if (paneCells) {
      lines.push(`Pane cells: ${paneCells}`)
    }
    if (detected) {
      lines.push(`Detected version: ${detected}`)
    }
    if (required) {
      lines.push(`Required version: ${required}`)
    }
    return lines.join("\n")
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
