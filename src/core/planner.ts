import type {
  CompiledLayoutNode,
  CompiledPreset,
  CompiledRatioEntry,
  CompiledSplitPane,
  CompiledTerminalPane,
} from "./compile"
import { createCoreError, type CoreError } from "./errors"

type CreateLayoutPlanInput = {
  readonly preset: CompiledPreset
}

type PlanTerminal = {
  readonly kind: "terminal"
  readonly id: string
  readonly name: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly delay?: number
  readonly title?: string
  readonly focus: boolean
  readonly ephemeral?: boolean
  readonly closeOnError?: boolean
  readonly options?: Readonly<Record<string, unknown>>
}

type PlanSplit = {
  readonly kind: "split"
  readonly id: string
  readonly orientation: "horizontal" | "vertical"
  readonly ratio: ReadonlyArray<CompiledRatioEntry>
  readonly panes: ReadonlyArray<PlanNode>
}

export type PlanNode = PlanTerminal | PlanSplit

export type LayoutPlan = {
  readonly root: PlanNode
  readonly focusPaneId: string
}

export type CreateLayoutPlanSuccess = {
  readonly plan: LayoutPlan
}

export const createLayoutPlan = ({ preset }: CreateLayoutPlanInput): CreateLayoutPlanSuccess => {
  if (!preset.layout) {
    const terminal = createTerminalNode({
      id: "root",
      terminal: {
        kind: "terminal",
        name: preset.name,
        command: preset.command,
      },
      focusOverride: true,
    })

    return {
      plan: {
        root: terminal,
        focusPaneId: terminal.id,
      },
    }
  }

  const { node, focusPaneIds, terminalPaneIds } = buildLayoutNode(preset.layout, {
    parentId: "root",
    path: "preset.layout",
    source: preset.metadata.source,
  })

  if (focusPaneIds.length > 1) {
    throw planError("FOCUS_CONFLICT", {
      message: "Multiple panes specify focus=true",
      path: "preset.layout",
      source: preset.metadata.source,
      details: { focusPaneIds },
    })
  }

  if (terminalPaneIds.length === 0) {
    throw planError("NO_TERMINAL_PANES", {
      message: "No terminal panes are defined",
      path: "preset.layout",
      source: preset.metadata.source,
    })
  }

  const focusPaneId = focusPaneIds[0] ?? terminalPaneIds[0]!
  const root = ensureFocus(node, focusPaneId)

  return {
    plan: {
      root,
      focusPaneId,
    },
  }
}

type BuildResult = {
  readonly node: PlanNode
  readonly focusPaneIds: ReadonlyArray<string>
  readonly terminalPaneIds: ReadonlyArray<string>
}

const buildLayoutNode = (
  node: CompiledLayoutNode,
  context: { readonly parentId: string; readonly path: string; readonly source: string },
): BuildResult => {
  if (node.kind === "split") {
    return buildSplitNode(node, context)
  }

  return {
    node: createTerminalNode({ id: context.parentId, terminal: node }),
    focusPaneIds: node.focus === true ? [context.parentId] : [],
    terminalPaneIds: [context.parentId],
  }
}

const buildSplitNode = (
  node: CompiledSplitPane,
  context: { readonly parentId: string; readonly path: string; readonly source: string },
): BuildResult => {
  const ratio = validateRatioEntries(node.ratio, context)

  const panes: PlanNode[] = []
  const focusPaneIds: string[] = []
  const terminalPaneIds: string[] = []

  for (let index = 0; index < node.panes.length; index += 1) {
    const childId = `${context.parentId}.${index}`
    const childContext = {
      parentId: childId,
      path: `${context.path}.panes[${index}]`,
      source: context.source,
    }

    const childResult = buildLayoutNode(node.panes[index]!, childContext)
    panes.push(childResult.node)
    focusPaneIds.push(...childResult.focusPaneIds)
    terminalPaneIds.push(...childResult.terminalPaneIds)
  }

  return {
    node: {
      kind: "split",
      id: context.parentId,
      orientation: node.orientation,
      ratio,
      panes,
    },
    focusPaneIds,
    terminalPaneIds,
  }
}

const createTerminalNode = ({
  id,
  terminal,
  focusOverride,
}: {
  readonly id: string
  readonly terminal: CompiledTerminalPane
  readonly focusOverride?: boolean
}): PlanTerminal => {
  return {
    kind: "terminal",
    id,
    name: terminal.name,
    command: terminal.command,
    cwd: terminal.cwd,
    env: terminal.env,
    delay: terminal.delay,
    title: terminal.title,
    options: terminal.options,
    focus: focusOverride === true ? true : terminal.focus === true,
    ephemeral: terminal.ephemeral,
    closeOnError: terminal.closeOnError,
  }
}

const ensureFocus = (node: PlanNode, focusPaneId: string): PlanNode => {
  if (node.kind === "terminal") {
    return {
      ...node,
      focus: node.id === focusPaneId,
    }
  }

  return {
    ...node,
    panes: node.panes.map((pane) => ensureFocus(pane, focusPaneId)),
  }
}

const validateRatioEntries = (
  ratio: ReadonlyArray<CompiledRatioEntry>,
  context: { readonly path: string; readonly source: string },
): ReadonlyArray<CompiledRatioEntry> => {
  let hasWeight = false

  for (let index = 0; index < ratio.length; index += 1) {
    const value = ratio[index]
    if (value?.kind === "weight") {
      if (!Number.isFinite(value.weight) || value.weight <= 0) {
        throw planError("RATIO_INVALID_VALUE", {
          message: 'ratio value must be a positive number or "<positive-integer>c"',
          path: `${context.path}.ratio[${index}]`,
          source: context.source,
          details: { value },
        })
      }
      hasWeight = true
      continue
    }

    if (value?.kind === "fixed-cells") {
      if (!Number.isInteger(value.cells) || value.cells <= 0) {
        throw planError("RATIO_INVALID_VALUE", {
          message: 'ratio value must be a positive number or "<positive-integer>c"',
          path: `${context.path}.ratio[${index}]`,
          source: context.source,
          details: { value },
        })
      }
      continue
    }

    throw planError("RATIO_INVALID_VALUE", {
      message: "ratio entry is invalid",
      path: `${context.path}.ratio[${index}]`,
      source: context.source,
      details: { value },
    })
  }

  if (!hasWeight) {
    throw planError("RATIO_WEIGHT_MISSING", {
      message: "ratio must include at least one numeric weight",
      path: `${context.path}.ratio`,
      source: context.source,
      details: { ratio },
    })
  }

  return ratio
}

const planError = (
  code: string,
  error: {
    readonly message: string
    readonly source?: string
    readonly path?: string
    readonly details?: Readonly<Record<string, unknown>>
  },
): CoreError => {
  return createCoreError("plan", {
    code,
    message: error.message,
    source: error.source,
    path: error.path,
    details: error.details,
  })
}
