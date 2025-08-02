import fs from "fs-extra"
import path from "path"
import os from "os"
import * as yaml from "yaml"
import type { Config } from "../models/types"
import { ConfigError, ErrorCodes } from "../utils/errors"

export interface ConfigLoaderOptions {
  configPaths?: string[]
}

export class ConfigLoader {
  private searchPaths: string[]

  constructor(options: ConfigLoaderOptions = {}) {
    this.searchPaths = options.configPaths ?? this.buildDefaultSearchPaths()
  }

  /**
   * Loads the YAML string from the configuration file
   * @returns YAML string
   * @throws {ConfigError} When file is not found or cannot be read
   */
  async loadYAML(): Promise<string> {
    const filePath = await this.findConfigFile()

    if (filePath === null) {
      throw new ConfigError("Configuration file not found", ErrorCodes.CONFIG_NOT_FOUND, {
        searchPaths: this.searchPaths,
      })
    }

    try {
      const content = await fs.readFile(filePath, "utf8")
      return content
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      throw new ConfigError(`Failed to read configuration file`, ErrorCodes.CONFIG_PERMISSION_ERROR, {
        filePath,
        error: errorMessage,
      })
    }
  }

  /**
   * Load and parse the configuration file
   */
  async loadConfig(): Promise<Config> {
    const yamlContent = await this.loadYAML()

    try {
      if (!yamlContent.trim()) {
        return { presets: {} }
      }

      const parsed = yaml.parse(yamlContent) as Config | null

      if (parsed === null || typeof parsed !== "object") {
        return { presets: {} }
      }

      // Set empty object if presets doesn't exist
      if (!("presets" in parsed) || typeof parsed.presets !== "object") {
        return { presets: {} }
      }

      return parsed
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const filePath = await this.findConfigFile()

      throw new ConfigError(`Failed to parse YAML configuration file`, ErrorCodes.CONFIG_PARSE_ERROR, {
        filePath,
        parseError: errorMessage,
      })
    }
  }

  /**
   * Search for configuration file and return the path of the first file found
   */
  async findConfigFile(): Promise<string | null> {
    for (const searchPath of this.searchPaths) {
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
    return [...this.searchPaths]
  }

  /**
   * Build default search paths
   * Supports XDG Base Directory specification in a simple way
   */
  private buildDefaultSearchPaths(): string[] {
    const paths: string[] = []

    // 1. Environment variable override (highest priority)
    const vdeConfigPath = process.env.VDE_CONFIG_PATH
    if (vdeConfigPath !== undefined) {
      paths.push(path.join(vdeConfigPath, "layout.yml"))
    }

    // 2. XDG_CONFIG_HOME (standard location)
    const homeDir = process.env.HOME ?? os.homedir()
    const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config")
    paths.push(path.join(xdgConfigHome, "vde", "layout.yml"))

    // Remove duplicates
    return [...new Set(paths)]
  }
}
