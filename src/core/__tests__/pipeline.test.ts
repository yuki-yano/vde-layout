import { describe, expect, it, vi } from "vitest"
import { compileCorePipeline } from "../index"
import type { CompilePresetInput, CompilePresetSuccess } from "../compile"
import { compilePreset } from "../compile"
import { createLayoutPlan } from "../planner"
import { emitPlan } from "../emitter"
import { createCoreError } from "../errors"
import { isCoreError } from "../errors"

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

describe("compileCorePipeline", () => {
  it("builds a plan emission from a document", () => {
    const result = compileCorePipeline({
      document: validDocument,
      source: "tests/pipeline.yml",
    })

    expect(result.preset.metadata.source).toBe("tests/pipeline.yml")
    expect(result.plan.focusPaneId).toBe("root.0")
    expect(result.emission.summary.stepsCount).toBeGreaterThan(0)
    expect(result.emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("propagates compile errors", () => {
    expect.assertions(2)
    try {
      compileCorePipeline({
        document: "name: [unterminated",
        source: "tests/broken.yml",
      })
      throw new Error("expected failure")
    } catch (error) {
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("PRESET_PARSE_ERROR")
      }
    }
  })

  it("invokes each stage with injected dependencies", () => {
    const compileSpy = vi.fn(({ document, source }: CompilePresetInput): CompilePresetSuccess => {
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

    const planSpy = vi.fn(
      ({ preset }: { preset: CompilePresetSuccess["preset"] }): ReturnType<typeof createLayoutPlan> => {
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

    const emissionSpy = vi.fn(
      (_input: { plan: ReturnType<typeof createLayoutPlan>["plan"] }): ReturnType<typeof emitPlan> => ({
        steps: [],
        summary: { stepsCount: 0, focusPaneId: "root.0", initialPaneId: "root.0" },
        hash: "abc123",
        terminals: [],
      }),
    )

    const result = compileCorePipeline(
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

  it("propagates plan creation errors", () => {
    const planSpy = vi.fn((_input: { preset: CompilePresetSuccess["preset"] }): ReturnType<typeof createLayoutPlan> => {
      throw createCoreError("plan", {
        code: "FOCUS_CONFLICT",
        message: "Multiple panes specify focus=true",
        path: "preset.layout",
      })
    })

    expect.assertions(2)
    try {
      compileCorePipeline(
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
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("FOCUS_CONFLICT")
      }
    }
  })

  it("propagates plan emitter errors", () => {
    const emissionSpy = vi.fn(
      (_input: { plan: ReturnType<typeof createLayoutPlan>["plan"] }): ReturnType<typeof emitPlan> => {
        throw createCoreError("emit", {
          code: "LAYOUT_INVALID_NODE",
          message: "Layout node is invalid",
          path: "preset.layout.panes[0]",
        })
      },
    )

    expect.assertions(2)
    try {
      compileCorePipeline(
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
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("LAYOUT_INVALID_NODE")
      }
    }
  })
})
