import { describe, expect, it, vi } from "vitest"
import { compileFunctionalCorePipeline } from "../index.ts"
import type { CompilePresetInput } from "../compile.ts"
import { compilePreset } from "../compile.ts"
import { createLayoutPlan } from "../planner.ts"
import { emitPlan } from "../emitter.ts"

type CompileSuccess = ReturnType<typeof compilePreset> extends { ok: true; value: infer S } ? S : never
type PlanSuccess = ReturnType<typeof createLayoutPlan> extends { ok: true; value: infer P } ? P : never

const validDocument = `
name: pipeline
layout:
  type: horizontal
  ratio: [1, 1]
  panes:
    - name: main
      command: nvim
      focus: true
    - name: aux
`

describe("compileFunctionalCorePipeline", () => {
  it("ドキュメントからPlan Emissionまでを生成する", () => {
    const result = compileFunctionalCorePipeline({
      document: validDocument,
      source: "tests/pipeline.yml",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }

    expect(result.value.preset.metadata.source).toBe("tests/pipeline.yml")
    expect(result.value.plan.focusPaneId).toBe("root.0")
    expect(result.value.emission.summary.stepsCount).toBeGreaterThan(0)
    expect(result.value.emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("コンパイルエラーを伝播する", () => {
    const result = compileFunctionalCorePipeline({
      document: "name: [unterminated",
      source: "tests/broken.yml",
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected failure")
    }

    expect(result.error.code).toBe("PRESET_PARSE_ERROR")
    expect(result.error.source).toBe("tests/broken.yml")
  })

  it("依存を差し替えて各ステージ呼び出しを検証する", () => {
    const compileSpy = vi.fn<[CompilePresetInput], ReturnType<typeof compilePreset>>(({ document, source }) => {
      expect(document).toBe(validDocument)
      expect(source).toBe("tests/pipeline.yml")
      return {
        ok: true,
        value: {
          preset: {
            name: "mock",
            version: "legacy",
            metadata: { source: "tests/pipeline.yml" },
            layout: {
              kind: "split",
              orientation: "horizontal",
              ratio: [0.5, 0.5],
              panes: [
                { kind: "terminal", name: "one", focus: true },
                { kind: "terminal", name: "two" },
              ],
            },
          },
        },
      }
    })

    const planSpy = vi.fn<[{ preset: CompileSuccess["preset"] }], ReturnType<typeof createLayoutPlan>>(({ preset }) => {
      expect(preset.name).toBe("mock")
      return {
        ok: true,
        value: {
          plan: {
            focusPaneId: "root.0",
            root: {
              kind: "split",
              id: "root",
              orientation: "horizontal",
              ratio: [0.5, 0.5],
              panes: [
                { kind: "terminal", id: "root.0", name: "one", focus: true },
                { kind: "terminal", id: "root.1", name: "two", focus: false },
              ],
            },
          },
        },
      }
    })

    const emissionSpy = vi.fn<[{ plan: PlanSuccess["plan"] }], ReturnType<typeof emitPlan>>(() => {
      return {
        ok: true,
        value: {
          steps: [],
          summary: { stepsCount: 0, focusPaneId: "root.0" },
          hash: "abc123",
        },
      }
    })

    const result = compileFunctionalCorePipeline(
      {
        document: validDocument,
        source: "tests/pipeline.yml",
      },
      {
        compilePreset: compileSpy,
        createLayoutPlan: planSpy,
        emitPlan: emissionSpy,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw result.error
    }

    expect(result.value.emission.hash).toBe("abc123")
    expect(compileSpy).toHaveBeenCalledTimes(1)
    expect(planSpy).toHaveBeenCalledTimes(1)
    expect(emissionSpy).toHaveBeenCalledTimes(1)
  })

  it("プラン生成エラーを伝播する", () => {
    const planSpy = vi.fn<[{ preset: CompileSuccess["preset"] }], ReturnType<typeof createLayoutPlan>>(() => ({
      ok: false,
      error: {
        code: "FOCUS_CONFLICT",
        message: "複数のペインでfocusが指定されています",
        path: "preset.layout",
      },
    }))

    const result = compileFunctionalCorePipeline(
      {
        document: validDocument,
        source: "tests/pipeline.yml",
      },
      {
        compilePreset,
        createLayoutPlan: planSpy,
        emitPlan,
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected failure")
    }

    expect(result.error.code).toBe("FOCUS_CONFLICT")
    expect(result.error.path).toBe("preset.layout")
  })

  it("Plan Emitterエラーを伝播する", () => {
    const emissionSpy = vi.fn<[{ plan: PlanSuccess["plan"] }], ReturnType<typeof emitPlan>>(() => ({
      ok: false,
      error: {
        code: "LAYOUT_INVALID_NODE",
        message: "レイアウトノードの形式が不正です",
        path: "preset.layout.panes[0]",
      },
    }))

    const result = compileFunctionalCorePipeline(
      {
        document: validDocument,
        source: "tests/pipeline.yml",
      },
      {
        compilePreset,
        createLayoutPlan,
        emitPlan: emissionSpy,
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected failure")
    }

    expect(result.error.code).toBe("LAYOUT_INVALID_NODE")
    expect(result.error.path).toBe("preset.layout.panes[0]")
  })
})
