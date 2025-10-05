import type { FunctionalPreset } from "../compile.ts"
import { describe, expect, it } from "vitest"
import { compilePreset, createLayoutPlan } from "../index.ts"

describe("createLayoutPlan", () => {
  it("比率を正規化し決定的なペインIDとフォーカスを付与する", () => {
    const document = `
name: layout-sample
layout:
  type: horizontal
  ratio: [2, 1]
  panes:
    - name: editor
      command: nvim
      focus: true
    - type: vertical
      ratio: [1, 1]
      panes:
        - name: logs
        - name: shell
`

    const compiled = compilePreset({ document, source: "tests/sample.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    expect(planResult.ok).toBe(true)
    if (!planResult.ok) {
      throw planResult.error
    }

    const plan = planResult.value.plan
    expect(plan.focusPaneId).toBe("root.0")

    const root = plan.root
    if (root.kind !== "split") {
      throw new Error("expected split root")
    }

    expect(root.orientation).toBe("horizontal")
    expect(root.ratio).toEqual([2 / 3, 1 / 3])
    expect(root.panes.map((pane) => pane.id)).toEqual(["root.0", "root.1"])

    const nested = root.panes[1]
    if (nested.kind !== "split") {
      throw new Error("expected nested split")
    }

    expect(nested.ratio).toEqual([0.5, 0.5])
    expect(nested.panes.map((pane) => pane.id)).toEqual(["root.1.0", "root.1.1"])
  })

  it("フォーカス指定が重複している場合はエラーを返す", () => {
    const document = `
name: multi-focus
layout:
  type: horizontal
  ratio: [1, 1]
  panes:
    - name: first
      focus: true
    - name: second
      focus: true
`

    const compiled = compilePreset({ document, source: "tests/conflict.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    expect(planResult.ok).toBe(false)
    if (planResult.ok) {
      throw new Error("expected error result")
    }

    expect(planResult.error.code).toBe("FOCUS_CONFLICT")
    expect(planResult.error.path).toBe("preset.layout")
  })

  it("フォーカス未指定の場合は最初のターミナルへフォーカスを割り当てる", () => {
    const document = `
name: no-focus
layout:
  type: vertical
  ratio: [3, 1]
  panes:
    - name: main
    - name: aux
`

    const compiled = compilePreset({ document, source: "tests/no-focus.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    expect(planResult.ok).toBe(true)
    if (!planResult.ok) {
      throw planResult.error
    }

    const plan = planResult.value.plan
    expect(plan.focusPaneId).toBe("root.0")

    const root = plan.root
    if (root.kind !== "split") {
      throw new Error("expected split root")
    }

    const terminalFocusStates = root.panes
      .flatMap((pane) => (pane.kind === "terminal" ? [pane.focus] : pane.panes.map((child) => child.focus)))
      .filter((value): value is boolean => value !== undefined)

    expect(terminalFocusStates.filter(Boolean).length).toBe(1)
  })

  it("layoutが未定義でも単一ペインのPlanを生成する", () => {
    const document = `
name: single-pane
`

    const compiled = compilePreset({ document, source: "tests/single.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    expect(planResult.ok).toBe(true)
    if (!planResult.ok) {
      throw planResult.error
    }

    const plan = planResult.value.plan
    expect(plan.focusPaneId).toBe("root")
    expect(plan.root).toMatchObject({
      kind: "terminal",
      id: "root",
      focus: true,
      name: "single-pane",
    })
  })

  it("比率の合計が0の場合は均等配分に正規化する", () => {
    const preset: FunctionalPreset = {
      name: "zero-ratio",
      version: "legacy",
      metadata: { source: "tests/manual" },
      layout: {
        kind: "split",
        orientation: "horizontal",
        ratio: [0, 0],
        panes: [
          { kind: "terminal", name: "left" },
          { kind: "terminal", name: "right" },
        ],
      },
    }

    const result = createLayoutPlan({ preset })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }

    const root = result.value.plan.root
    if (root.kind !== "split") {
      throw new Error("expected split root")
    }

    expect(root.ratio).toEqual([0.5, 0.5])
  })

  it("ターミナルが存在しないレイアウトではエラーを返す", () => {
    const preset: FunctionalPreset = {
      name: "no-terminal",
      version: "legacy",
      metadata: { source: "tests/manual" },
      layout: {
        kind: "split",
        orientation: "horizontal",
        ratio: [1],
        panes: [
          {
            kind: "split",
            orientation: "vertical",
            ratio: [1],
            panes: [],
          },
        ],
      },
    }

    const result = createLayoutPlan({ preset })
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected error result")
    }

    expect(result.error.code).toBe("NO_TERMINAL_PANES")
    expect(result.error.path).toBe("preset.layout")
  })
})
