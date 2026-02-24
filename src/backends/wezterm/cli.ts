import { execa } from "execa"
import { createEnvironmentError, ErrorCodes } from "../../utils/errors"
import { createCoreError } from "../../core/errors"
import { parseWeztermListResult, type WeztermListResult } from "./list-parser"

export type { WeztermListResult } from "./list-parser"

const WEZTERM_BINARY = "wezterm"
export const WEZTERM_MINIMUM_VERSION = "20220624-141144-bd1b7c5d"
const VERSION_REGEX = /(\d{8})-(\d{6})-([0-9a-fA-F]+)/i

type ExecaLikeError = Error & {
  readonly exitCode?: number
  readonly code?: string
  readonly stderr?: string
  readonly stdout?: string
}

export const verifyWeztermAvailability = async (): Promise<{ version: string }> => {
  let stdout: string
  try {
    const result = await execa(WEZTERM_BINARY, ["--version"])
    stdout = result.stdout
  } catch (error) {
    const execaError = error as ExecaLikeError
    if (execaError.code === "ENOENT") {
      throw createEnvironmentError("wezterm is not installed", ErrorCodes.BACKEND_NOT_FOUND, {
        backend: "wezterm",
        binary: WEZTERM_BINARY,
      })
    }
    throw createEnvironmentError("Failed to execute wezterm --version", ErrorCodes.WEZTERM_NOT_FOUND, {
      backend: "wezterm",
      binary: WEZTERM_BINARY,
      stderr: execaError.stderr,
    })
  }

  const detectedVersion = extractVersion(stdout)
  if (detectedVersion === undefined) {
    throw createEnvironmentError("Unable to determine wezterm version", ErrorCodes.UNSUPPORTED_WEZTERM_VERSION, {
      requiredVersion: WEZTERM_MINIMUM_VERSION,
      detectedVersion: stdout.trim(),
    })
  }

  if (!isVersionSupported(detectedVersion, WEZTERM_MINIMUM_VERSION)) {
    throw createEnvironmentError("Unsupported wezterm version", ErrorCodes.UNSUPPORTED_WEZTERM_VERSION, {
      requiredVersion: WEZTERM_MINIMUM_VERSION,
      detectedVersion,
    })
  }

  return { version: detectedVersion }
}

export type RunWeztermErrorContext = {
  readonly message: string
  readonly path?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export const runWeztermCli = async (args: string[], errorContext: RunWeztermErrorContext): Promise<string> => {
  try {
    const result = await execa(WEZTERM_BINARY, ["cli", ...args])
    return result.stdout
  } catch (error) {
    const execaError = error as ExecaLikeError
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: errorContext.message,
      path: errorContext.path,
      details: {
        command: [WEZTERM_BINARY, "cli", ...args],
        stderr: execaError.stderr,
        exitCode: execaError.exitCode,
        backend: "wezterm",
        ...(errorContext.details ?? {}),
      },
    })
  }
}

export const listWeztermWindows = async (): Promise<WeztermListResult> => {
  const stdout = await runWeztermCli(["list", "--format", "json"], { message: "Failed to list wezterm panes" })
  const result = parseWeztermListResult(stdout)
  if (result === undefined) {
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: "Invalid wezterm list output",
      details: { stdout },
    })
  }
  return result
}

export const killWeztermPane = async (paneId: string): Promise<void> => {
  await runWeztermCli(["kill-pane", "--pane-id", paneId], {
    message: `Failed to kill wezterm pane ${paneId}`,
    path: paneId,
  })
}

const extractVersion = (raw: string): string | undefined => {
  const match = raw.match(VERSION_REGEX)
  if (!match) {
    return undefined
  }
  const date = match[1]
  const time = match[2]
  const commit = match[3]
  if (date === undefined || time === undefined || commit === undefined) {
    return undefined
  }
  return `${date}-${time}-${commit.toLowerCase()}`
}

const isVersionSupported = (detected: string, minimum: string): boolean => {
  const parse = (version: string): { build: number; commit: string } | undefined => {
    const match = version.match(VERSION_REGEX)
    if (!match) {
      return undefined
    }
    const date = match[1]
    const time = match[2]
    const commit = match[3]
    if (date === undefined || time === undefined || commit === undefined) {
      return undefined
    }
    const build = Number(`${date}${time}`)
    if (Number.isNaN(build)) {
      return undefined
    }
    return { build, commit: commit.toLowerCase() }
  }

  const detectedInfo = parse(detected)
  const minimumInfo = parse(minimum)
  if (detectedInfo === undefined || minimumInfo === undefined) {
    return false
  }

  if (detectedInfo.build > minimumInfo.build) {
    return true
  }
  if (detectedInfo.build < minimumInfo.build) {
    return false
  }

  return detectedInfo.commit >= minimumInfo.commit
}
