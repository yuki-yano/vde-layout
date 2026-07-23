import { execa } from "execa"
import { createCoreError, type CoreError } from "../../core/errors"
import { createEnvironmentError, ErrorCodes } from "../../utils/errors"

const HERDR_BINARY = "herdr"
export const HERDR_MINIMUM_VERSION = "0.7.4"
const VERSION_REGEX = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/

type ExecaLikeError = Error & {
  readonly exitCode?: number
  readonly code?: string
  readonly stderr?: string
}

type HerdrResponse = {
  readonly result?: Readonly<Record<string, unknown>>
}

export type HerdrPaneInfo = {
  readonly pane_id: string
  readonly workspace_id: string
  readonly tab_id: string
  readonly focused: boolean
}

export type HerdrPaneLayout = {
  readonly workspace_id: string
  readonly tab_id: string
  readonly panes: ReadonlyArray<{
    readonly pane_id: string
    readonly rect: {
      readonly width: number
      readonly height: number
    }
  }>
}

export type RunHerdrErrorContext = {
  readonly message: string
  readonly path?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export const verifyHerdrAvailability = async (): Promise<{ version: string }> => {
  let stdout: string
  try {
    const result = await execa(HERDR_BINARY, ["--version"])
    stdout = result.stdout
  } catch (error) {
    const execaError = error as ExecaLikeError
    if (execaError.code === "ENOENT") {
      throw createEnvironmentError("herdr is not installed", ErrorCodes.BACKEND_NOT_FOUND, {
        backend: "herdr",
        binary: HERDR_BINARY,
      })
    }
    throw createEnvironmentError("Failed to execute herdr --version", ErrorCodes.HERDR_NOT_FOUND, {
      backend: "herdr",
      binary: HERDR_BINARY,
      stderr: execaError.stderr,
    })
  }

  const version = extractVersion(stdout)
  if (version === undefined || compareVersions(version, HERDR_MINIMUM_VERSION) < 0) {
    throw createEnvironmentError("Unsupported herdr version", ErrorCodes.UNSUPPORTED_HERDR_VERSION, {
      requiredVersion: HERDR_MINIMUM_VERSION,
      detectedVersion: version ?? stdout.trim(),
    })
  }
  return { version }
}

export const runHerdrCli = async (args: ReadonlyArray<string>, context: RunHerdrErrorContext): Promise<unknown> => {
  let stdout: string
  try {
    const result = await execa(HERDR_BINARY, [...args])
    stdout = result.stdout
  } catch (error) {
    const execaError = error as ExecaLikeError
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: context.message,
      path: context.path,
      details: {
        command: [HERDR_BINARY, ...args],
        stderr: execaError.stderr,
        exitCode: execaError.exitCode,
        backend: "herdr",
        ...(context.details ?? {}),
      },
    })
  }

  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw createCoreError("execution", {
      code: ErrorCodes.TERMINAL_COMMAND_FAILED,
      message: `Invalid herdr response: ${context.message}`,
      path: context.path,
      details: { command: [HERDR_BINARY, ...args], stdout, backend: "herdr" },
    })
  }
}

export const currentHerdrPane = async (paneId?: string): Promise<HerdrPaneInfo> => {
  const args = ["pane", "current"]
  if (paneId !== undefined && paneId.length > 0) {
    args.push("--pane", paneId)
  }
  return extractPane(await runHerdrCli(args, { message: "Failed to resolve current herdr pane" }), "pane")
}

export const listHerdrPanes = async (workspaceId: string): Promise<ReadonlyArray<HerdrPaneInfo>> => {
  const response = await runHerdrCli(["pane", "list", "--workspace", workspaceId], {
    message: "Failed to list herdr panes",
  })
  const panes = resultOf(response).panes
  if (!Array.isArray(panes) || !panes.every(isPaneInfo)) {
    throw invalidResponse("Herdr pane list response is missing panes", response)
  }
  return panes
}

export const createHerdrTab = async (options: {
  readonly workspaceId?: string
  readonly cwd: string
  readonly label?: string
}): Promise<{ readonly pane: HerdrPaneInfo; readonly tabId: string }> => {
  const args = ["tab", "create"]
  if (options.workspaceId !== undefined && options.workspaceId.length > 0) {
    args.push("--workspace", options.workspaceId)
  }
  args.push("--cwd", options.cwd)
  if (options.label !== undefined && options.label.length > 0) {
    args.push("--label", options.label)
  }
  args.push("--focus")
  const result = resultOf(await runHerdrCli(args, { message: "Failed to create herdr tab" }))
  const pane = result.root_pane
  const tab = result.tab
  if (!isPaneInfo(pane) || !isRecord(tab) || typeof tab.tab_id !== "string") {
    throw invalidResponse("Herdr tab creation response is missing tab metadata", result)
  }
  return { pane, tabId: tab.tab_id }
}

export const splitHerdrPane = async (options: {
  readonly paneId: string
  readonly direction: "right" | "down"
  readonly ratio: number
  readonly focus: boolean
}): Promise<HerdrPaneInfo> => {
  const response = await runHerdrCli(
    [
      "pane",
      "split",
      options.paneId,
      "--direction",
      options.direction,
      "--ratio",
      String(options.ratio),
      options.focus ? "--focus" : "--no-focus",
    ],
    { message: `Failed to split herdr pane ${options.paneId}`, path: options.paneId },
  )
  return extractPane(response, "pane")
}

export const getHerdrPaneLayout = async (paneId: string): Promise<HerdrPaneLayout> => {
  const response = await runHerdrCli(["pane", "layout", "--pane", paneId], {
    message: `Failed to resolve herdr pane layout for ${paneId}`,
    path: paneId,
  })
  const layout = resultOf(response).layout
  if (!isRecord(layout) || typeof layout.workspace_id !== "string" || typeof layout.tab_id !== "string") {
    throw invalidResponse("Herdr pane layout response is missing layout metadata", response)
  }
  const panes = layout.panes
  if (!Array.isArray(panes)) {
    throw invalidResponse("Herdr pane layout response is missing panes", response)
  }
  return layout as HerdrPaneLayout
}

export const closeHerdrPane = async (paneId: string): Promise<void> => {
  await runHerdrCli(["pane", "close", paneId], {
    message: `Failed to close herdr pane ${paneId}`,
    path: paneId,
  })
}

export const renameHerdrPane = async (paneId: string, title: string): Promise<void> => {
  await runHerdrCli(["pane", "rename", paneId, title], {
    message: `Failed to rename herdr pane ${paneId}`,
    path: paneId,
  })
}

export const runInHerdrPane = async (paneId: string, command: string): Promise<void> => {
  await runHerdrCli(["pane", "run", paneId, command], {
    message: `Failed to run command in herdr pane ${paneId}`,
    path: paneId,
  })
}

const resultOf = (response: unknown): Readonly<Record<string, unknown>> => {
  if (!isRecord(response) || !isRecord((response as HerdrResponse).result)) {
    throw invalidResponse("Herdr response is missing result", response)
  }
  return (response as HerdrResponse).result!
}

const extractPane = (response: unknown, field: string): HerdrPaneInfo => {
  const pane = resultOf(response)[field]
  if (!isPaneInfo(pane)) {
    throw invalidResponse(`Herdr response is missing ${field} metadata`, response)
  }
  return pane
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const isPaneInfo = (value: unknown): value is HerdrPaneInfo => {
  return (
    isRecord(value) &&
    typeof value.pane_id === "string" &&
    typeof value.workspace_id === "string" &&
    typeof value.tab_id === "string" &&
    typeof value.focused === "boolean"
  )
}

const invalidResponse = (message: string, response: unknown): CoreError => {
  return createCoreError("execution", {
    code: ErrorCodes.TERMINAL_COMMAND_FAILED,
    message,
    details: { response, backend: "herdr" },
  })
}

const extractVersion = (raw: string): string | undefined => {
  const match = raw.match(VERSION_REGEX)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return undefined
  }
  return `${match[1]}.${match[2]}.${match[3]}`
}

const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}
