import { describe, expect, it, vi, type Mock } from "vitest"
import { createCli } from "../cli.ts"
import type { Preset, PresetInfo } from "../models/types.ts"
import type { PresetManager } from "../types/preset-manager.ts"

type StubPresetManager = PresetManager & {
  readonly loadConfig: Mock<[], Promise<void>>
  readonly getPreset: Mock<[string], Preset>
  readonly getDefaultPreset: Mock<[], Preset>
  readonly listPresets: Mock<[], PresetInfo[]>
}

const createStubPresetManager = (preset: Preset): StubPresetManager => {
  const loadConfig = vi.fn(async () => {})
  const getPreset = vi.fn((name: string): Preset => {
    if (name !== preset.name) {
      throw new Error("preset not found in stub")
    }
    return preset
  })
  const getDefaultPreset = vi.fn((): Preset => preset)
  const listPresets = vi.fn((): PresetInfo[] => [
    { key: preset.name, name: preset.name, description: preset.description },
  ])

  return {
    loadConfig,
    getPreset,
    getDefaultPreset,
    listPresets,
  } as StubPresetManager
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

    const presetManager = createStubPresetManager(preset)
    const cli = createCli({ presetManager })

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
