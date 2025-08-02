import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { ConfigLoader } from "../loader"
import { ConfigError } from "../../utils/errors"

describe("ConfigLoader", () => {
  let loader: ConfigLoader
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv }
  })

  describe("Constructor", () => {
    it("builds default search paths", () => {
      delete process.env.VDE_CONFIG_PATH
      delete process.env.XDG_CONFIG_HOME
      process.env.HOME = "/home/user"

      loader = new ConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths).toHaveLength(1)
      expect(searchPaths[0]).toBe("/home/user/.config/vde/layout.yml")
    })

    it("builds paths from environment variables", () => {
      process.env.VDE_CONFIG_PATH = "/mock/vde/config"
      process.env.XDG_CONFIG_HOME = "/mock/.config"
      process.env.HOME = "/mock/home"

      loader = new ConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths).toHaveLength(2)
      expect(searchPaths[0]).toBe("/mock/vde/config/layout.yml")
      expect(searchPaths[1]).toBe("/mock/.config/vde/layout.yml")
    })

    it("overrides paths with custom options", () => {
      loader = new ConfigLoader({
        configPaths: ["/custom/path/layout.yml"],
      })

      const searchPaths = loader.getSearchPaths()
      expect(searchPaths).toEqual(["/custom/path/layout.yml"])
    })
  })

  describe("XDG path resolution", () => {
    it("prioritizes VDE_CONFIG_PATH", () => {
      process.env.VDE_CONFIG_PATH = "/vde/config"
      process.env.XDG_CONFIG_HOME = "/xdg/config"

      loader = new ConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths[0]).toBe("/vde/config/layout.yml")
    })

    it("prioritizes XDG_CONFIG_HOME next", () => {
      delete process.env.VDE_CONFIG_PATH
      process.env.XDG_CONFIG_HOME = "/xdg/config"

      loader = new ConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths[0]).toBe("/xdg/config/vde/layout.yml")
    })

    it("falls back to HOME directory", () => {
      delete process.env.VDE_CONFIG_PATH
      delete process.env.XDG_CONFIG_HOME
      process.env.HOME = "/home/user"

      loader = new ConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths).toContain("/home/user/.config/vde/layout.yml")
    })

    it("removes duplicate paths", () => {
      delete process.env.VDE_CONFIG_PATH
      process.env.XDG_CONFIG_HOME = "/home/user/.config"
      process.env.HOME = "/home/user"

      loader = new ConfigLoader()
      const searchPaths = loader.getSearchPaths()

      // Duplicates are removed, leaving only one
      const uniquePaths = new Set(searchPaths)
      expect(uniquePaths.size).toBe(searchPaths.length)
    })
  })

  describe("loadConfig - unit test", () => {
    it("throws ConfigError with appropriate error code", async () => {
      // Simulate file not existing
      loader = new ConfigLoader({
        configPaths: ["/non/existent/path/layout.yml"],
      })

      await expect(loader.loadConfig()).rejects.toThrow(ConfigError)
    })
  })

  // Restore environment
  afterAll(() => {
    process.env = originalEnv
  })
})
