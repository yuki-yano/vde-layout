import type { Config, Preset, PresetInfo } from "../models/types.ts"

export type PresetManager = {
  readonly loadConfig: () => Promise<void>
  readonly getPreset: (name: string) => Preset
  readonly getDefaultPreset: () => Preset
  readonly listPresets: () => PresetInfo[]
  readonly getDefaults: () => Config["defaults"] | undefined
  readonly setConfigPath?: (filePath: string) => void
}
