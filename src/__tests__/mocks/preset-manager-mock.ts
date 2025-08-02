import type { IPresetManager } from "../../interfaces"
import type { Preset, PresetInfo } from "../../models/types"

export class MockPresetManager implements IPresetManager {
  private presets: Record<string, Preset> = {
    default: {
      name: "Default Layout",
      layout: {
        type: "horizontal",
        ratio: [50, 50],
        panes: [{ command: "vim" }, { command: "htop" }],
      },
    },
    dev: {
      name: "Development",
      layout: {
        type: "vertical",
        ratio: [70, 30],
        panes: [{ command: "vim" }, { command: "npm run dev" }],
      },
    },
  }

  private loadConfigCalled = false
  private shouldFailOnLoad = false

  async loadConfig(): Promise<void> {
    this.loadConfigCalled = true
    if (this.shouldFailOnLoad) {
      throw new Error("Configuration file not found")
    }
  }

  getPreset(name: string): Preset {
    const preset = this.presets[name]
    if (!preset) {
      throw new Error(`Preset "${name}" not found`)
    }
    return preset
  }

  getDefaultPreset(): Preset {
    return this.presets.default!
  }

  listPresets(): PresetInfo[] {
    return Object.entries(this.presets).map(([key, preset]) => ({
      key: key,
      name: preset.name,
      description: preset.description,
    }))
  }

  // Test helper methods
  setPresets(presets: Record<string, Preset>): void {
    this.presets = presets
  }

  setShouldFailOnLoad(shouldFail: boolean): void {
    this.shouldFailOnLoad = shouldFail
  }

  wasLoadConfigCalled(): boolean {
    return this.loadConfigCalled
  }

  resetLoadConfigCalled(): void {
    this.loadConfigCalled = false
  }
}
