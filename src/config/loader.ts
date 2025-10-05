import fs from "fs-extra"
import path from "path"
import os from "os"
import * as yaml from "yaml"
import type { Config } from "../models/types.ts"
import { ConfigError, ErrorCodes } from "../utils/errors.ts"
import { validateYAML } from "./validator.ts"

export interface ConfigLoaderOptions {
  configPaths?: string[]
}

export class ConfigLoader {
  private readonly explicitConfigPaths?: string[]

  constructor(options: ConfigLoaderOptions = {}) {
    this.explicitConfigPaths = options.configPaths
  }

  /**
   * Loads the YAML string from the configuration file
   * @returns YAML string
   * @throws {ConfigError} When file is not found or cannot be read
   */
  async loadYAML(): Promise<string> {
    const config = await this.loadCombinedConfig()
    return yaml.stringify(config)
  }

  /**
   * Load and parse configuration files
   */
  async loadConfig(): Promise<Config> {
    return this.loadCombinedConfig()
  }

  /**
   * Search for configuration file and return the path of the first file found
   */
  async findConfigFile(): Promise<string | null> {
    const searchPaths = await this.computeSearchPaths()
    for (const searchPath of searchPaths) {
      if (await fs.pathExists(searchPath)) {
        return searchPath
      }
    }
    return null
  }

  /**
   * Get search paths (for testing)
   */
  getSearchPaths(): string[] {
    return this.computeCachedSearchPaths()
  }

  /**
   * Build default search paths
   * Supports XDG Base Directory specification in a simple way
   */
  private buildDefaultSearchPaths(): string[] {
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

  private computeCachedSearchPaths(): string[] {
    if (this.explicitConfigPaths && this.explicitConfigPaths.length > 0) {
      return [...this.explicitConfigPaths]
    }

    const candidates: string[] = []
    const projectCandidate = this.findProjectConfigCandidate()
    if (projectCandidate !== null) {
      candidates.push(projectCandidate)
    }

    candidates.push(...this.buildDefaultSearchPaths())

    return [...new Set(candidates)]
  }

  private async computeSearchPaths(): Promise<string[]> {
    if (this.explicitConfigPaths && this.explicitConfigPaths.length > 0) {
      return [...this.explicitConfigPaths]
    }

    return this.computeCachedSearchPaths()
  }

  private findProjectConfigCandidate(): string | null {
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

  private async loadCombinedConfig(): Promise<Config> {
    if (this.explicitConfigPaths && this.explicitConfigPaths.length > 0) {
      const filePath = await this.findFirstExisting(this.explicitConfigPaths)
      if (filePath === null) {
        throw new ConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
          searchPaths: this.explicitConfigPaths,
        })
      }

      const content = await this.safeReadFile(filePath)
      return validateYAML(content)
    }

    const searchPaths = this.computeCachedSearchPaths()
    const existingPaths = await this.filterExistingPaths(searchPaths)

    if (existingPaths.length === 0) {
      throw new ConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
        searchPaths,
      })
    }

    const projectPath = this.findProjectConfigCandidate()
    const globalPaths = existingPaths.filter((filePath) => filePath !== projectPath)

    let mergedConfig: Config = { presets: {} }

    for (const globalPath of globalPaths) {
      const content = await this.safeReadFile(globalPath)
      const config = validateYAML(content)
      mergedConfig = mergeConfigs(mergedConfig, config)
    }

    if (projectPath !== null && (await fs.pathExists(projectPath))) {
      const content = await this.safeReadFile(projectPath)
      const config = validateYAML(content)
      mergedConfig = mergeConfigs(mergedConfig, config)
    }

    return mergedConfig
  }

  private async findFirstExisting(paths: string[]): Promise<string | null> {
    for (const candidate of paths) {
      if (await fs.pathExists(candidate)) {
        return candidate
      }
    }
    return null
  }

  private async filterExistingPaths(paths: string[]): Promise<string[]> {
    const existing: string[] = []
    for (const candidate of paths) {
      if (await fs.pathExists(candidate)) {
        existing.push(candidate)
      }
    }
    return existing
  }

  private async safeReadFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf8")
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new ConfigError(`Failed to read configuration file`, ErrorCodes.CONFIG_PERMISSION_ERROR, {
        filePath,
        error: errorMessage,
      })
    }
  }
}

const mergeConfigs = (base: Config, override: Config): Config => {
  return {
    presets: {
      ...base.presets,
      ...override.presets,
    },
  }
}
