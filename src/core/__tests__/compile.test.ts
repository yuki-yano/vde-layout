import { describe, expect, it } from "vitest"
import { compilePreset } from "../compile.ts"

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

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected success result")
    }

    expect(result.value.preset.name).toBe("sample-functional")
    expect(result.value.preset.version).toBe("legacy")
    expect(result.value.preset.metadata.source).toBe("tests/sample.yml")

    const root = result.value.preset.layout
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

    const result = compilePreset({
      document,
      source: "tests/broken.yml",
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected error result")
    }

    expect(result.error.code).toBe("PRESET_PARSE_ERROR")
    expect(result.error.source).toBe("tests/broken.yml")
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

    const result = compilePreset({
      document,
      source: "tests/mismatch.yml",
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected error result")
    }

    expect(result.error.code).toBe("LAYOUT_RATIO_MISMATCH")
    expect(result.error.message).toBe("ratio 配列と panes 配列の長さが一致しません")
    expect(result.error.path).toBe("preset.layout")
    expect(result.error.details).toEqual({
      ratioLength: 2,
      panesLength: 1,
    })
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

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected success result")
    }

    const layout = result.value.preset.layout
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

    const result = compilePreset({
      document,
      source: "tests/invalid-node.yml",
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected error result")
    }

    expect(result.error.code).toBe("LAYOUT_INVALID_NODE")
    expect(result.error.message).toBe("レイアウトノードの形式が不正です")
    expect(result.error.path).toBe("preset.layout.panes[0]")
    expect(result.error.details?.node).toBe(42)
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

    const result = compilePreset({
      document,
      source: "tests/invalid-orientation.yml",
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected error result")
    }

    expect(result.error.code).toBe("LAYOUT_INVALID_ORIENTATION")
    expect(result.error.message).toBe("layout.type は horizontal か vertical である必要があります")
    expect(result.error.path).toBe("preset.layout.type")
  })
})
