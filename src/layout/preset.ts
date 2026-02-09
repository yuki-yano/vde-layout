import { createConfigLoader, type ConfigLoaderOptions } from "../config/loader"
import { createConfigError, ErrorCodes } from "../utils/errors"
import type { Config, Preset, PresetInfo } from "../models/types"
import type { PresetManager } from "../contracts"

type PresetState = {
  setConfigPath: (filePath: string) => void
  loadConfig: () => Promise<void>
  getPreset: (name: string) => Preset
  listPresets: () => PresetInfo[]
  getDefaultPreset: () => Preset
  getDefaults: () => Config["defaults"] | undefined
}

const createState = (options: ConfigLoaderOptions = {}): PresetState => {
  let loaderOptions: ConfigLoaderOptions = options
  let cachedConfig: Config | null = null

  const setConfigPath = (filePath: string): void => {
    loaderOptions = { configPaths: [filePath] }
    cachedConfig = null
  }

  const loadConfig = async (): Promise<void> => {
    const loader = createConfigLoader(loaderOptions)
    cachedConfig = await loader.loadConfig()
  }

  const ensureConfig = (): Config => {
    if (cachedConfig === null) {
      throw createConfigError("Configuration not loaded", ErrorCodes.CONFIG_NOT_FOUND)
    }
    return cachedConfig
  }

  const getPreset = (name: string): Preset => {
    const config = ensureConfig()
    const preset = config.presets[name]
    if (preset === undefined) {
      throw createConfigError(`Preset "${name}" not found`, ErrorCodes.PRESET_NOT_FOUND, {
        availablePresets: Object.keys(config.presets),
      })
    }
    return preset
  }

  const listPresets = (): PresetInfo[] => {
    if (cachedConfig === null) {
      return []
    }

    return Object.entries(cachedConfig.presets).map(([key, preset]) => ({
      key,
      name: preset.name,
      description: preset.description,
    }))
  }

  const getDefaultPreset = (): Preset => {
    const config = ensureConfig()

    if (config.presets.default !== undefined) {
      return config.presets.default
    }

    const firstKey = Object.keys(config.presets)[0]
    if (typeof firstKey !== "string" || firstKey.length === 0) {
      throw createConfigError("No presets defined", ErrorCodes.PRESET_NOT_FOUND)
    }

    return config.presets[firstKey]!
  }

  const getDefaults = (): Config["defaults"] | undefined => {
    const config = ensureConfig()
    return config.defaults
  }

  return {
    setConfigPath,
    loadConfig,
    getPreset,
    listPresets,
    getDefaultPreset,
    getDefaults,
  }
}

export const createPresetManager = (options: ConfigLoaderOptions = {}): PresetManager => {
  const state = createState(options)
  return {
    setConfigPath: state.setConfigPath,
    loadConfig: state.loadConfig,
    getPreset: state.getPreset,
    listPresets: state.listPresets,
    getDefaultPreset: state.getDefaultPreset,
    getDefaults: state.getDefaults,
  }
}
