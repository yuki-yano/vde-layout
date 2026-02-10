import { Chalk } from "chalk"
import { execa } from "execa"
import stringWidth from "string-width"
import * as YAML from "yaml"
import type { PresetManager } from "../contracts"
import type { Preset, PresetInfo } from "../models/types"
import type { Logger } from "../utils/logger"
import { createEnvironmentError, ErrorCodes } from "../utils/errors"
import type { SelectSurfaceMode, SelectUiMode } from "./select-args"

const FZF_BINARY = "fzf"
const FZF_CHECK_TIMEOUT_MS = 5_000
const MAX_PREVIEW_BASE64_LENGTH = 64 * 1024
const RESERVED_FZF_ARGS = new Set(["delimiter", "with-nth", "ansi", "preview", "preview-window", "tmux"])
const selectorChalk = new Chalk({ level: 1 })

type ExecaLikeError = Error & {
  readonly code?: string
  readonly exitCode?: number
  readonly timedOut?: boolean
}

type RunFzfInput = {
  readonly args: string[]
  readonly input: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

type RunFzfResult = {
  readonly stdout: string
}

export type SelectPresetResult =
  | {
      readonly status: "selected"
      readonly presetName: string
    }
  | {
      readonly status: "cancelled"
    }

export type SelectPresetInput = {
  readonly uiMode: SelectUiMode
  readonly surfaceMode: SelectSurfaceMode
  readonly tmuxPopupOptions?: string
  readonly fzfExtraArgs?: ReadonlyArray<string>
  readonly presetManager: PresetManager
  readonly logger: Logger
  readonly skipLoadConfig?: boolean
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly isInteractive?: () => boolean
  readonly checkFzfAvailability?: () => Promise<boolean>
  readonly runFzf?: (input: RunFzfInput) => Promise<RunFzfResult>
}

type PresetRow = {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly display: string
  readonly previewBase64: string
}

type BuildPresetPreviewYamlInput = {
  readonly presetKey: string
  readonly preset: Preset
}

const sanitizeTsvCell = (value: string | undefined): string => {
  return (value ?? "").replace(/[\t\r\n]+/g, " ")
}

const padDisplayCell = (value: string, width: number): string => {
  const paddingLength = Math.max(0, width - stringWidth(value))
  return `${value}${" ".repeat(paddingLength)}`
}

export const buildPresetPreviewYaml = ({ presetKey, preset }: BuildPresetPreviewYamlInput): string => {
  return YAML.stringify({
    presets: {
      [presetKey]: preset,
    },
  })
}

const defaultCheckFzfAvailability = async (): Promise<boolean> => {
  try {
    await execa(FZF_BINARY, ["--version"], {
      timeout: FZF_CHECK_TIMEOUT_MS,
    })
    return true
  } catch (error) {
    const execaError = error as ExecaLikeError
    if (
      execaError.code === "ENOENT" ||
      execaError.code === "ETIMEDOUT" ||
      execaError.code === "ERR_EXECA_TIMEOUT" ||
      execaError.timedOut === true
    ) {
      return false
    }
    throw error
  }
}

const defaultRunFzf = async ({ args, input, cwd, env }: RunFzfInput): Promise<RunFzfResult> => {
  const result = await execa(FZF_BINARY, args, {
    input,
    cwd,
    env,
    stderr: "inherit",
  })
  return { stdout: result.stdout }
}

const ensureFzfAvailable = async (checkFzfAvailability: () => Promise<boolean>): Promise<void> => {
  const available = await checkFzfAvailability()
  if (available) {
    return
  }

  throw createEnvironmentError("fzf is required for preset selection UI", ErrorCodes.BACKEND_NOT_FOUND, {
    backend: "fzf",
    binary: FZF_BINARY,
  })
}

const isTmuxSession = (env: NodeJS.ProcessEnv): boolean => {
  return typeof env.TMUX === "string" && env.TMUX.length > 0
}

const resolveSurfaceMode = ({
  surfaceMode,
  env,
}: {
  readonly surfaceMode: SelectSurfaceMode
  readonly env: NodeJS.ProcessEnv
}): Exclude<SelectSurfaceMode, "auto"> => {
  if (surfaceMode === "auto") {
    return isTmuxSession(env) ? "tmux-popup" : "inline"
  }
  return surfaceMode
}

const validateExtraFzfArgs = (fzfExtraArgs: ReadonlyArray<string>): void => {
  for (const arg of fzfExtraArgs) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error("Empty value is not allowed for --fzf-arg")
    }

    if (!arg.startsWith("--")) {
      continue
    }

    const withoutPrefix = arg.slice(2)
    if (withoutPrefix.length === 0) {
      continue
    }
    const optionName = withoutPrefix.split("=")[0]
    if (optionName !== undefined && RESERVED_FZF_ARGS.has(optionName)) {
      throw new Error(`--fzf-arg cannot override reserved fzf option: --${optionName}`)
    }
  }
}

const buildFzfArgs = ({
  surfaceMode,
  tmuxPopupOptions,
  fzfExtraArgs,
  env,
}: {
  readonly surfaceMode: SelectSurfaceMode
  readonly tmuxPopupOptions: string | undefined
  readonly fzfExtraArgs: ReadonlyArray<string>
  readonly env: NodeJS.ProcessEnv
}): string[] => {
  validateExtraFzfArgs(fzfExtraArgs)

  const resolvedSurfaceMode = resolveSurfaceMode({
    surfaceMode,
    env,
  })

  if (resolvedSurfaceMode === "tmux-popup" && isTmuxSession(env) !== true) {
    throw new Error("tmux popup selector surface requires running inside tmux")
  }

  const surfaceArgs =
    resolvedSurfaceMode === "tmux-popup"
      ? [tmuxPopupOptions !== undefined ? `--tmux=${tmuxPopupOptions}` : "--tmux"]
      : []

  return [
    "--delimiter=\\t",
    "--ansi",
    "--with-nth=2",
    "--prompt=preset> ",
    "--layout=reverse",
    "--height=80%",
    "--border",
    '--preview=node -e \'process.stdout.write(Buffer.from(process.argv[1], "base64").toString("utf8"))\' {3}',
    "--preview-window=right,60%,border-left,wrap",
    ...surfaceArgs,
    ...fzfExtraArgs,
  ]
}

const toPresetRows = ({
  presetInfos,
  presetManager,
}: {
  readonly presetInfos: ReadonlyArray<PresetInfo>
  readonly presetManager: PresetManager
}): ReadonlyArray<PresetRow> => {
  const rows = presetInfos.map((presetInfo) => {
    const key = sanitizeTsvCell(presetInfo.key)
    const name = sanitizeTsvCell(presetInfo.name)
    const description = sanitizeTsvCell(presetInfo.description)
    const preset = presetManager.getPreset(presetInfo.key)
    const previewYaml = buildPresetPreviewYaml({
      presetKey: presetInfo.key,
      preset,
    })
    const previewBase64 = Buffer.from(previewYaml, "utf8").toString("base64")
    if (previewBase64.length > MAX_PREVIEW_BASE64_LENGTH) {
      throw new Error(
        `Preset preview is too large for fzf inline preview payload: "${presetInfo.key}" (${previewBase64.length} bytes)`,
      )
    }
    return {
      key,
      name,
      description,
      previewBase64,
    }
  })

  const keyColumnWidth = rows.reduce((maxWidth, row) => Math.max(maxWidth, stringWidth(row.key)), 0)
  const nameColumnWidth = rows.reduce((maxWidth, row) => Math.max(maxWidth, stringWidth(row.name)), 0)

  return rows.map((row) => {
    const key = padDisplayCell(row.key, keyColumnWidth)
    const name = padDisplayCell(row.name, nameColumnWidth)
    const description = row.description.length > 0 ? row.description : selectorChalk.gray("(no description)")
    const display = `${selectorChalk.cyan(key)}  ${selectorChalk.bold(name)}  ${selectorChalk.dim(description)}`

    return {
      key: row.key,
      name: row.name,
      description: row.description,
      display,
      previewBase64: row.previewBase64,
    }
  })
}

const buildFzfInput = (rows: ReadonlyArray<PresetRow>): string => {
  return rows
    .map((row, index) => {
      return [String(index), row.display, row.previewBase64].join("\t")
    })
    .join("\n")
}

const parseSelectedPresetName = ({
  selectedLine,
  rows,
}: {
  readonly selectedLine: string
  readonly rows: ReadonlyArray<PresetRow>
}): string | null => {
  const trimmed = selectedLine.trim()
  if (trimmed.length === 0) {
    return null
  }

  const idCell = trimmed.split("\t")[0]
  const id = Number(idCell)
  if (!Number.isInteger(id) || id < 0 || id >= rows.length) {
    throw new Error("Invalid selection returned from fzf")
  }

  return rows[id]?.key ?? null
}

const runFzfSelector = async ({
  rows,
  fzfArgs,
  runFzf,
  cwd,
  env,
}: {
  readonly rows: ReadonlyArray<PresetRow>
  readonly fzfArgs: ReadonlyArray<string>
  readonly runFzf: (input: RunFzfInput) => Promise<RunFzfResult>
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}): Promise<SelectPresetResult> => {
  try {
    const result = await runFzf({
      input: buildFzfInput(rows),
      args: [...fzfArgs],
      cwd,
      env,
    })

    const presetName = parseSelectedPresetName({
      selectedLine: result.stdout,
      rows,
    })
    if (presetName === null) {
      return { status: "cancelled" }
    }

    return {
      status: "selected",
      presetName,
    }
  } catch (error) {
    const execaError = error as ExecaLikeError
    if (execaError.exitCode === 130) {
      return { status: "cancelled" }
    }
    throw error
  }
}

export const selectPreset = async ({
  uiMode,
  surfaceMode,
  tmuxPopupOptions,
  fzfExtraArgs = [],
  presetManager,
  logger,
  skipLoadConfig = false,
  cwd = process.cwd(),
  env = process.env,
  isInteractive = (): boolean =>
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.stderr.isTTY === true,
  checkFzfAvailability = defaultCheckFzfAvailability,
  runFzf = defaultRunFzf,
}: SelectPresetInput): Promise<SelectPresetResult> => {
  if (isInteractive() !== true) {
    throw new Error("Preset selection requires an interactive terminal")
  }

  await ensureFzfAvailable(checkFzfAvailability)
  if (skipLoadConfig !== true) {
    await presetManager.loadConfig()
  }

  const presetInfos = presetManager.listPresets()
  if (presetInfos.length === 0) {
    throw new Error("No presets defined")
  }

  const fzfArgs = buildFzfArgs({
    surfaceMode,
    tmuxPopupOptions,
    fzfExtraArgs,
    env,
  })

  logger.debug(`Preset selection UI: ${uiMode}`)

  const rows = toPresetRows({
    presetInfos,
    presetManager,
  })
  return runFzfSelector({
    rows,
    fzfArgs,
    runFzf,
    cwd,
    env,
  })
}
