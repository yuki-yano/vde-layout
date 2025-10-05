import { parse } from "yaml"

export interface CompilePresetInput {
  readonly document: string
  readonly source: string
}

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export interface StructuredError {
  readonly code: string
  readonly message: string
  readonly source?: string
  readonly path?: string
  readonly details?: Record<string, unknown>
}

export interface FunctionalTerminalPane {
  readonly kind: "terminal"
  readonly name: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly focus?: boolean
  readonly options?: Readonly<Record<string, unknown>>
}

export interface FunctionalSplitPane {
  readonly kind: "split"
  readonly orientation: "horizontal" | "vertical"
  readonly ratio: ReadonlyArray<number>
  readonly panes: ReadonlyArray<FunctionalLayoutNode>
}

export type FunctionalLayoutNode = FunctionalTerminalPane | FunctionalSplitPane

export interface FunctionalPresetMetadata {
  readonly source: string
}

export interface FunctionalPreset {
  readonly name: string
  readonly version: string
  readonly command?: string
  readonly layout?: FunctionalLayoutNode
  readonly metadata: FunctionalPresetMetadata
}

export interface CompilePresetSuccess {
  readonly preset: FunctionalPreset
}

export const compilePreset = (input: CompilePresetInput): Result<CompilePresetSuccess, StructuredError> => {
  const { document, source } = input

  let parsed: unknown
  try {
    parsed = parse(document)
  } catch (error) {
    return fail("PRESET_PARSE_ERROR", {
      source,
      message: `YAMLの解析に失敗しました: ${(error as Error).message}`,
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    })
  }

  if (!isRecord(parsed)) {
    return fail("PRESET_INVALID_DOCUMENT", {
      source,
      message: "プリセット定義がオブジェクトではありません",
      path: "preset",
    })
  }

  const name = typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : "Unnamed preset"

  let layout: FunctionalLayoutNode | undefined
  if ("layout" in parsed && parsed.layout !== undefined) {
    const converted = convertLayoutNode(parsed.layout, {
      source,
      path: "preset.layout",
    })
    if (!converted.ok) {
      return converted
    }
    layout = converted.value
  }

  return success({
    preset: {
      name,
      version: "legacy",
      command: typeof parsed.command === "string" ? parsed.command : undefined,
      layout,
      metadata: {
        source,
      },
    },
  })
}

const convertLayoutNode = (
  node: unknown,
  context: { readonly source: string; readonly path: string },
): Result<FunctionalLayoutNode, StructuredError> => {
  if (isRecord(node) && typeof node.type === "string" && "panes" in node) {
    return convertSplitPane(node, context)
  }

  if (isRecord(node) && typeof node.name === "string") {
    return success(asTerminalPane(node))
  }

  return fail("LAYOUT_INVALID_NODE", {
    source: context.source,
    message: "レイアウトノードの形式が不正です",
    path: context.path,
    details: {
      node,
    },
  })
}

const convertSplitPane = (
  node: Record<string, unknown>,
  context: { readonly source: string; readonly path: string },
): Result<FunctionalLayoutNode, StructuredError> => {
  const orientation = node.type
  if (orientation !== "horizontal" && orientation !== "vertical") {
    return fail("LAYOUT_INVALID_ORIENTATION", {
      source: context.source,
      message: "layout.type は horizontal か vertical である必要があります",
      path: `${context.path}.type`,
      details: {
        type: orientation,
      },
    })
  }

  if (!Array.isArray(node.panes) || node.panes.length === 0) {
    return fail("LAYOUT_PANES_MISSING", {
      source: context.source,
      message: "panes 配列が存在しません",
      path: `${context.path}.panes`,
    })
  }

  if (!Array.isArray(node.ratio) || node.ratio.length === 0) {
    return fail("LAYOUT_RATIO_MISSING", {
      source: context.source,
      message: "ratio 配列が存在しません",
      path: `${context.path}.ratio`,
    })
  }

  if (node.ratio.length !== node.panes.length) {
    return fail("LAYOUT_RATIO_MISMATCH", {
      source: context.source,
      message: "ratio 配列と panes 配列の長さが一致しません",
      path: context.path,
      details: {
        ratioLength: node.ratio.length,
        panesLength: node.panes.length,
      },
    })
  }

  const ratio: number[] = []
  for (let index = 0; index < node.ratio.length; index += 1) {
    const value = node.ratio[index]
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return fail("RATIO_INVALID_VALUE", {
        source: context.source,
        message: "ratio の値が正の数値ではありません",
        path: `${context.path}.ratio[${index}]`,
        details: {
          value,
        },
      })
    }
    ratio.push(value)
  }

  const panes: FunctionalLayoutNode[] = []
  for (let index = 0; index < node.panes.length; index += 1) {
    const childContext = {
      source: context.source,
      path: `${context.path}.panes[${index}]`,
    }
    const converted = convertLayoutNode(node.panes[index], childContext)
    if (!converted.ok) {
      return converted
    }
    panes.push(converted.value)
  }

  return success({
    kind: "split",
    orientation,
    ratio,
    panes,
  })
}

const asTerminalPane = (node: Record<string, unknown>): FunctionalTerminalPane => {
  const name = typeof node.name === "string" ? node.name : ""
  const command = typeof node.command === "string" ? node.command : undefined
  const cwd = typeof node.cwd === "string" ? node.cwd : undefined
  const focus = node.focus === true
  const env = normalizeEnv(node.env)

  const knownKeys = new Set(["name", "command", "cwd", "env", "focus", "options", "title", "delay"])
  const options = collectOptions(node, knownKeys)

  return {
    kind: "terminal",
    name,
    command,
    cwd,
    env,
    focus: focus || undefined,
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

const success = <T>(value: T): Result<T, StructuredError> => ({
  ok: true,
  value,
})

const fail = (
  code: string,
  error: {
    readonly message: string
    readonly source?: string
    readonly path?: string
    readonly details?: Record<string, unknown>
  },
): Result<never, StructuredError> => ({
  ok: false,
  error: {
    code,
    message: error.message,
    source: error.source,
    path: error.path,
    details: error.details,
  },
})
