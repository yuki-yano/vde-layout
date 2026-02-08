import { describe, expect, it } from "vitest"
import { compilePreset, createLayoutPlan, emitPlan } from "../index"

describe("emitPlan", () => {
  it("generates tmux command steps from a plan", () => {
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

    const { preset } = compilePreset({ document, source: "tests/emit.yml" })
    const { plan } = createLayoutPlan({ preset })
    const emission = emitPlan({ plan })
    expect(emission.steps).toHaveLength(2)
    expect(emission.steps[0]).toMatchObject({
      kind: "split",
      orientation: "horizontal",
      percentage: 50,
      command: ["split-window", "-h", "-t", "root.0", "-p", expect.any(String)],
    })
    expect(emission.summary.stepsCount).toBe(2)
    expect(emission.summary.focusPaneId).toBe("root.0")
    expect(emission.summary.initialPaneId).toBe("root.0")
    expect(emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("returns success even when the plan is unchanged", () => {
    const document = `
name: stable
layout:
  type: vertical
  ratio: [2, 1]
  panes:
    - name: main
    - name: aux
`

    const { preset } = compilePreset({ document, source: "tests/stable.yml" })
    const { plan } = createLayoutPlan({ preset })
    const emission = emitPlan({ plan })
    expect(emission.steps).not.toHaveLength(0)
    expect(emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("preserves delay and title in emitted terminals", () => {
    const document = `
name: with-terminal-options
layout:
  type: horizontal
  ratio: [1, 1]
  panes:
    - name: main
      title: Main Pane
      delay: 300
      command: npm run dev
    - name: aux
`

    const { preset } = compilePreset({ document, source: "tests/terminal-options.yml" })
    const { plan } = createLayoutPlan({ preset })
    const emission = emitPlan({ plan })
    const main = emission.terminals.find((terminal) => terminal.virtualPaneId === "root.0")

    expect(main).toMatchObject({
      title: "Main Pane",
      delay: 300,
    })
  })

  it("generates only a focus step for a single-pane plan", () => {
    const document = `
name: single
`

    const { preset } = compilePreset({ document, source: "tests/single-emitter.yml" })
    const { plan } = createLayoutPlan({ preset })
    const emission = emitPlan({ plan })
    expect(emission.steps).toHaveLength(1)
    expect(emission.steps[0]).toMatchObject({
      kind: "focus",
      command: ["select-pane", "-t", "root"],
    })
    expect(emission.summary.stepsCount).toBe(1)
    expect(emission.summary.initialPaneId).toBe("root")
    expect(emission.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rounds ratios when generating commands for multi-split plans", () => {
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

    const { preset } = compilePreset({ document, source: "tests/nested.yml" })
    const { plan } = createLayoutPlan({ preset })
    const emission = emitPlan({ plan })
    const splitSteps = emission.steps.filter((step) => step.kind === "split")
    expect(splitSteps).toEqual([
      expect.objectContaining({
        id: "root:split:1",
        orientation: "horizontal",
        percentage: 67,
        command: ["split-window", "-h", "-t", "root.0", "-p", "67"],
      }),
      expect.objectContaining({
        id: "root:split:2",
        orientation: "horizontal",
        percentage: 50,
        command: ["split-window", "-h", "-t", "root.1", "-p", "50"],
      }),
      expect.objectContaining({
        id: "root.1:split:1",
        orientation: "vertical",
        percentage: 67,
        command: ["split-window", "-v", "-t", "root.1.0", "-p", "67"],
      }),
    ])
    expect(emission.summary.stepsCount).toBe(emission.steps.length)
  })

  it("produces a deterministic hash for the same plan", () => {
    const document = `
name: deterministic
layout:
  type: horizontal
  ratio: [2, 1]
  panes:
    - name: main
    - name: aux
`

    const { preset } = compilePreset({ document, source: "tests/hash.yml" })
    const { plan } = createLayoutPlan({ preset })

    const first = emitPlan({ plan })
    const second = emitPlan({ plan })

    expect(first.hash).toBe(second.hash)
  })
})
