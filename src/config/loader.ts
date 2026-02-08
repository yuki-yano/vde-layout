import fs from "fs-extra"
import path from "path"
import os from "os"
import * as yaml from "yaml"
import type { Config } from "../models/types"
import { createConfigError, ErrorCodes } from "../utils/errors"
import { validateYAML } from "./validator"

export type ConfigLoaderOptions = {
  readonly configPaths?: string[]
}

export type ConfigLoader = {
  readonly loadYAML: () => Promise<string>
  readonly loadConfig: () => Promise<Config>
  readonly findConfigFile: () => Promise<string | null>
  readonly getSearchPaths: () => string[]
}

export const createConfigLoader = (options: ConfigLoaderOptions = {}): ConfigLoader => {
  const explicitConfigPaths = options.configPaths

  const computeCachedSearchPaths = (): string[] => {
    if (explicitConfigPaths && explicitConfigPaths.length > 0) {
      return [...explicitConfigPaths]
    }

    const candidates: string[] = []
    const projectCandidate = findProjectConfigCandidate()
    if (projectCandidate !== null) {
      candidates.push(projectCandidate)
    }

    candidates.push(...buildDefaultSearchPaths())

    return [...new Set(candidates)]
  }

  const loadConfig = async (): Promise<Config> => {
    if (explicitConfigPaths && explicitConfigPaths.length > 0) {
      const filePath = await findFirstExisting(explicitConfigPaths)
      if (filePath === null) {
        throw createConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
          searchPaths: explicitConfigPaths,
        })
      }

      const content = await safeReadFile(filePath)
      return validateYAML(content)
    }

    const searchPaths = computeCachedSearchPaths()
    const existingPaths = await filterExistingPaths(searchPaths)

    if (existingPaths.length === 0) {
      throw createConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
        searchPaths,
      })
    }

    const projectPath = findProjectConfigCandidate()
    const globalPaths = existingPaths.filter((filePath) => filePath !== projectPath)

    let mergedConfig: Config = { presets: {} }

    for (const globalPath of globalPaths) {
      const content = await safeReadFile(globalPath)
      const config = validateYAML(content)
      mergedConfig = mergeConfigs(mergedConfig, config)
    }

    if (projectPath !== null && (await fs.pathExists(projectPath))) {
      const content = await safeReadFile(projectPath)
      const config = validateYAML(content)
      mergedConfig = mergeConfigs(mergedConfig, config)
    }

    return applyDefaults(mergedConfig)
  }

  return {
    loadYAML: async (): Promise<string> => {
      const config = await loadConfig()
      return yaml.stringify(config)
    },
    loadConfig,
    findConfigFile: async (): Promise<string | null> => {
      const searchPaths =
        explicitConfigPaths && explicitConfigPaths.length > 0 ? [...explicitConfigPaths] : computeCachedSearchPaths()

      for (const searchPath of searchPaths) {
        if (await fs.pathExists(searchPath)) {
          return searchPath
        }
      }
      return null
    },
    getSearchPaths: (): string[] => computeCachedSearchPaths(),
  }
}

const buildDefaultSearchPaths = (): string[] => {
  const paths: string[] = []

  const vdeConfigPath = process.env.VDE_CONFIG_PATH
  if (vdeConfigPath !== undefined) {
    paths.push(path.join(vdeConfigPath, "layout.yml"))
  }

  const homeDir = process.env.HOME ?? os.homedir()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config")
  paths.push(path.join(xdgConfigHome, "vde", "layout.yml"))

  return [...new Set(paths)]
}

const findProjectConfigCandidate = (): string | null => {
  let currentDir = process.cwd()
  const { root } = path.parse(currentDir)

  while (true) {
    const candidate = path.join(currentDir, ".vde", "layout.yml")
    if (fs.existsSync(candidate)) {
      return candidate
    }

    if (currentDir === root) {
      break
    }

    const parent = path.dirname(currentDir)
    if (parent === currentDir) {
      break
    }

    currentDir = parent
  }

  return null
}

const findFirstExisting = async (paths: ReadonlyArray<string>): Promise<string | null> => {
  for (const candidate of paths) {
    if (await fs.pathExists(candidate)) {
      return candidate
    }
  }
  return null
}

const filterExistingPaths = async (paths: ReadonlyArray<string>): Promise<string[]> => {
  const existing: string[] = []
  for (const candidate of paths) {
    if (await fs.pathExists(candidate)) {
      existing.push(candidate)
    }
  }
  return existing
}

const safeReadFile = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw createConfigError(`Failed to read configuration file`, ErrorCodes.CONFIG_PERMISSION_ERROR, {
      filePath,
      error: errorMessage,
    })
  }
}

const mergeConfigs = (base: Config, override: Config): Config => {
  const mergedPresets: Config["presets"] = { ...base.presets }

  for (const [presetKey, overridePreset] of Object.entries(override.presets)) {
    const basePreset = base.presets[presetKey]
    if (
      basePreset !== undefined &&
      basePreset.windowMode !== undefined &&
      overridePreset.windowMode !== undefined &&
      basePreset.windowMode !== overridePreset.windowMode
    ) {
      console.warn(
        `[vde-layout] Preset "${presetKey}" windowMode conflict: "${basePreset.windowMode}" overridden by "${overridePreset.windowMode}"`,
      )
    }
    mergedPresets[presetKey] = overridePreset
  }

  const baseDefaults = base.defaults
  const overrideDefaults = override.defaults

  if (
    baseDefaults?.windowMode !== undefined &&
    overrideDefaults?.windowMode !== undefined &&
    baseDefaults.windowMode !== overrideDefaults.windowMode
  ) {
    console.warn(
      `[vde-layout] defaults.windowMode conflict: "${baseDefaults.windowMode}" overridden by "${overrideDefaults.windowMode}"`,
    )
  }

  const mergedDefaults =
    baseDefaults !== undefined || overrideDefaults !== undefined
      ? {
          ...(baseDefaults ?? {}),
          ...(overrideDefaults ?? {}),
        }
      : undefined

  return mergedDefaults === undefined
    ? {
        presets: mergedPresets,
      }
    : {
        defaults: mergedDefaults,
        presets: mergedPresets,
      }
}

const applyDefaults = (config: Config): Config => {
  return config
}
