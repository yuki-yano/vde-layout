import { parse } from "yaml"
import { createFunctionalError, type FunctionalCoreError } from "./errors.ts"

export type CompilePresetInput = {
  readonly document: string
  readonly source: string
}

export type FunctionalTerminalPane = {
  readonly kind: "terminal"
  readonly name: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly focus?: boolean
  readonly ephemeral?: boolean
  readonly closeOnError?: boolean
  readonly options?: Readonly<Record<string, unknown>>
}

export type FunctionalSplitPane = {
  readonly kind: "split"
  readonly orientation: "horizontal" | "vertical"
  readonly ratio: ReadonlyArray<number>
  readonly panes: ReadonlyArray<FunctionalLayoutNode>
}

export type FunctionalLayoutNode = FunctionalTerminalPane | FunctionalSplitPane

type FunctionalPresetMetadata = {
  readonly source: string
}

export type FunctionalPreset = {
  readonly name: string
  readonly version: string
  readonly command?: string
  readonly layout?: FunctionalLayoutNode
  readonly metadata: FunctionalPresetMetadata
}

export type CompilePresetSuccess = {
  readonly preset: FunctionalPreset
}

export const compilePreset = ({ document, source }: CompilePresetInput): CompilePresetSuccess => {
  let parsed: unknown
  try {
    parsed = parse(document)
  } catch (error) {
    throw compileError("PRESET_PARSE_ERROR", {
      source,
      message: `YAMLの解析に失敗しました: ${(error as Error).message}`,
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    })
  }

  if (!isRecord(parsed)) {
    throw compileError("PRESET_INVALID_DOCUMENT", {
      source,
      message: "プリセット定義がオブジェクトではありません",
      path: "preset",
    })
  }

  const name = typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : "Unnamed preset"

  const layout = parseLayoutNode(parsed.layout, {
    source,
    path: "preset.layout",
  })

  return {
    preset: {
      name,
      version: "legacy",
      command: typeof parsed.command === "string" ? parsed.command : undefined,
      layout: layout ?? undefined,
      metadata: { source },
    },
  }
}

const parseLayoutNode = (
  node: unknown,
  context: { readonly source: string; readonly path: string },
): FunctionalLayoutNode | null => {
  if (node === undefined || node === null) {
    return null
  }

  if (!isRecord(node)) {
    throw compileError("LAYOUT_INVALID_NODE", {
      source: context.source,
      message: "レイアウトノードの形式が不正です",
      path: context.path,
      details: { node },
    })
  }

  if (typeof node.type === "string" && Array.isArray(node.panes)) {
    return parseSplitPane(node, context)
  }

  if (typeof node.name === "string") {
    return parseTerminalPane(node)
  }

  throw compileError("LAYOUT_INVALID_NODE", {
    source: context.source,
    message: "レイアウトノードの形式が不正です",
    path: context.path,
    details: { node },
  })
}

const parseSplitPane = (
  node: Record<string, unknown>,
  context: { readonly source: string; readonly path: string },
): FunctionalSplitPane => {
  const orientation = node.type
  if (orientation !== "horizontal" && orientation !== "vertical") {
    throw compileError("LAYOUT_INVALID_ORIENTATION", {
      source: context.source,
      message: "layout.type は horizontal か vertical である必要があります",
      path: `${context.path}.type`,
      details: { type: orientation },
    })
  }

  if (!Array.isArray(node.panes) || node.panes.length === 0) {
    throw compileError("LAYOUT_PANES_MISSING", {
      source: context.source,
      message: "panes 配列が存在しません",
      path: `${context.path}.panes`,
    })
  }

  if (!Array.isArray(node.ratio) || node.ratio.length === 0) {
    throw compileError("LAYOUT_RATIO_MISSING", {
      source: context.source,
      message: "ratio 配列が存在しません",
      path: `${context.path}.ratio`,
    })
  }

  if (node.ratio.length !== node.panes.length) {
    throw compileError("LAYOUT_RATIO_MISMATCH", {
      source: context.source,
      message: "ratio 配列と panes 配列の長さが一致しません",
      path: context.path,
      details: {
        ratioLength: node.ratio.length,
        panesLength: node.panes.length,
      },
    })
  }

  const ratio = node.ratio.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw compileError("RATIO_INVALID_VALUE", {
        source: context.source,
        message: "ratio の値が正の数値ではありません",
        path: `${context.path}.ratio[${index}]`,
        details: { value },
      })
    }
    return value
  })

  const panes = node.panes.map((child, index) =>
    parseLayoutNode(child, {
      source: context.source,
      path: `${context.path}.panes[${index}]`,
    }),
  )

  return {
    kind: "split",
    orientation,
    ratio,
    panes: panes.filter((pane): pane is FunctionalLayoutNode => pane !== null),
  }
}

const parseTerminalPane = (node: Record<string, unknown>): FunctionalTerminalPane => {
  const name = typeof node.name === "string" ? node.name : ""
  const command = typeof node.command === "string" ? node.command : undefined
  const cwd = typeof node.cwd === "string" ? node.cwd : undefined
  const focus = node.focus === true ? true : undefined
  const ephemeral = node.ephemeral === true ? true : undefined
  const closeOnError = node.closeOnError === true ? true : undefined
  const env = normalizeEnv(node.env)

  const knownKeys = new Set([
    "name",
    "command",
    "cwd",
    "env",
    "focus",
    "ephemeral",
    "closeOnError",
    "options",
    "title",
    "delay",
  ])
  const options = collectOptions(node, knownKeys)

  return {
    kind: "terminal",
    name,
    command,
    cwd,
    env,
    focus,
    ephemeral,
    closeOnError,
    options,
  }
}

const normalizeEnv = (env: unknown): Readonly<Record<string, string>> | undefined => {
  if (!isRecord(env)) {
    return undefined
  }

  const entries = Object.entries(env).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (typeof value === "string") {
      accumulator[key] = value
    }
    return accumulator
  }, {})

  return Object.keys(entries).length > 0 ? entries : undefined
}

const collectOptions = (
  node: Record<string, unknown>,
  excludedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> | undefined => {
  const optionsEntries = Object.entries(node).filter(([key]) => !excludedKeys.has(key))
  if (optionsEntries.length === 0) {
    return undefined
  }

  return optionsEntries.reduce<Record<string, unknown>>((accumulator, [key, value]) => {
    accumulator[key] = value
    return accumulator
  }, {})
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

const compileError = (
  code: string,
  error: {
    readonly source?: string
    readonly message: string
    readonly path?: string
    readonly details?: Readonly<Record<string, unknown>>
  },
): FunctionalCoreError => {
  return createFunctionalError("compile", {
    code,
    message: error.message,
    source: error.source,
    path: error.path,
    details: error.details,
  })
}
