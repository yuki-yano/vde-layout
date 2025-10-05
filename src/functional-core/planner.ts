import type {
  FunctionalLayoutNode,
  FunctionalPreset,
  FunctionalSplitPane,
  FunctionalTerminalPane,
  Result,
  StructuredError,
} from "./compile"

export interface CreateLayoutPlanInput {
  readonly preset: FunctionalPreset
}

export interface PlanTerminal {
  readonly kind: "terminal"
  readonly id: string
  readonly name: string
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly focus: boolean
  readonly options?: Readonly<Record<string, unknown>>
}

export interface PlanSplit {
  readonly kind: "split"
  readonly id: string
  readonly orientation: "horizontal" | "vertical"
  readonly ratio: ReadonlyArray<number>
  readonly panes: ReadonlyArray<PlanNode>
}

export type PlanNode = PlanTerminal | PlanSplit

export interface LayoutPlan {
  readonly root: PlanNode
  readonly focusPaneId: string
}

export interface CreateLayoutPlanSuccess {
  readonly plan: LayoutPlan
}

export const createLayoutPlan = (
  input: CreateLayoutPlanInput,
): Result<CreateLayoutPlanSuccess, StructuredError> => {
  const { preset } = input

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

    return success({
      plan: {
        root: terminal,
        focusPaneId: terminal.id,
      },
    })
  }

  const builtResult = buildLayoutNode(preset.layout, {
    parentId: "root",
    path: "preset.layout",
    source: preset.metadata.source,
  })

  if (!builtResult.ok) {
    return builtResult
  }

  const { node, focusPaneIds, terminalPaneIds } = builtResult.value

  if (focusPaneIds.length > 1) {
    return fail("FOCUS_CONFLICT", {
      message: "複数のペインでfocusが指定されています",
      path: "preset.layout",
      source: preset.metadata.source,
      details: {
        focusPaneIds,
      },
    })
  }

  if (terminalPaneIds.length === 0) {
    return fail("NO_TERMINAL_PANES", {
      message: "ターミナルペインが存在しません",
      path: "preset.layout",
      source: preset.metadata.source,
    })
  }

  const focusPaneId = focusPaneIds[0] ?? terminalPaneIds[0]!
  const root = ensureFocus(node, focusPaneId)

  return success({
    plan: {
      root,
      focusPaneId,
    },
  })
}

interface BuildResult {
  readonly node: PlanNode
  readonly focusPaneIds: ReadonlyArray<string>
  readonly terminalPaneIds: ReadonlyArray<string>
}

const buildLayoutNode = (
  node: FunctionalLayoutNode,
  context: { readonly parentId: string; readonly path: string; readonly source: string },
): Result<BuildResult, StructuredError> => {
  if (node.kind === "split") {
    return buildSplitNode(node, context)
  }

  return success({
    node: createTerminalNode({ id: context.parentId, terminal: node }),
    focusPaneIds: node.focus === true ? [context.parentId] : [],
    terminalPaneIds: [context.parentId],
  })
}

const buildSplitNode = (
  node: FunctionalSplitPane,
  context: { readonly parentId: string; readonly path: string; readonly source: string },
): Result<BuildResult, StructuredError> => {
  const ratio = normalizeRatio(node.ratio)

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
    if (!childResult.ok) {
      return childResult
    }

    panes.push(childResult.value.node)
    focusPaneIds.push(...childResult.value.focusPaneIds)
    terminalPaneIds.push(...childResult.value.terminalPaneIds)
  }

  const splitNode: PlanSplit = {
    kind: "split",
    id: context.parentId,
    orientation: node.orientation,
    ratio,
    panes,
  }

  return success({
    node: splitNode,
    focusPaneIds,
    terminalPaneIds,
  })
}

const createTerminalNode = ({
  id,
  terminal,
  focusOverride,
}: {
  readonly id: string
  readonly terminal: FunctionalTerminalPane
  readonly focusOverride?: boolean
}): PlanTerminal => {
  return {
    kind: "terminal",
    id,
    name: terminal.name,
    command: terminal.command,
    cwd: terminal.cwd,
    env: terminal.env,
    options: terminal.options,
    focus: focusOverride === true ? true : terminal.focus === true,
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

const normalizeRatio = (ratio: ReadonlyArray<number>): number[] => {
  const total = ratio.reduce((sum, value) => sum + value, 0)
  if (total === 0) {
    return ratio.map(() => 1 / ratio.length)
  }
  return ratio.map((value) => value / total)
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
