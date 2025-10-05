import { describe, expect, it } from "vitest"
import { compilePreset, createLayoutPlan, emitPlan } from "../index.ts"

describe("emitPlan", () => {
  it("プランからtmuxコマンドステップを生成する", () => {
    const document = `
name: emit-sample
layout:
  type: horizontal
  ratio: [1, 1]
  panes:
    - name: main
      command: nvim
    - name: repl
      command: node
`

    const compiled = compilePreset({ document, source: "tests/emit.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    if (!planResult.ok) {
      throw planResult.error
    }

    const emissionResult = emitPlan({ plan: planResult.value.plan })

    expect(emissionResult.ok).toBe(true)
    if (!emissionResult.ok) {
      throw emissionResult.error
    }

    const emission = emissionResult.value
    expect(emission.steps).toHaveLength(2)
    expect(emission.steps[0]).toMatchObject({
      kind: "split",
      command: ["split-window", "-h", "-t", "root.0", "-p", expect.any(String)],
    })
    expect(emission.summary.stepsCount).toBe(2)
    expect(emission.summary.focusPaneId).toBe("root.0")
    expect(emission.summary.initialPaneId).toBe("root.0")
    expect(emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("Planが変更されなくても成功結果を返す", () => {
    const document = `
name: stable
layout:
  type: vertical
  ratio: [2, 1]
  panes:
    - name: main
    - name: aux
`

    const compiled = compilePreset({ document, source: "tests/stable.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    if (!planResult.ok) {
      throw planResult.error
    }

    const emission = emitPlan({ plan: planResult.value.plan })
    expect(emission.ok).toBe(true)
    if (!emission.ok) {
      throw emission.error
    }

    expect(emission.value.steps).not.toHaveLength(0)
    expect(emission.value.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("単一ペインのPlanではフォーカスステップのみを生成する", () => {
    const document = `
name: single
`

    const compiled = compilePreset({ document, source: "tests/single-emitter.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    if (!planResult.ok) {
      throw planResult.error
    }

    const emission = emitPlan({ plan: planResult.value.plan })
    expect(emission.ok).toBe(true)
    if (!emission.ok) {
      throw emission.error
    }

    expect(emission.value.steps).toHaveLength(1)
    expect(emission.value.steps[0]).toMatchObject({
      kind: "focus",
      command: ["select-pane", "-t", "root"],
    })
    expect(emission.value.summary.stepsCount).toBe(1)
    expect(emission.value.summary.initialPaneId).toBe("root")
    expect(emission.value.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("複数のsplitを含むPlanで割合を丸めてコマンドを生成する", () => {
    const document = `
name: nested
layout:
  type: horizontal
  ratio: [1, 1, 1]
  panes:
    - name: first
    - type: vertical
      ratio: [1, 2]
      panes:
        - name: nested-one
        - name: nested-two
    - name: third
`

    const compiled = compilePreset({ document, source: "tests/nested.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    if (!planResult.ok) {
      throw planResult.error
    }

    const emissionResult = emitPlan({ plan: planResult.value.plan })
    expect(emissionResult.ok).toBe(true)
    if (!emissionResult.ok) {
      throw emissionResult.error
    }

    const emission = emissionResult.value
    const splitSteps = emission.steps.filter((step) => step.kind === "split")
    expect(splitSteps).toEqual([
      expect.objectContaining({
        id: "root:split:1",
        command: ["split-window", "-h", "-t", "root.0", "-p", "67"],
      }),
      expect.objectContaining({
        id: "root:split:2",
        command: ["split-window", "-h", "-t", "root.1", "-p", "33"],
      }),
      expect.objectContaining({
        id: "root.1:split:1",
        command: ["split-window", "-v", "-t", "root.1.0", "-p", "67"],
      }),
    ])
    expect(emission.summary.stepsCount).toBe(emission.steps.length)
  })

  it("同一Planであればhashが決定的になる", () => {
    const document = `
name: deterministic
layout:
  type: horizontal
  ratio: [2, 1]
  panes:
    - name: main
    - name: aux
`

    const compiled = compilePreset({ document, source: "tests/hash.yml" })
    if (!compiled.ok) {
      throw compiled.error
    }

    const planResult = createLayoutPlan({ preset: compiled.value.preset })
    if (!planResult.ok) {
      throw planResult.error
    }

    const first = emitPlan({ plan: planResult.value.plan })
    const second = emitPlan({ plan: planResult.value.plan })

    if (!first.ok || !second.ok) {
      throw new Error("expected success")
    }

    expect(first.value.hash).toBe(second.value.hash)
  })
})
