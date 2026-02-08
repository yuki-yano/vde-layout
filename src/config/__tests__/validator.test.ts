import { describe, expect, it } from "vitest"
import { validateYAML } from "../validator"
import { isVDELayoutError, type VDELayoutError } from "../../utils/errors"

const captureValidationError = (fn: () => unknown): VDELayoutError => {
  try {
    fn()
    expect.fail("Expected ValidationError to be thrown")
  } catch (error) {
    expect(isVDELayoutError(error)).toBe(true)
    const vdeError = error as VDELayoutError
    expect(vdeError.name).toBe("ValidationError")
    return vdeError
  }

  throw new Error("unreachable")
}

describe("validateYAML", () => {
  describe("valid configurations", () => {
    it("should validate minimal valid config", () => {
      const yaml = `
presets:
  minimal:
    name: minimal
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`
      const result = validateYAML(yaml)
      expect(result).toEqual({
        presets: {
          minimal: {
            name: "minimal",
            layout: {
              type: "horizontal",
              ratio: [50, 50],
              panes: [
                {
                  name: "editor",
                  command: "vim",
                },
                {
                  name: "monitor",
                  command: "htop",
                },
              ],
            },
          },
        },
      })
    })

    it("should validate complex nested layout", () => {
      const yaml = `
presets:
  complex:
    name: complex
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
          cwd: ~/projects
        - type: vertical
          ratio: [70, 30]
          panes:
            - name: dev
              command: npm run dev
            - name: test
              command: npm test -- --watch
`
      const result = validateYAML(yaml)
      expect(result.presets.complex).toBeDefined()
      expect(result.presets.complex!.name).toBe("complex")
      expect(result.presets.complex!.layout!.type).toBe("horizontal")
    })

    it("should validate config with multiple presets", () => {
      const yaml = `
presets:
  dev:
    name: dev
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
  test:
    name: test
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: tester
          command: npm test
        - name: dev-server
          command: npm run dev
`
      const result = validateYAML(yaml)
      expect(Object.keys(result.presets)).toEqual(["dev", "test"])
    })

    it("should validate all pane options", () => {
      const yaml = `
presets:
  full:
    name: full
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - command: vim
          cwd: /tmp
          env:
            NODE_ENV: development
            PORT: "3000"
          name: editor
          focus: true
        - name: monitor
          command: htop
`
      const result = validateYAML(yaml)
      expect(result.presets.full).toBeDefined()
      const pane = result.presets.full!.layout!.panes[0]!
      expect(pane).toMatchObject({
        command: "vim",
        cwd: "/tmp",
        env: {
          NODE_ENV: "development",
          PORT: "3000",
        },
        name: "editor",
        focus: true,
      })
    })
  })

  it("should accept windowMode on defaults and presets", () => {
    const yaml = `
defaults:
  windowMode: current-window
presets:
  dev:
    name: dev
    windowMode: new-window
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
  ops:
    name: ops
    layout:
      type: horizontal
      ratio: [60, 40]
      panes:
        - name: deploy
          command: ./deploy.sh
        - name: logs
          command: tail -f logs.txt
`
    const result = validateYAML(yaml)
    expect(result.defaults?.windowMode).toBe("current-window")
    expect(result.presets.dev?.windowMode).toBe("new-window")
    expect(result.presets.ops?.windowMode).toBeUndefined()
  })

  describe("invalid configurations", () => {
    it("should throw ValidationError for invalid YAML syntax", () => {
      const yaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: horizontal
    invalid indentation here
`
      const error = captureValidationError(() => validateYAML(yaml))
      expect(error.message).toMatch(/Failed to parse YAML/)
    })

    it("should throw ValidationError for missing presets", () => {
      const yaml = `
config:
  something: else
`
      const error = captureValidationError(() => validateYAML(yaml))
      expect(error.message).toMatch(/presets field is required/)
    })

    it("should throw ValidationError for invalid windowMode", () => {
      const yaml = `
presets:
  dev:
    name: dev
    windowMode: side-window
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`
      const error = captureValidationError(() => validateYAML(yaml))
      expect(error.message).toMatch(/Invalid enum value/)
    })

    it("should throw ValidationError for invalid layout type", () => {
      const yaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: unknown
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`
      captureValidationError(() => validateYAML(yaml))
    })

    it("should accept terminal pane without command", () => {
      const yaml = `
presets:
  valid:
    name: valid
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: pane1
        - name: pane2
`
      const result = validateYAML(yaml)
      expect(result.presets.valid).toBeDefined()
      expect(result.presets.valid!.layout!.panes[0]).toEqual({ name: "pane1" })
    })

    it("should throw ValidationError for missing panes in layout", () => {
      const yaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: horizontal
      ratio: [50, 50]
`
      const error = captureValidationError(() => validateYAML(yaml))
      expect(error.message).toBeTruthy()
    })

    it("should throw ValidationError for ratio/panes mismatch", () => {
      const yaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: horizontal
      ratio: [50, 50, 10]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`
      const error = captureValidationError(() => validateYAML(yaml))
      expect(error.message).toMatch(
        /Number of elements in ratio array does not match number of elements in panes array/,
      )
    })

    it("should accept any positive ratio values (auto-normalization)", () => {
      const yaml = `
presets:
  valid:
    name: valid
    layout:
      type: horizontal
      ratio: [1, 2]
      panes:
        - name: first
          command: vim
        - name: second
          command: htop
`
      const result = validateYAML(yaml)
      expect(result).toBeDefined()
      expect(result.presets.valid).toBeDefined()
      expect(result.presets.valid!.layout!.ratio).toEqual([1, 2]) // Preserves original values
    })

    it("should throw ValidationError for invalid direction", () => {
      const yaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: diagonal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
`
      captureValidationError(() => validateYAML(yaml))
    })

    it("should throw ValidationError for additional unknown fields", () => {
      const yaml = `
presets:
  invalid:
    name: invalid
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - name: editor
          command: vim
          unknownField: value
`
      captureValidationError(() => validateYAML(yaml))
    })

    it("should throw ValidationError for empty presets", () => {
      const yaml = `
presets: {}
`
      const error = captureValidationError(() => validateYAML(yaml))
      expect(error.message).toMatch(/At least one preset is required/)
    })

    it("should throw ValidationError for invalid preset structure", () => {
      const yaml = `
presets:
  empty: []
`
      captureValidationError(() => validateYAML(yaml))
    })
  })

  describe("edge cases", () => {
    it("should handle empty string", () => {
      captureValidationError(() => validateYAML(""))
    })

    it("should handle null input", () => {
      captureValidationError(() => validateYAML(null as unknown as string))
    })

    it("should handle deeply nested layouts", () => {
      const yaml = `
presets:
  deep:
    name: deep
    layout:
      type: horizontal
      ratio: [50, 50]
      panes:
        - type: vertical
          ratio: [50, 50]
          panes:
            - type: horizontal
              ratio: [50, 50]
              panes:
                - name: editor
                  command: vim
                - name: monitor
                  command: htop
            - name: logs
              command: logs
        - name: shell
          command: shell
`
      const result = validateYAML(yaml)
      expect(result.presets.deep).toBeDefined()
    })

    it("should validate ratio with decimal values summing to 100", () => {
      const yaml = `
presets:
  decimal:
    name: decimal
    layout:
      type: horizontal
      ratio: [33.33, 33.34, 33.33]
      panes:
        - name: editor
          command: vim
        - name: monitor
          command: htop
        - name: logs
          command: logs
`
      const result = validateYAML(yaml)
      expect(result.presets.decimal).toBeDefined()
      const decimalLayout = result.presets.decimal!.layout!
      expect(decimalLayout.ratio).toEqual([33.33, 33.34, 33.33])
    })
  })

  describe("error details", () => {
    it("should provide detailed validation errors", () => {
      const yaml = `
presets:
  test:
    name: test
    layout:
      type: horizontal
      ratio: [60, 40]
      panes:
        - name: invalid-command
          command: 123
        - name: invalid-cwd
          cwd: []
`
      const validationError = captureValidationError(() => validateYAML(yaml))
      expect(validationError.message).toBeTruthy()
      expect(validationError.details).toBeDefined()
    })
  })
})
