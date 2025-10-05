import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { PresetManager } from "../preset.ts"
import { ConfigError } from "../../utils/errors.ts"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

describe("PresetManager", () => {
  let presetManager: PresetManager
  let tempDir: string
  let originalXDGConfigHome: string | undefined
  let originalVDEConfigPath: string | undefined

  beforeEach(async () => {
    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vde-layout-test-"))

    // Specify only specific path to PresetManager for testing
    presetManager = new PresetManager({
      configPaths: [path.join(tempDir, "layout.yml")],
    })

    // Save environment variables
    originalXDGConfigHome = process.env.XDG_CONFIG_HOME
    originalVDEConfigPath = process.env.VDE_CONFIG_PATH
  })

  afterEach(async () => {
    // Restore environment variables
    if (originalXDGConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXDGConfigHome
    } else {
      delete process.env.XDG_CONFIG_HOME
    }

    if (originalVDEConfigPath !== undefined) {
      process.env.VDE_CONFIG_PATH = originalVDEConfigPath
    } else {
      delete process.env.VDE_CONFIG_PATH
    }

    // Delete temporary directory
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe("loadConfig", () => {
    it("should load and validate configuration", async () => {
      const yamlContent = `
presets:
  default:
    name: default
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
  work:
    name: work
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: dev-server
          command: npm run dev
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)

      await presetManager.loadConfig()

      // Confirm configuration was loaded correctly
      const defaultPreset = presetManager.getPreset("default")
      expect(defaultPreset).toBeDefined()
      expect(defaultPreset.name).toBe("default")

      const workPreset = presetManager.getPreset("work")
      expect(workPreset).toBeDefined()
      expect(workPreset.name).toBe("work")
    })

    it("should handle configuration loading errors", async () => {
      // When configuration file does not exist
      await expect(presetManager.loadConfig()).rejects.toThrow(ConfigError)
    })

    it("should handle validation errors", async () => {
      const invalidYaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: unknown
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), invalidYaml)

      await expect(presetManager.loadConfig()).rejects.toThrow()
    })
  })

  describe("getPreset", () => {
    it("should return a specific preset by name", async () => {
      const yamlContent = `
presets:
  default:
    name: default
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const preset = presetManager.getPreset("default")
      expect(preset).toBeDefined()
      expect(preset.name).toBe("default")
      expect(preset.layout.panes).toHaveLength(2)
      expect(preset.layout.panes[0]).toMatchObject({
        command: "vim",
        name: "editor",
      })
    })

    it("should throw error for non-existent preset", async () => {
      const yamlContent = `
presets:
  default:
    name: default
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: pane1
        - name: pane2
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      expect(() => presetManager.getPreset("nonexistent")).toThrow(ConfigError)
      expect(() => presetManager.getPreset("nonexistent")).toThrow('Preset "nonexistent" not found')
    })

    it("should throw error if config not loaded", () => {
      expect(() => presetManager.getPreset("default")).toThrow(ConfigError)
      expect(() => presetManager.getPreset("default")).toThrow("Configuration not loaded")
    })
  })

  describe("listPresets", () => {
    it("should list all available presets", async () => {
      const yamlContent = `
presets:
  default:
    name: default
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
  work:
    name: work
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: dev-server
          command: npm run dev
        - name: build
          command: npm build
  test:
    name: test
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: test
          command: npm test
        - name: coverage
          command: npm run coverage
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const presets = presetManager.listPresets()
      expect(presets).toHaveLength(3)
      expect(presets.map((p) => p.key)).toEqual(["default", "work", "test"])
      expect(presets[0]).toMatchObject({
        key: "default",
      })
    })

    it("should return empty array if no config loaded", () => {
      const presets = presetManager.listPresets()
      expect(presets).toEqual([])
    })
  })

  describe("getDefaultPreset", () => {
    it('should return "default" preset if it exists', async () => {
      const yamlContent = `
presets:
  default:
    name: default
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
  work:
    name: work
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: dev-server
          command: npm run dev
        - name: test
          command: npm test
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const preset = presetManager.getDefaultPreset()
      expect(preset).toBeDefined()
      expect(preset.name).toBe("default")
    })

    it('should return first preset if "default" does not exist', async () => {
      const yamlContent = `
presets:
  work:
    name: work
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: dev-server
          command: npm run dev
        - name: build
          command: npm build
  test:
    name: test
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: test
          command: npm test
        - name: coverage
          command: npm run coverage
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const preset = presetManager.getDefaultPreset()
      expect(preset).toBeDefined()
      expect(["work", "test"]).toContain(preset.name)
    })
  })

  describe("YAML parsing", () => {
    it("should parse simple terminal pane", async () => {
      const yamlContent = `
presets:
  simple:
    name: simple
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
          cwd: /home/user
          env:
            NODE_ENV: development
          focus: true
        - name: monitor
          command: htop
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const preset = presetManager.getPreset("simple")
      expect(preset.layout.type).toBe("horizontal")
      expect(preset.layout.panes).toHaveLength(2)
      expect(preset.layout.panes[0]).toMatchObject({
        command: "vim",
        cwd: "/home/user",
        env: { NODE_ENV: "development" },
        name: "editor",
        focus: true,
      })
    })

    it("should parse split layout correctly", async () => {
      const yamlContent = `
presets:
  split:
    name: split
    layout:
      type: vertical
      ratio: [70, 30]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const preset = presetManager.getPreset("split")
      expect(preset.layout.type).toBe("vertical")
      expect(preset.layout.ratio).toEqual([70, 30])
      expect(preset.layout.panes).toHaveLength(2)
    })

    it("should handle nested split layouts", async () => {
      const yamlContent = `
presets:
  complex:
    name: complex
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - type: vertical
          ratio: [60, 40]
          panes:
            - name: dev-server
              command: npm run dev
            - name: test
              command: npm test
`

      await fs.writeFile(path.join(tempDir, "layout.yml"), yamlContent)
      await presetManager.loadConfig()

      const preset = presetManager.getPreset("complex")
      expect(preset.layout.type).toBe("horizontal")
      expect(preset.layout.ratio).toEqual([50, 50])
      expect(preset.layout.panes).toHaveLength(2)

      const secondPane = preset.layout.panes[1]
      expect(secondPane).toHaveProperty("type", "vertical")
      expect(secondPane).toHaveProperty("ratio", [60, 40])
    })
  })
})
