import type { Config, Preset, PresetInfo } from "../models/types"
import type { PresetManager } from "../types/preset-manager"

export type MockPresetManager = PresetManager & {
  readonly setPresets: (presets: Record<string, Preset>) => void
  readonly setShouldFailOnLoad: (shouldFail: boolean) => void
  readonly wasLoadConfigCalled: () => boolean
  readonly resetLoadConfigCalled: () => void
  readonly getConfigPath: () => string | undefined
  readonly setDefaults: (next: Config["defaults"] | undefined) => void
}

export const createMockPresetManager = (): MockPresetManager => {
  let presets: Record<string, Preset> = {
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

  let loadConfigCalled = false
  let shouldFailOnLoad = false
  let configPath: string | undefined
  let defaults: Config["defaults"] | undefined

  const loadConfig = async () => {
    loadConfigCalled = true
    if (shouldFailOnLoad) {
      throw new Error("Configuration file not found")
    }
  }

  const setConfigPath = (path: string) => {
    configPath = path
  }

  const getPreset = (name: string): Preset => {
    const preset = presets[name]
    if (!preset) {
      throw new Error(`Preset "${name}" not found`)
    }
    return preset
  }

  const getDefaultPreset = (): Preset => {
    return presets.default!
  }

  const listPresets = (): PresetInfo[] => {
    return Object.entries(presets).map(([key, preset]) => ({
      key,
      name: preset.name,
      description: preset.description,
    }))
  }

  const setPresets = (next: Record<string, Preset>) => {
    presets = next
  }

  const setDefaults = (next: Config["defaults"] | undefined) => {
    defaults = next
  }

  const setShouldFailOnLoad = (shouldFail: boolean) => {
    shouldFailOnLoad = shouldFail
  }

  const wasLoadConfigCalled = () => loadConfigCalled
  const resetLoadConfigCalled = () => {
    loadConfigCalled = false
  }

  const getConfigPath = () => configPath
  const getDefaults = () => defaults

  return {
    loadConfig,
    getPreset,
    getDefaultPreset,
    listPresets,
    setConfigPath,
    setPresets,
    setShouldFailOnLoad,
    wasLoadConfigCalled,
    resetLoadConfigCalled,
    getConfigPath,
    getDefaults,
    setDefaults,
  }
}
