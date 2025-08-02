import { ConfigLoader, type ConfigLoaderOptions } from "../config/loader"
import { validateYAML } from "../config/validator"
import { ConfigError, ErrorCodes } from "../utils/errors"
import type { Config, Preset, PresetInfo } from "../models/types"
import type { IPresetManager } from "../interfaces"

/**
 * Preset Manager
 * Loads and manages presets defined in YAML
 */
export class PresetManager implements IPresetManager {
  private config: Config | null = null
  private configLoaderOptions: ConfigLoaderOptions

  constructor(options: ConfigLoaderOptions = {}) {
    this.configLoaderOptions = options
  }

  /**
   * Load and validate configuration file
   * @throws {ConfigError} When loading or validation fails
   */
  async loadConfig(): Promise<void> {
    const loader = new ConfigLoader(this.configLoaderOptions)
    const yamlContent = await loader.loadYAML()
    this.config = validateYAML(yamlContent)
  }

  /**
   * Get preset by name
   * @param name - Preset name
   * @returns Preset
   * @throws {ConfigError} When preset is not found
   */
  getPreset(name: string): Preset {
    if (!this.config) {
      throw new ConfigError("Configuration not loaded", ErrorCodes.CONFIG_NOT_FOUND)
    }

    const preset = this.config.presets[name]
    if (!preset) {
      throw new ConfigError(`Preset "${name}" not found`, ErrorCodes.PRESET_NOT_FOUND, {
        availablePresets: Object.keys(this.config.presets),
      })
    }

    return preset
  }

  /**
   * Get information for all available presets
   * @returns Array of preset information
   */
  listPresets(): PresetInfo[] {
    if (!this.config) {
      return []
    }

    return Object.entries(this.config.presets).map(([key, preset]) => ({
      key,
      name: preset.name,
      description: preset.description,
    }))
  }

  /**
   * Get default preset
   * Returns the preset named "default" if it exists, otherwise returns the first preset
   * @returns Default preset
   * @throws {ConfigError} When no presets are defined
   */
  getDefaultPreset(): Preset {
    if (!this.config) {
      throw new ConfigError("Configuration not loaded", ErrorCodes.CONFIG_NOT_FOUND)
    }

    // Look for "default" preset
    if (this.config.presets.default) {
      return this.config.presets.default
    }

    // Otherwise return the first preset
    const firstKey = Object.keys(this.config.presets)[0]
    if (firstKey === undefined) {
      throw new ConfigError("No presets defined", ErrorCodes.PRESET_NOT_FOUND)
    }

    return this.config.presets[firstKey]!
  }
}
