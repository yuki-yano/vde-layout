import { describe, expect, it } from "vitest"
import { compilePreset, compilePresetFromValue } from "../compile.ts"
import { isCoreError } from "../errors.ts"

describe("compilePreset", () => {
  it("converts preset YAML into the data model", () => {
    const document = `
name: sample-core
layout:
  type: horizontal
  ratio: [1, 2]
  panes:
    - name: main
      command: nvim
    - type: vertical
      ratio: [3, 1]
      panes:
        - name: watcher
        - name: console
`

    const result = compilePreset({
      document,
      source: "tests/sample.yml",
    })

    expect(result.preset.name).toBe("sample-core")
    expect(result.preset.version).toBe("legacy")
    expect(result.preset.metadata.source).toBe("tests/sample.yml")

    const root = result.preset.layout
    expect(root).toMatchObject({
      kind: "split",
      orientation: "horizontal",
      ratio: [1, 2],
    })
    expect(root?.kind === "split" ? root.panes[0] : undefined).toMatchObject({
      kind: "terminal",
      name: "main",
      command: "nvim",
    })
  })

  it("returns a YAML parse error", () => {
    const document = "name: [unclosed"

    expect.assertions(2)
    try {
      compilePreset({
        document,
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

  it("throws when split ratio and panes length mismatch", () => {
    const document = `
name: mismatch
layout:
  type: horizontal
  ratio: [1, 2]
  panes:
    - name: left
`

    expect.assertions(2)
    try {
      compilePreset({
        document,
        source: "tests/mismatch.yml",
      })
      throw new Error("expected failure")
    } catch (error) {
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("LAYOUT_RATIO_MISMATCH")
      }
    }
  })

  it("normalizes terminal env and additional options", () => {
    const document = `
name: env-options
layout:
  type: horizontal
  ratio: [1, 1]
  panes:
    - name: main
      env:
        PATH: /usr/bin
        COUNT: 1
      delay: 750
      title: Main Pane
      layoutHint: floating
      focus: true
    - name: shell
      command: bash
`

    const result = compilePreset({
      document,
      source: "tests/env.yml",
    })

    const layout = result.preset.layout
    if (!layout || layout.kind !== "split") {
      throw new Error("expected split root")
    }

    const terminal = layout.panes[0]
    if (!terminal || terminal.kind !== "terminal") {
      throw new Error("expected terminal pane")
    }

    expect(terminal.env).toEqual({ PATH: "/usr/bin" })
    expect(terminal.options).toEqual({ layoutHint: "floating" })
    expect(terminal.focus).toBe(true)
    expect(terminal.delay).toBe(750)
    expect(terminal.title).toBe("Main Pane")
  })

  it("throws a structured error for unknown layout nodes", () => {
    const document = `
name: invalid-node
layout:
  type: horizontal
  ratio: [1]
  panes:
    - 42
`

    expect.assertions(2)
    try {
      compilePreset({
        document,
        source: "tests/invalid-node.yml",
      })
      throw new Error("expected failure")
    } catch (error) {
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("LAYOUT_INVALID_NODE")
      }
    }
  })

  it("detects invalid orientation", () => {
    const document = `
name: invalid-orientation
layout:
  type: diagonal
  ratio: [1]
  panes:
    - name: main
`

    expect.assertions(2)
    try {
      compilePreset({
        document,
        source: "tests/invalid-orientation.yml",
      })
      throw new Error("expected failure")
    } catch (error) {
      expect(isCoreError(error)).toBe(true)
      if (isCoreError(error)) {
        expect(error.code).toBe("LAYOUT_INVALID_ORIENTATION")
      }
    }
  })

  it("compiles preset values without YAML serialization", () => {
    const result = compilePresetFromValue({
      source: "tests/value-input",
      value: {
        name: "typed-input",
        layout: {
          type: "horizontal",
          ratio: [1, 1],
          panes: [{ name: "main" }, { name: "aux" }],
        },
      },
    })

    expect(result.preset.name).toBe("typed-input")
    expect(result.preset.metadata.source).toBe("tests/value-input")
    expect(result.preset.layout).toMatchObject({
      kind: "split",
      orientation: "horizontal",
      ratio: [1, 1],
    })
  })
})
