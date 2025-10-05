import { describe, expect, it } from "vitest"
import { runDiagnostics } from "../diagnostics"

describe("runDiagnostics", () => {
  it("フォーカス重複とlayout欠如を指摘する", () => {
    const preset = `
name: sample
layout:
  type: vertical
  panes:
    - name: main
      focus: true
    - name: side
      focus: true
`

    const report = runDiagnostics({
      presetDocument: preset,
      knownIssues: [],
    })

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "preset.layout",
          severity: "high",
        }),
      ]),
    )
  })

  it("既知の課題を中優先度で取り込む", () => {
    const preset = `
name: sample
layout:
  type: vertical
  panes:
    - name: main
`

    const report = runDiagnostics({
      presetDocument: preset,
      knownIssues: [
        "LayoutEngineがtmux依存とI/Oを同一クラスで扱っている",
      ],
    })

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "codebase.knownIssues[0]",
          severity: "medium",
        }),
      ]),
    )
  })

  it("YAML解析に失敗した場合は高優先度で次のアクションを提示する", () => {
    const preset = "name: [unterminated"

    const report = runDiagnostics({
      presetDocument: preset,
      knownIssues: [],
    })

    expect(report.findings[0]?.path).toBe("presetDocument")
    expect(report.findings[0]?.severity).toBe("high")
    expect(report.nextSteps[0]).toContain("プリセットYAMLを構文チェック")
    expect(report.backlog[0]?.id).toBe("presetDocument")
  })
})
