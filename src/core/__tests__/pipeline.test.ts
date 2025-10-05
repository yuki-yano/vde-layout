import { describe, expect, it, vi } from "vitest"
import { compileFunctionalCorePipeline } from "../index.ts"
import type { CompilePresetInput, CompilePresetSuccess } from "../compile.ts"
import { compilePreset } from "../compile.ts"
import { createLayoutPlan } from "../planner.ts"
import { emitPlan } from "../emitter.ts"
import { createFunctionalError } from "../errors.ts"
import { isFunctionalCoreError } from "../errors.ts"

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

    expect(result.preset.metadata.source).toBe("tests/pipeline.yml")
    expect(result.plan.focusPaneId).toBe("root.0")
    expect(result.emission.summary.stepsCount).toBeGreaterThan(0)
    expect(result.emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("コンパイルエラーを伝播する", () => {
    expect.assertions(2)
    try {
      compileFunctionalCorePipeline({
        document: "name: [unterminated",
        source: "tests/broken.yml",
      })
      throw new Error("expected failure")
    } catch (error) {
      expect(isFunctionalCoreError(error)).toBe(true)
      if (isFunctionalCoreError(error)) {
        expect(error.code).toBe("PRESET_PARSE_ERROR")
      }
    }
  })

  it("依存を差し替えて各ステージ呼び出しを検証する", () => {
    const compileSpy = vi.fn<[CompilePresetInput], CompilePresetSuccess>(({ document, source }) => {
      expect(document).toBe(validDocument)
      expect(source).toBe("tests/pipeline.yml")
      return {
        preset: {
          name: "mock",
          version: "legacy",
          metadata: { source: "tests/pipeline.yml" },
          layout: {
            kind: "split",
            orientation: "horizontal",
            ratio: [0.5, 0.5],
            panes: [
              { kind: "terminal", name: "one", command: "nvim", focus: true },
              { kind: "terminal", name: "two" },
            ],
          },
        },
      }
    })

    const planSpy = vi.fn<[{ preset: CompilePresetSuccess["preset"] }], ReturnType<typeof createLayoutPlan>>(
      ({ preset }) => {
        expect(preset.name).toBe("mock")
        return {
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
        }
      },
    )

    const emissionSpy = vi.fn<[{ plan: ReturnType<typeof createLayoutPlan>["plan"] }], ReturnType<typeof emitPlan>>(
      () => ({
        steps: [],
        summary: { stepsCount: 0, focusPaneId: "root.0", initialPaneId: "root.0" },
        hash: "abc123",
        terminals: [],
      }),
    )

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

    expect(result.emission.hash).toBe("abc123")
    expect(compileSpy).toHaveBeenCalledTimes(1)
    expect(planSpy).toHaveBeenCalledTimes(1)
    expect(emissionSpy).toHaveBeenCalledTimes(1)
  })

  it("プラン生成エラーを伝播する", () => {
    const planSpy = vi.fn<[{ preset: CompilePresetSuccess["preset"] }], ReturnType<typeof createLayoutPlan>>(() => {
      throw createFunctionalError("plan", {
        code: "FOCUS_CONFLICT",
        message: "複数のペインでfocusが指定されています",
        path: "preset.layout",
      })
    })

    expect.assertions(2)
    try {
      compileFunctionalCorePipeline(
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
      throw new Error("expected failure")
    } catch (error) {
      expect(isFunctionalCoreError(error)).toBe(true)
      if (isFunctionalCoreError(error)) {
        expect(error.code).toBe("FOCUS_CONFLICT")
      }
    }
  })

  it("Plan Emitterエラーを伝播する", () => {
    const emissionSpy = vi.fn<[{ plan: ReturnType<typeof createLayoutPlan>["plan"] }], ReturnType<typeof emitPlan>>(
      () => {
        throw createFunctionalError("emit", {
          code: "LAYOUT_INVALID_NODE",
          message: "レイアウトノードの形式が不正です",
          path: "preset.layout.panes[0]",
        })
      },
    )

    expect.assertions(2)
    try {
      compileFunctionalCorePipeline(
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
      throw new Error("expected failure")
    } catch (error) {
      expect(isFunctionalCoreError(error)).toBe(true)
      if (isFunctionalCoreError(error)) {
        expect(error.code).toBe("LAYOUT_INVALID_NODE")
      }
    }
  })
})
