import fs from "fs-extra"
import path from "path"
import os from "os"
import * as yaml from "yaml"
import type { Config } from "../models/types"
import { createConfigError, ErrorCodes } from "../utils/errors"
import { validateYAML } from "./validator"

export type ConfigLoaderOptions = {
  readonly configPaths?: string[]
  readonly onWarning?: (message: string) => void
}

export type ConfigLoader = {
  readonly loadYAML: () => Promise<string>
  readonly loadConfig: () => Promise<Config>
  readonly findConfigFile: () => Promise<string | null>
  readonly getSearchPaths: () => string[]
}

type SearchPathGroup = readonly string[]
type SelectorDefaults = NonNullable<NonNullable<Config["defaults"]>["selector"]>

export const createConfigLoader = (options: ConfigLoaderOptions = {}): ConfigLoader => {
  const explicitConfigPaths = options.configPaths
  const emitWarning: (message: string) => void = options.onWarning ?? ((message: string): void => console.warn(message))

  const computeCachedSearchPaths = (): string[] => {
    if (explicitConfigPaths && explicitConfigPaths.length > 0) {
      return [...explicitConfigPaths]
    }

    const candidates: string[] = []
    const projectCandidate = findProjectConfigCandidate()
    if (projectCandidate !== null) {
      candidates.push(projectCandidate)
    }

    const defaultSearchPathGroups = buildDefaultSearchPathGroups()
    candidates.push(...flattenSearchPathGroups(defaultSearchPathGroups))

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
    const defaultSearchPathGroups = buildDefaultSearchPathGroups()
    const globalPaths = await resolveFirstExistingPaths(defaultSearchPathGroups)
    const projectPath = findProjectConfigCandidate()
    const projectConfigExists = projectPath !== null ? await fs.pathExists(projectPath) : false

    if (globalPaths.length === 0 && !projectConfigExists) {
      throw createConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
        searchPaths,
      })
    }

    let mergedConfig: Config = { presets: {} }

    for (const globalPath of globalPaths) {
      const content = await safeReadFile(globalPath)
      const config = validateYAML(content)
      mergedConfig = mergeConfigs(mergedConfig, config, emitWarning)
    }

    if (projectPath !== null && projectConfigExists) {
      const content = await safeReadFile(projectPath)
      const config = validateYAML(content)
      mergedConfig = mergeConfigs(mergedConfig, config, emitWarning)
    }

    return mergedConfig
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

const buildDefaultSearchPathGroups = (): ReadonlyArray<SearchPathGroup> => {
  const pathGroups: string[][] = []

  const vdeConfigPath = process.env.VDE_CONFIG_PATH
  if (vdeConfigPath !== undefined) {
    pathGroups.push([path.join(vdeConfigPath, "layout.yml")])
  }

  const homeDir = process.env.HOME ?? os.homedir()
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config")
  pathGroups.push([
    path.join(xdgConfigHome, "vde", "layout", "config.yml"),
    path.join(xdgConfigHome, "vde", "layout.yml"),
  ])

  return pathGroups.map((group): SearchPathGroup => [...new Set(group)])
}

const flattenSearchPathGroups = (pathGroups: ReadonlyArray<SearchPathGroup>): string[] => {
  const paths: string[] = []
  for (const group of pathGroups) {
    paths.push(...group)
  }
  return [...new Set(paths)]
}

const resolveFirstExistingPaths = async (pathGroups: ReadonlyArray<SearchPathGroup>): Promise<string[]> => {
  const existingPaths = await Promise.all(pathGroups.map(async (group) => findFirstExisting(group)))
  const seenPaths = new Set<string>()
  const resolvedPaths: string[] = []

  for (const existingPath of existingPaths) {
    if (existingPath !== null && !seenPaths.has(existingPath)) {
      seenPaths.add(existingPath)
      resolvedPaths.push(existingPath)
    }
  }

  return resolvedPaths
}

const findProjectConfigCandidate = (): string | null => {
  let currentDir = process.cwd()
  const { root } = path.parse(currentDir)

  while (true) {
    const candidates = [
      path.join(currentDir, ".vde", "layout", "config.yml"),
      path.join(currentDir, ".vde", "layout.yml"),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
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

const mergeConfigs = (base: Config, override: Config, emitWarning: (message: string) => void): Config => {
  const mergedPresets: Config["presets"] = { ...base.presets }

  for (const [presetKey, overridePreset] of Object.entries(override.presets)) {
    const basePreset = base.presets[presetKey]
    if (
      basePreset !== undefined &&
      basePreset.windowMode !== undefined &&
      overridePreset.windowMode !== undefined &&
      basePreset.windowMode !== overridePreset.windowMode
    ) {
      emitWarning(
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
    emitWarning(
      `[vde-layout] defaults.windowMode conflict: "${baseDefaults.windowMode}" overridden by "${overrideDefaults.windowMode}"`,
    )
  }

  const mergedSelectorDefaults = mergeSelectorDefaults({
    baseSelector: baseDefaults?.selector,
    overrideSelector: overrideDefaults?.selector,
    emitWarning,
  })

  const mergedDefaults =
    baseDefaults !== undefined || overrideDefaults !== undefined
      ? {
          ...(baseDefaults ?? {}),
          ...(overrideDefaults ?? {}),
          ...(mergedSelectorDefaults !== undefined ? { selector: mergedSelectorDefaults } : {}),
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

const mergeSelectorDefaults = ({
  baseSelector,
  overrideSelector,
  emitWarning,
}: {
  readonly baseSelector: SelectorDefaults | undefined
  readonly overrideSelector: SelectorDefaults | undefined
  readonly emitWarning: (message: string) => void
}): SelectorDefaults | undefined => {
  if (baseSelector === undefined && overrideSelector === undefined) {
    return undefined
  }

  if (baseSelector?.ui !== undefined && overrideSelector?.ui !== undefined && baseSelector.ui !== overrideSelector.ui) {
    emitWarning(
      `[vde-layout] defaults.selector.ui conflict: "${baseSelector.ui}" overridden by "${overrideSelector.ui}"`,
    )
  }

  if (
    baseSelector?.surface !== undefined &&
    overrideSelector?.surface !== undefined &&
    baseSelector.surface !== overrideSelector.surface
  ) {
    emitWarning(
      `[vde-layout] defaults.selector.surface conflict: "${baseSelector.surface}" overridden by "${overrideSelector.surface}"`,
    )
  }

  if (
    baseSelector?.tmuxPopupOpts !== undefined &&
    overrideSelector?.tmuxPopupOpts !== undefined &&
    baseSelector.tmuxPopupOpts !== overrideSelector.tmuxPopupOpts
  ) {
    emitWarning(
      `[vde-layout] defaults.selector.tmuxPopupOpts conflict: "${baseSelector.tmuxPopupOpts}" overridden by "${overrideSelector.tmuxPopupOpts}"`,
    )
  }

  const baseExtraArgs = baseSelector?.fzf?.extraArgs
  const overrideExtraArgs = overrideSelector?.fzf?.extraArgs
  if (
    Array.isArray(baseExtraArgs) &&
    Array.isArray(overrideExtraArgs) &&
    JSON.stringify(baseExtraArgs) !== JSON.stringify(overrideExtraArgs)
  ) {
    emitWarning(`[vde-layout] defaults.selector.fzf.extraArgs conflict: global value overridden by project value`)
  }

  const mergedFzf =
    baseSelector?.fzf !== undefined || overrideSelector?.fzf !== undefined
      ? {
          ...(baseSelector?.fzf ?? {}),
          ...(overrideSelector?.fzf ?? {}),
        }
      : undefined

  return {
    ...(baseSelector ?? {}),
    ...(overrideSelector ?? {}),
    ...(mergedFzf !== undefined ? { fzf: mergedFzf } : {}),
  }
}
