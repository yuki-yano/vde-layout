import { describe, expect, it } from "vitest"
import { compilePreset } from "../compile.ts"
import { isFunctionalCoreError } from "../errors.ts"

describe("compilePreset", () => {
  it("プリセットYAMLを純粋データモデルへ変換する", () => {
    const document = `
name: sample-functional
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

    expect(result.preset.name).toBe("sample-functional")
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

  it("YAML解析エラーを返す", () => {
    const document = "name: [unclosed"

    expect.assertions(2)
    try {
      compilePreset({
        document,
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

  it("splitノードのratioとpanesの長さが一致しない場合はエラーを返す", () => {
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
      expect(isFunctionalCoreError(error)).toBe(true)
      if (isFunctionalCoreError(error)) {
        expect(error.code).toBe("LAYOUT_RATIO_MISMATCH")
      }
    }
  })

  it("ターミナルペインのenvと追加オプションを正規化する", () => {
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
  })

  it("未知のlayoutノードはStructuredErrorを返す", () => {
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
      expect(isFunctionalCoreError(error)).toBe(true)
      if (isFunctionalCoreError(error)) {
        expect(error.code).toBe("LAYOUT_INVALID_NODE")
      }
    }
  })

  it("不正なorientationを検出する", () => {
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
      expect(isFunctionalCoreError(error)).toBe(true)
      if (isFunctionalCoreError(error)) {
        expect(error.code).toBe("LAYOUT_INVALID_ORIENTATION")
      }
    }
  })
})
