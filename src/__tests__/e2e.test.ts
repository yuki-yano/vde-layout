import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { execSync } from "child_process"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("E2E Tests", () => {
  const testBaseDir = join(tmpdir(), "vde-layout-test-" + Date.now())
  const testConfigDir = join(testBaseDir, ".config", "vde")
  const testConfigPath = join(testConfigDir, "layout.yml")
  const binPath = join(process.cwd(), "bin", "vde-layout")

  beforeEach(() => {
    // Create test configuration directory
    mkdirSync(testConfigDir, { recursive: true })
  })

  afterEach(() => {
    // Delete test configuration directory
    rmSync(testBaseDir, { recursive: true, force: true })
  })

  function runCommand(
    args: string,
    env: Record<string, string> = {},
  ): {
    stdout: string
    stderr: string
    code: number
  } {
    try {
      const stdout = execSync(`${binPath} ${args}`, {
        env: {
          ...process.env,
          ...env,
          XDG_CONFIG_HOME: join(testBaseDir, ".config"),
          // Disable other configuration paths
          VDE_CONFIG_PATH: undefined,
          HOME: join(testBaseDir, "home"),
          // Enable test mode to prevent side effects
          VDE_TEST_MODE: "true",
        },
        encoding: "utf8",
      })
      return { stdout, stderr: "", code: 0 }
    } catch (error) {
      const e = error as { stdout: string; stderr: string; status: number }
      return { stdout: e.stdout || "", stderr: e.stderr || "", code: e.status || 1 }
    }
  }

  describe("Basic commands", () => {
    it("displays version", () => {
      const result = runCommand("--version")
      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it("displays help", () => {
      const result = runCommand("--help")
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("VDE (Vibrant Development Environment) Layout Manager")
      expect(result.stdout).toContain("Usage:")
      expect(result.stdout).toContain("Options:")
      expect(result.stdout).toContain("Commands:")
    })
  })

  describe("Without configuration file", () => {
    it("displays error when configuration file is missing", () => {
      const result = runCommand("list")
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Error:")
      expect(result.stderr).toContain("Configuration file not found")
    })

    it("displays error when executing preset", () => {
      const result = runCommand("dev")
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Error:")
      expect(result.stderr).toContain("Configuration file not found")
    })
  })

  describe("With configuration file", () => {
    beforeEach(() => {
      // Copy sample configuration file
      const sampleConfig = readFileSync(join(process.cwd(), "examples", "basic-layout.yml"), "utf8")
      writeFileSync(testConfigPath, sampleConfig)
    })

    it("displays preset list", () => {
      const result = runCommand("list")
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("Available presets:")
      expect(result.stdout).toContain("dev")
      expect(result.stdout).toContain("monitor")
      expect(result.stdout).toContain("simple")
      expect(result.stdout).toContain("test")
      expect(result.stdout).toContain("default")
    })

    it("executes preset in dry-run mode", () => {
      const result = runCommand("dev --dry-run", {
        TMUX: "fake-tmux-session",
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("[DRY RUN] No actual commands will be executed")
      expect(result.stdout).toContain('✓ Applied preset "dev"')
    })

    it("executes preset in verbose mode", () => {
      const result = runCommand("dev --verbose --dry-run", {
        TMUX: "fake-tmux-session",
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("[tmux] [DRY RUN] Would execute:")
      expect(result.stdout).toContain("new-window")
      expect(result.stdout).toContain("split-window")
      expect(result.stdout).toContain("send-keys")
    })

    it("executes default preset", () => {
      const result = runCommand("--dry-run", {
        TMUX: "fake-tmux-session",
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('✓ Applied preset "Development Default Layout"')
    })

    it("throws error when specifying non-existent preset", () => {
      const result = runCommand("nonexistent --dry-run", {
        TMUX: "fake-tmux-session",
      })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Error:")
      expect(result.stderr).toContain('Preset "nonexistent" not found')
    })
  })

  describe("Execution outside tmux environment", () => {
    it("throws error when executing outside tmux environment", () => {
      // Copy sample configuration file
      const sampleConfig = readFileSync(join(process.cwd(), "examples", "basic-layout.yml"), "utf8")
      writeFileSync(testConfigPath, sampleConfig)

      const result = runCommand("dev --dry-run", {
        TMUX: "", // Simulate outside tmux environment
      })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Error:")
      expect(result.stderr).toContain("Must be run inside a tmux session")
    })
  })

  describe("Invalid configuration file", () => {
    it("throws error for invalid YAML file", () => {
      writeFileSync(testConfigPath, "invalid: yaml: content:")

      const result = runCommand("list")
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Error:")
      expect(result.stderr).toContain("Failed to parse YAML")
    })

    it("throws error for configuration file that violates schema", () => {
      writeFileSync(
        testConfigPath,
        `
presets:
  invalid:
    name: invalid
    layout:
      type: invalid-type
      ratio: [50, 50]
      panes:
        - command: vim
`,
      )

      const result = runCommand("list")
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("Error:")
    })
  })

  describe("Option combinations", () => {
    beforeEach(() => {
      // Copy sample configuration file
      const sampleConfig = readFileSync(join(process.cwd(), "examples", "basic-layout.yml"), "utf8")
      writeFileSync(testConfigPath, sampleConfig)
    })

    it("can use verbose and dry-run together", () => {
      const result = runCommand("-v --dry-run dev", {
        TMUX: "fake-tmux-session",
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("[DRY RUN]")
      expect(result.stdout).toContain("[tmux] [DRY RUN] Would execute:")
    })

    it("short options work correctly", () => {
      const result = runCommand("-V")
      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)

      const helpResult = runCommand("-h")
      expect(helpResult.code).toBe(0)
      expect(helpResult.stdout).toContain("Usage:")
    })
  })
})
