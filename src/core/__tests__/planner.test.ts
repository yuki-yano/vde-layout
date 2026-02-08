import type { CompiledPreset } from "../compile"
import { describe, expect, it } from "vitest"
import { compilePreset, createLayoutPlan } from "../index"
import { isCoreError } from "../errors"

describe("createLayoutPlan", () => {
  it("normalizes ratios and assigns deterministic pane IDs and focus", () => {
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

    const { preset } = compilePreset({ document, source: "tests/sample.yml" })
    const { plan } = createLayoutPlan({ preset })
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

  it("throws when multiple panes request focus", () => {
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

    const { preset } = compilePreset({ document, source: "tests/conflict.yml" })

    expect.assertions(2)
    try {
      createLayoutPlan({ preset })
      throw new Error("expected failure")
    } catch (error) {
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("FOCUS_CONFLICT")
      }
    }
  })

  it("assigns focus to the first terminal when none is specified", () => {
    const document = `
name: no-focus
layout:
  type: vertical
  ratio: [3, 1]
  panes:
    - name: main
    - name: aux
`

    const { preset } = compilePreset({ document, source: "tests/no-focus.yml" })
    const { plan } = createLayoutPlan({ preset })
    expect(plan.focusPaneId).toBe("root.0")

    const root = plan.root
    if (root.kind !== "split") {
      throw new Error("expected split root")
    }

    const collectFocusStates = (node: (typeof root.panes)[number]): ReadonlyArray<boolean | undefined> => {
      if (node.kind === "terminal") {
        return [node.focus]
      }
      return node.panes.flatMap(collectFocusStates)
    }

    const terminalFocusStates = root.panes
      .flatMap(collectFocusStates)
      .filter((value): value is boolean => value !== undefined)

    expect(terminalFocusStates.filter(Boolean).length).toBe(1)
  })

  it("builds a single-pane plan when layout is undefined", () => {
    const document = `
name: single-pane
`

    const { preset } = compilePreset({ document, source: "tests/single.yml" })
    const { plan } = createLayoutPlan({ preset })
    expect(plan.focusPaneId).toBe("root")
    expect(plan.root).toMatchObject({
      kind: "terminal",
      id: "root",
      focus: true,
      name: "single-pane",
    })
  })

  it("normalizes ratios evenly when the total is zero", () => {
    const preset: CompiledPreset = {
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

    const { plan } = createLayoutPlan({ preset })
    const root = plan.root
    if (root.kind !== "split") {
      throw new Error("expected split root")
    }

    expect(root.ratio).toEqual([0.5, 0.5])
  })

  it("throws when no terminal panes exist in the layout", () => {
    const preset: CompiledPreset = {
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

    expect.assertions(2)
    try {
      createLayoutPlan({ preset })
      throw new Error("expected failure")
    } catch (error) {
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("NO_TERMINAL_PANES")
      }
    }
  })
})
