import { describe, it, expect } from "vitest"
import {
  PaneSchema,
  LayoutSchema,
  PresetSchema,
  ConfigSchema,
  validateConfig,
  validatePreset,
  validatePane,
} from "../schema.ts"
import type { Pane, Layout, Preset, Config } from "../types.ts"

describe("Zod schema validation", () => {
  describe("PaneSchema", () => {
    it("validates valid terminal pane definition", () => {
      const validPane: Pane = {
        name: "editor",
        command: "nvim",
        cwd: "~/projects",
        env: { NODE_ENV: "development" },
        delay: 1000,
        title: "Editor",
        focus: true,
      }

      const result = PaneSchema.safeParse(validPane)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(validPane)
      }
    })

    it("validates valid split container definition", () => {
      const validPane: Pane = {
        type: "horizontal",
        ratio: [60, 40],
        panes: [{ name: "left" }, { name: "right" }],
      }

      const result = PaneSchema.safeParse(validPane)
      expect(result.success).toBe(true)
    })

    it("validates nested split structure", () => {
      const nestedPane: Pane = {
        type: "horizontal",
        ratio: [70, 30],
        panes: [
          {
            type: "vertical",
            ratio: [50, 50],
            panes: [{ name: "top-left" }, { name: "bottom-left" }],
          },
          { name: "right", command: "htop" },
        ],
      }

      const result = PaneSchema.safeParse(nestedPane)
      expect(result.success).toBe(true)
    })

    it("rejects invalid type value", () => {
      const invalidPane = {
        type: "diagonal" as unknown,
        ratio: [50, 50],
        panes: [{ name: "a" }, { name: "b" }],
      }

      const result = PaneSchema.safeParse(invalidPane)
      expect(result.success).toBe(false)
    })

    it("detects mismatch between ratio and panes element count", () => {
      const invalidPane = {
        type: "horizontal",
        ratio: [40, 30, 30],
        panes: [{ name: "pane1" }, { name: "pane2" }],
      }

      const result = validatePane(invalidPane)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain(
          "Number of elements in ratio array does not match number of elements in panes array",
        )
      }
    })
  })

  describe("LayoutSchema", () => {
    it("validates valid layout definition", () => {
      const validLayout: Layout = {
        type: "vertical",
        ratio: [70, 30],
        panes: [{ name: "main", command: "nvim" }, { name: "terminal" }],
      }

      const result = LayoutSchema.safeParse(validLayout)
      expect(result.success).toBe(true)
    })

    it("validates that type is required for layout", () => {
      const invalidLayout = {
        ratio: [50, 50],
        panes: [{ name: "a" }, { name: "b" }],
      }

      const result = LayoutSchema.safeParse(invalidLayout)
      expect(result.success).toBe(false)
    })
  })

  describe("PresetSchema", () => {
    it("validates valid preset definition", () => {
      const validPreset: Preset = {
        name: "Development Environment",
        description: "Full-stack development setup",
        layout: {
          type: "horizontal",
          ratio: [70, 30],
          panes: [{ name: "editor" }, { name: "terminal" }],
        },
      }

      const result = PresetSchema.safeParse(validPreset)
      expect(result.success).toBe(true)
    })

    it("validates that name is required", () => {
      const invalidPreset = {
        description: "Missing required name field",
      }

      const result = PresetSchema.safeParse(invalidPreset)
      expect(result.success).toBe(false)
    })

    it("validates preset with command but no layout", () => {
      const validPreset: Preset = {
        name: "Simple Command",
        description: "Just run a command",
        command: "htop",
      }

      const result = PresetSchema.safeParse(validPreset)
      expect(result.success).toBe(true)
    })

    it("validates preset with neither layout nor command", () => {
      const validPreset: Preset = {
        name: "Default Shell",
        description: "Just start a shell",
      }

      const result = PresetSchema.safeParse(validPreset)
      expect(result.success).toBe(true)
    })
  })

  describe("ConfigSchema", () => {
    it("validates entire valid configuration file", () => {
      const validConfig: Config = {
        presets: {
          default: {
            name: "Default Layout",
            layout: {
              type: "horizontal",
              ratio: [50, 50],
              panes: [{ name: "left" }, { name: "right" }],
            },
          },
          development: {
            name: "Development Layout",
            description: "For coding",
            layout: {
              type: "vertical",
              ratio: [80, 20],
              panes: [{ name: "editor", command: "nvim" }, { name: "terminal" }],
            },
          },
        },
      }

      const result = ConfigSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it("allows empty presets definition", () => {
      const emptyConfig: Config = {
        presets: {},
      }

      const result = ConfigSchema.safeParse(emptyConfig)
      expect(result.success).toBe(true)
    })
  })

  describe("Validation functions", () => {
    it("validateConfig returns error messages", () => {
      const invalidConfig = {
        presets: {
          test: {
            // name is missing (required field)
            description: "Test preset without name",
          },
        },
      }

      const result = validateConfig(invalidConfig)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain("name")
      }
    })

    it("validatePreset returns detailed errors", () => {
      const invalidPreset = {
        name: "Invalid",
        layout: {
          type: "horizontal",
          ratio: [60, 40],
          panes: [{ name: "only-one" }], // insufficient panes
        },
      }

      const result = validatePreset(invalidPreset)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toMatch(/Number of elements in ratio array does not match|At least 2 required/)
      }
    })
  })
})
