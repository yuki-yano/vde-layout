import { parse } from "yaml"

export type DiagnosticsSeverity = "high" | "medium" | "low"

export interface DiagnosticsFinding {
  readonly path: string
  readonly severity: DiagnosticsSeverity
  readonly description: string
}

export interface DiagnosticsBacklogItem {
  readonly id: string
  readonly severity: DiagnosticsSeverity
  readonly summary: string
  readonly actions: ReadonlyArray<string>
}

export interface DiagnosticsReport {
  readonly findings: ReadonlyArray<DiagnosticsFinding>
  readonly nextSteps: ReadonlyArray<string>
  readonly backlog: ReadonlyArray<DiagnosticsBacklogItem>
}

export interface DiagnosticsInput {
  readonly presetDocument: string
  readonly knownIssues?: ReadonlyArray<string>
}

const severityRank: Record<DiagnosticsSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

interface FindingAccumulator {
  add: (args: { path: string; severity: DiagnosticsSeverity; description: string; nextStep?: string }) => void
  readonly findings: DiagnosticsFinding[]
  readonly nextSteps: Set<string>
  readonly backlog: Map<string, DiagnosticsBacklogItem>
}

const createAccumulator = (): FindingAccumulator => {
  const findings: DiagnosticsFinding[] = []
  const nextSteps = new Set<string>()
  const backlog = new Map<string, DiagnosticsBacklogItem>()

  return {
    findings,
    nextSteps,
    backlog,
    add: ({ path, severity, description, nextStep }): void => {
      findings.push({ path, severity, description })
      if (typeof nextStep === "string" && nextStep.length > 0) {
        nextSteps.add(nextStep)
      }

      const existing = backlog.get(path)
      const existingActions = new Set(existing?.actions ?? [])
      existingActions.add(description)
      if (typeof nextStep === "string" && nextStep.length > 0) {
        existingActions.add(nextStep)
      }

      const mergedSeverity = existing !== undefined ? maxSeverity(existing.severity, severity) : severity

      const summary =
        existing !== undefined && severityRank[existing.severity] >= severityRank[severity]
          ? existing.summary
          : description

      backlog.set(path, {
        id: path,
        severity: mergedSeverity,
        summary,
        actions: Array.from(existingActions),
      })
    },
  }
}

export function runDiagnostics(input: DiagnosticsInput): DiagnosticsReport {
  const accumulator = createAccumulator()
  const knownIssues = input.knownIssues ?? []
  let parsedPreset: unknown

  try {
    parsedPreset = parse(input.presetDocument)
  } catch (error) {
    accumulator.add({
      path: "presetDocument",
      severity: "high",
      description: `プリセットYAMLの解析に失敗しました: ${(error as Error).message}`,
      nextStep: "プリセットYAMLを構文チェックし、Functional Coreリライト前に整合性を確保する",
    })
    return {
      findings: sortBySeverity(accumulator.findings),
      nextSteps: Array.from(accumulator.nextSteps),
      backlog: sortBacklog(accumulator.backlog),
    }
  }

  if (parsedPreset === null || typeof parsedPreset !== "object") {
    accumulator.add({
      path: "preset",
      severity: "high",
      description: "プリセット定義がオブジェクト形式ではありません",
      nextStep: "プリセットYAMLをオブジェクト構造に整形し整合性を確保する",
    })
  } else {
    const presetObject = parsedPreset as Record<string, unknown>
    checkFocusDuplications(presetObject, accumulator)
    collectLowPrioritySignals(presetObject, accumulator)
  }

  knownIssues.forEach((issue, index) => {
    const trimmed = issue.trim()
    if (trimmed.length === 0) {
      return
    }

    accumulator.add({
      path: `codebase.knownIssues[${index}]`,
      severity: "medium",
      description: trimmed,
      nextStep: `tmux依存や副作用をFunctional Core境界で切り離す: ${trimmed}`,
    })
  })

  return {
    findings: sortBySeverity(accumulator.findings),
    nextSteps: Array.from(accumulator.nextSteps),
    backlog: sortBacklog(accumulator.backlog),
  }
}

const checkFocusDuplications = (preset: Record<string, unknown>, accumulator: FindingAccumulator): void => {
  const layout = preset.layout as unknown
  if (layout === undefined || layout === null) {
    return
  }

  const focusCount = countFocusFlags(layout)
  if (focusCount > 1) {
    accumulator.add({
      path: "preset.layout",
      severity: "high",
      description: "複数のペインでfocus: trueが指定されています",
      nextStep: "focusは単一ペインに限定しPlan生成時に一貫するようFunctional Coreで制御する",
    })
  }
}

const collectLowPrioritySignals = (preset: Record<string, unknown>, accumulator: FindingAccumulator): void => {
  const layout = preset.layout as Record<string, unknown> | undefined | null
  if (layout === undefined || layout === null) {
    accumulator.add({
      path: "preset.layout",
      severity: "low",
      description: "layout定義が存在しません（単一ペイン運用が前提）",
      nextStep: "単一ペイン前提でもPlan出力に影響しないことをFunctional Coreで確認する",
    })
    return
  }

  if (!Array.isArray(layout.panes)) {
    accumulator.add({
      path: "preset.layout.panes",
      severity: "low",
      description: "panes配列が存在しないか配列ではありません",
      nextStep: "レイアウト定義の構造を正規化し、Plan生成の入力契約を明示する",
    })
  }
}

const countFocusFlags = (node: unknown): number => {
  if (Array.isArray(node)) {
    return node.reduce((sum, child) => sum + countFocusFlags(child), 0)
  }

  if (node === null || typeof node !== "object") {
    return 0
  }

  const record = node as Record<string, unknown>
  const selfFocus = record.focus === true ? 1 : 0
  const childFocus = Array.isArray(record.panes)
    ? record.panes.reduce((sum, child) => sum + countFocusFlags(child), 0)
    : 0

  return selfFocus + childFocus
}

const sortBySeverity = (findings: DiagnosticsFinding[]): DiagnosticsFinding[] => {
  return [...findings].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
}

const sortBacklog = (backlog: Map<string, DiagnosticsBacklogItem>): DiagnosticsBacklogItem[] => {
  return [...backlog.values()].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
}

const maxSeverity = (left: DiagnosticsSeverity, right: DiagnosticsSeverity): DiagnosticsSeverity => {
  return severityRank[left] >= severityRank[right] ? left : right
}
