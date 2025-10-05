import { describe, expect, it, vi } from "vitest"
import { CLI } from "../cli"
import type { IPresetManager } from "../interfaces"
import type { Preset, PresetInfo } from "../models/types"

class StubPresetManager implements IPresetManager {
  private readonly preset: Preset
  readonly loadConfig = vi.fn(async () => {})
  readonly getPreset = vi.fn((name: string): Preset => {
    if (name !== this.preset.name) {
      throw new Error("preset not found in stub")
    }
    return this.preset
  })
  readonly getDefaultPreset = vi.fn((): Preset => this.preset)
  readonly listPresets = vi.fn((): PresetInfo[] => [
    { key: this.preset.name, name: this.preset.name, description: this.preset.description },
  ])

  constructor(preset: Preset) {
    this.preset = preset
  }
}

describe("CLI diagnose command", () => {
  it("診断結果を出力しフォーカス重複を通知する", async () => {
    const preset: Preset = {
      name: "diagnostic",
      layout: {
        type: "vertical",
        ratio: [1, 1],
        panes: [
          { name: "main", focus: true },
          { name: "aux", focus: true },
        ],
      },
    }

    const presetManager = new StubPresetManager(preset)
    const cli = new CLI({ presetManager })

    const loggedLines: string[] = []
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")
      loggedLines.push(message)
      return undefined
    })

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as () => never)

    try {
      await cli.run(["diagnose"])

      expect(presetManager.loadConfig).toHaveBeenCalled()
      expect(exitSpy).toHaveBeenCalledWith(0)

      const hasFocusFinding = loggedLines.some((line) => line.includes("focus"))
      const hasKnownIssue = loggedLines.some((line) => line.includes("tmux依存"))

      expect(hasFocusFinding).toBe(true)
      expect(hasKnownIssue).toBe(true)
    } finally {
      exitSpy.mockRestore()
      logSpy.mockRestore()
    }
  })
})
