import { parse } from "yaml"
import { z } from "zod"
import { LayoutSchema } from "../models/schema"
import { createCoreError, type CoreError } from "./errors"

export type CompilePresetInput = {
  readonly document: string
  readonly source: string
}

export type CompilePresetFromValueInput = {
  readonly value: unknown
  readonly source: string
}

export type CompiledTerminalPane = {
  readonly kind: "terminal"
  readonly name: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly delay?: number
  readonly title?: string
  readonly focus?: boolean
  readonly ephemeral?: boolean
  readonly closeOnError?: boolean
  readonly options?: Readonly<Record<string, unknown>>
}

export type CompiledRatioEntry =
  | { readonly kind: "weight"; readonly weight: number }
  | { readonly kind: "fixed-cells"; readonly cells: number }

export type CompiledSplitPane = {
  readonly kind: "split"
  readonly orientation: "horizontal" | "vertical"
  readonly ratio: ReadonlyArray<CompiledRatioEntry>
  readonly panes: ReadonlyArray<CompiledLayoutNode>
}

export type CompiledLayoutNode = CompiledTerminalPane | CompiledSplitPane

type CompiledPresetMetadata = {
  readonly source: string
}

export type CompiledPreset = {
  readonly name: string
  readonly version: string
  readonly command?: string
  readonly layout?: CompiledLayoutNode
  readonly metadata: CompiledPresetMetadata
}

export type CompilePresetSuccess = {
  readonly preset: CompiledPreset
}

export const compilePreset = ({ document, source }: CompilePresetInput): CompilePresetSuccess => {
  let parsed: unknown
  try {
    parsed = parse(document)
  } catch (error) {
    throw compileError("PRESET_PARSE_ERROR", {
      source,
      message: `Failed to parse YAML: ${(error as Error).message}`,
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    })
  }

  return compilePresetValue({ value: parsed, source })
}

export const compilePresetFromValue = ({ value, source }: CompilePresetFromValueInput): CompilePresetSuccess => {
  return compilePresetValue({ value, source })
}

const FIXED_RATIO_PATTERN = /^([1-9][0-9]*)c$/

const compilePresetValue = ({ value, source }: CompilePresetFromValueInput): CompilePresetSuccess => {
  const parsed = value

  if (!isRecord(parsed)) {
    throw compileError("PRESET_INVALID_DOCUMENT", {
      source,
      message: "Preset definition is not an object",
      path: "preset",
    })
  }

  const name = typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : "Unnamed preset"
  const validatedLayout = validateLayoutDefinition(parsed.layout, {
    source,
    path: "preset.layout",
  })

  const layout = parseLayoutNode(validatedLayout, {
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

const validateLayoutDefinition = (
  layout: unknown,
  context: { readonly source: string; readonly path: string },
): unknown => {
  if (layout === undefined || layout === null) {
    return layout
  }

  if (!isRecord(layout) || !looksSplitLikeNode(layout)) {
    return layout
  }

  const normalizedLayout = sanitizeLayoutForSchemaValidation(layout)
  const validated = LayoutSchema.safeParse(normalizedLayout)
  if (validated.success) {
    return layout
  }

  const issue = validated.error.issues[0]
  if (!issue) {
    throw compileError("LAYOUT_INVALID_NODE", {
      source: context.source,
      message: "Layout node is invalid",
      path: context.path,
      details: { layout },
    })
  }

  throw convertLayoutIssueToCompileError({
    issue,
    source: context.source,
    basePath: context.path,
    layout,
  })
}

const parseLayoutNode = (
  node: unknown,
  context: { readonly source: string; readonly path: string },
): CompiledLayoutNode | null => {
  if (node === undefined || node === null) {
    return null
  }

  if (!isRecord(node)) {
    throw compileError("LAYOUT_INVALID_NODE", {
      source: context.source,
      message: "Layout node is invalid",
      path: context.path,
      details: { node },
    })
  }

  if ("type" in node || "ratio" in node || "panes" in node) {
    return parseSplitPane(node, context)
  }

  if (typeof node.name === "string") {
    return parseTerminalPane(node)
  }

  throw compileError("LAYOUT_INVALID_NODE", {
    source: context.source,
    message: "Layout node is invalid",
    path: context.path,
    details: { node },
  })
}

const parseSplitPane = (
  node: Record<string, unknown>,
  context: { readonly source: string; readonly path: string },
): CompiledSplitPane => {
  const orientation = node.type
  const panesInput = node.panes
  const ratioInput = node.ratio
  if (
    (orientation !== "horizontal" && orientation !== "vertical") ||
    !Array.isArray(panesInput) ||
    !Array.isArray(ratioInput)
  ) {
    throw compileError("LAYOUT_INVALID_NODE", {
      source: context.source,
      message: "Layout node is invalid",
      path: context.path,
      details: { node },
    })
  }

  const panes = panesInput.map((child, index) =>
    parseLayoutNode(child, {
      source: context.source,
      path: `${context.path}.panes[${index}]`,
    }),
  )
  const ratio = ratioInput.map(
    (value, index): CompiledRatioEntry =>
      parseRatioEntry(value, {
        source: context.source,
        path: `${context.path}.ratio[${index}]`,
      }),
  )

  if (!ratio.some((entry) => entry.kind === "weight")) {
    throw compileError("RATIO_WEIGHT_MISSING", {
      source: context.source,
      message: "ratio must include at least one numeric weight",
      path: `${context.path}.ratio`,
      details: { ratio: ratioInput },
    })
  }

  return {
    kind: "split",
    orientation,
    ratio,
    panes: panes.filter((pane): pane is CompiledLayoutNode => pane !== null),
  }
}

const parseRatioEntry = (
  value: unknown,
  context: { readonly source: string; readonly path: string },
): CompiledRatioEntry => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return {
      kind: "weight",
      weight: value,
    }
  }

  if (typeof value === "string") {
    const match = value.match(FIXED_RATIO_PATTERN)
    if (match?.[1] !== undefined) {
      const parsed = Number(match[1])
      if (Number.isInteger(parsed) && parsed > 0) {
        return {
          kind: "fixed-cells",
          cells: parsed,
        }
      }
    }
  }

  throw compileError("RATIO_INVALID_VALUE", {
    source: context.source,
    message: 'ratio value must be a positive number or "<positive-integer>c"',
    path: context.path,
    details: { value },
  })
}

const parseTerminalPane = (node: Record<string, unknown>): CompiledTerminalPane => {
  const name = typeof node.name === "string" ? node.name : ""
  const command = typeof node.command === "string" ? node.command : undefined
  const cwd = typeof node.cwd === "string" ? node.cwd : undefined
  const delay = typeof node.delay === "number" && Number.isFinite(node.delay) && node.delay > 0 ? node.delay : undefined
  const title = typeof node.title === "string" && node.title.length > 0 ? node.title : undefined
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
    delay,
    title,
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

const looksSplitLikeNode = (value: Record<string, unknown>): boolean => {
  return "type" in value || "ratio" in value || "panes" in value
}

const sanitizeLayoutForSchemaValidation = (node: unknown): unknown => {
  if (!isRecord(node)) {
    return node
  }

  if (looksSplitLikeNode(node)) {
    const panes = Array.isArray(node.panes)
      ? node.panes.map((child) => sanitizeLayoutForSchemaValidation(child))
      : node.panes
    return {
      type: node.type,
      ratio: node.ratio,
      panes,
    }
  }

  return {
    name: node.name,
    command: node.command,
    cwd: node.cwd,
    env: normalizeEnv(node.env),
    delay: node.delay,
    title: node.title,
    focus: node.focus,
    ephemeral: node.ephemeral,
    closeOnError: node.closeOnError,
  }
}

const convertLayoutIssueToCompileError = ({
  issue,
  source,
  basePath,
  layout,
}: {
  readonly issue: z.ZodIssue
  readonly source: string
  readonly basePath: string
  readonly layout: unknown
}): CoreError => {
  if (isMissingArrayIssue(issue, "panes")) {
    return compileError("LAYOUT_PANES_MISSING", {
      source,
      message: "panes array is missing or empty",
      path: `${basePath}.panes`,
    })
  }

  if (isMissingArrayIssue(issue, "ratio")) {
    return compileError("LAYOUT_RATIO_MISSING", {
      source,
      message: "ratio array is missing or empty",
      path: `${basePath}.ratio`,
    })
  }

  if (issue.path.includes("type")) {
    return compileError("LAYOUT_INVALID_ORIENTATION", {
      source,
      message: "layout.type must be horizontal or vertical",
      path: `${basePath}.type`,
      details: {
        type: getValueAtPath(layout, issue.path),
      },
    })
  }

  if (issue.message.includes("Number of elements in ratio array does not match number of elements in panes array")) {
    return compileError("LAYOUT_RATIO_MISMATCH", {
      source,
      message: "ratio and panes arrays must have the same length",
      path: basePath,
      details: getRatioLengthDetails(layout),
    })
  }

  if (issue.message.includes("ratio must include at least one numeric weight")) {
    const ratio = isRecord(layout) ? layout.ratio : undefined
    return compileError("RATIO_WEIGHT_MISSING", {
      source,
      message: "ratio must include at least one numeric weight",
      path: `${basePath}.ratio`,
      details: {
        ratio,
      },
    })
  }

  if (issue.path.includes("ratio")) {
    return compileError("RATIO_INVALID_VALUE", {
      source,
      message: 'ratio value must be a positive number or "<positive-integer>c"',
      path: formatPath(basePath, issue.path),
      details: {
        value: getValueAtPath(layout, issue.path),
      },
    })
  }

  return compileError("LAYOUT_INVALID_NODE", {
    source,
    message: "Layout node is invalid",
    path: formatPath(basePath, issue.path),
    details: {
      issue: issue.message,
      node: getValueAtPath(layout, issue.path),
    },
  })
}

const isMissingArrayIssue = (issue: z.ZodIssue, field: "panes" | "ratio"): boolean => {
  if (issue.path.length !== 1 || issue.path[0] !== field) {
    return false
  }

  return issue.code === "invalid_type" || (issue.code === "too_small" && issue.type === "array")
}

const getRatioLengthDetails = (layout: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!isRecord(layout)) {
    return undefined
  }

  const ratio = layout.ratio
  const panes = layout.panes
  if (!Array.isArray(ratio) || !Array.isArray(panes)) {
    return undefined
  }

  return {
    ratioLength: ratio.length,
    panesLength: panes.length,
  }
}

const formatPath = (basePath: string, path: ReadonlyArray<string | number>): string => {
  if (path.length === 0) {
    return basePath
  }

  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === "number") {
      return `${accumulator}[${segment}]`
    }
    return `${accumulator}.${segment}`
  }, basePath)
}

const getValueAtPath = (value: unknown, path: ReadonlyArray<string | number>): unknown => {
  let current: unknown = value

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined
      }
      current = current[segment]
      continue
    }

    if (!isRecord(current)) {
      return undefined
    }
    current = current[segment]
  }

  return current
}

const compileError = (
  code: string,
  error: {
    readonly source?: string
    readonly message: string
    readonly path?: string
    readonly details?: Readonly<Record<string, unknown>>
  },
): CoreError => {
  return createCoreError("compile", {
    code,
    message: error.message,
    source: error.source,
    path: error.path,
    details: error.details,
  })
}
