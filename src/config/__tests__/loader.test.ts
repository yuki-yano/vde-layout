import fs from "fs-extra"
import os from "os"
import path from "path"
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { createConfigLoader, type ConfigLoader } from "../loader.ts"

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

      loader = createConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths).toHaveLength(1)
      expect(searchPaths[0]).toBe("/home/user/.config/vde/layout.yml")
    })

    it("builds paths from environment variables", () => {
      process.env.VDE_CONFIG_PATH = "/mock/vde/config"
      process.env.XDG_CONFIG_HOME = "/mock/.config"
      process.env.HOME = "/mock/home"

      loader = createConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths).toHaveLength(2)
      expect(searchPaths[0]).toBe("/mock/vde/config/layout.yml")
      expect(searchPaths[1]).toBe("/mock/.config/vde/layout.yml")
    })

    it("overrides paths with custom options", () => {
      loader = createConfigLoader({
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

      loader = createConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths[0]).toBe("/vde/config/layout.yml")
    })

    it("prioritizes XDG_CONFIG_HOME next", () => {
      delete process.env.VDE_CONFIG_PATH
      process.env.XDG_CONFIG_HOME = "/xdg/config"

      loader = createConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths[0]).toBe("/xdg/config/vde/layout.yml")
    })

    it("falls back to HOME directory", () => {
      delete process.env.VDE_CONFIG_PATH
      delete process.env.XDG_CONFIG_HOME
      process.env.HOME = "/home/user"

      loader = createConfigLoader()
      const searchPaths = loader.getSearchPaths()

      expect(searchPaths).toContain("/home/user/.config/vde/layout.yml")
    })

    it("removes duplicate paths", () => {
      delete process.env.VDE_CONFIG_PATH
      process.env.XDG_CONFIG_HOME = "/home/user/.config"
      process.env.HOME = "/home/user"

      loader = createConfigLoader()
      const searchPaths = loader.getSearchPaths()

      // Duplicates are removed, leaving only one
      const uniquePaths = new Set(searchPaths)
      expect(uniquePaths.size).toBe(searchPaths.length)
    })
  })

  describe("loadConfig - unit test", () => {
    it("throws ConfigError with appropriate error code", async () => {
      // Simulate file not existing
      loader = createConfigLoader({
        configPaths: ["/non/existent/path/layout.yml"],
      })

      await expect(loader.loadConfig()).rejects.toThrow(/Configuration file not found/)
    })
  })

  describe("Project configuration priority", () => {
    let tempDir: string
    let projectDir: string
    let xdgDir: string
    let cwdSpy: ReturnType<typeof vi.spyOn>

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vde-config-test-"))
      projectDir = path.join(tempDir, "project")
      xdgDir = path.join(tempDir, "xdg")

      await fs.ensureDir(path.join(projectDir, ".vde"))
      await fs.ensureDir(path.join(xdgDir, "vde"))

      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir)
      process.env.XDG_CONFIG_HOME = xdgDir
      delete process.env.VDE_CONFIG_PATH
    })

    afterEach(async () => {
      cwdSpy.mockRestore()
      await fs.remove(tempDir)
    })

    it("includes project-local config path in search paths when available", async () => {
      const localConfigPath = path.join(projectDir, ".vde", "layout.yml")
      await fs.writeFile(
        localConfigPath,
        "presets:\n  local:\n    name: local\n    layout:\n      type: horizontal\n      ratio: [1, 1]\n      panes:\n        - name: left\n        - name: right\n",
        "utf8",
      )

      const loaderWithLocal = createConfigLoader()
      const searchPaths = loaderWithLocal.getSearchPaths()

      expect(searchPaths[0]).toBe(localConfigPath)
    })

    it("merges global and project configs preferring project values", async () => {
      const globalConfigPath = path.join(xdgDir, "vde", "layout.yml")
      await fs.writeFile(
        globalConfigPath,
        "presets:\n  shared:\n    name: global shared\n    layout:\n      type: vertical\n      ratio: [1, 1]\n      panes:\n        - name: gtop\n        - name: gbottom\n  dev:\n    name: global dev\n    layout:\n      type: horizontal\n      ratio: [1, 1]\n      panes:\n        - name: gleft\n        - name: gright\n",
        "utf8",
      )

      const localConfigPath = path.join(projectDir, ".vde", "layout.yml")
      await fs.writeFile(
        localConfigPath,
        "presets:\n  dev:\n    name: project dev\n    layout:\n      type: horizontal\n      ratio: [2, 1]\n      panes:\n        - name: left\n        - name: right\n",
        "utf8",
      )

      const loaderWithMerge = createConfigLoader()
      const config = await loaderWithMerge.loadConfig()

      expect(Object.keys(config.presets)).toContain("shared")
      expect(config.presets.dev?.name).toBe("project dev")
      expect(config.presets.shared?.name).toBe("global shared")
    })

    it("overrides defaults.windowMode with project value and logs conflict", async () => {
      const globalConfigPath = path.join(xdgDir, "vde", "layout.yml")
      await fs.writeFile(
        globalConfigPath,
        "defaults:\n  windowMode: new-window\npresets:\n  dev:\n    name: global dev\n    windowMode: new-window\n    layout:\n      type: horizontal\n      ratio: [1, 1]\n      panes:\n        - name: gleft\n        - name: gright\n",
        "utf8",
      )

      const localConfigPath = path.join(projectDir, ".vde", "layout.yml")
      await fs.writeFile(
        localConfigPath,
        "defaults:\n  windowMode: current-window\npresets:\n  dev:\n    name: project dev\n    layout:\n      type: horizontal\n      ratio: [2, 1]\n      panes:\n        - name: left\n        - name: right\n",
        "utf8",
      )

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const loaderWithMerge = createConfigLoader()
      const config = await loaderWithMerge.loadConfig()

      expect(config.defaults?.windowMode).toBe("current-window")
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("defaults.windowMode conflict"))
      warnSpy.mockRestore()
    })

    it("logs preset windowMode conflict when overriding", async () => {
      const globalConfigPath = path.join(xdgDir, "vde", "layout.yml")
      await fs.writeFile(
        globalConfigPath,
        "presets:\n  dev:\n    name: global dev\n    windowMode: new-window\n    layout:\n      type: horizontal\n      ratio: [1, 1]\n      panes:\n        - name: gleft\n        - name: gright\n",
        "utf8",
      )

      const localConfigPath = path.join(projectDir, ".vde", "layout.yml")
      await fs.writeFile(
        localConfigPath,
        "presets:\n  dev:\n    name: project dev\n    windowMode: current-window\n    layout:\n      type: horizontal\n      ratio: [2, 1]\n      panes:\n        - name: left\n        - name: right\n",
        "utf8",
      )

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const loaderWithMerge = createConfigLoader()
      const config = await loaderWithMerge.loadConfig()

      expect(config.presets.dev?.windowMode).toBe("current-window")
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Preset "dev" windowMode conflict'))
      warnSpy.mockRestore()
    })
  })

  // Restore environment
  afterAll(() => {
    process.env = originalEnv
  })
})
