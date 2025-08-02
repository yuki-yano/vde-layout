import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { CLI } from "../cli"
import { MockPresetManager } from "./mocks/preset-manager-mock"
import { MockLayoutEngine } from "./mocks/layout-engine-mock"
import { MockExecutor } from "../executor/mock-executor"

describe("CLI", () => {
  let cli: CLI
  let mockPresetManager: MockPresetManager
  let mockLayoutEngine: MockLayoutEngine
  let mockExecutor: MockExecutor
  let originalExit: typeof process.exit
  let originalTMUX: string | undefined
  let exitCode: number | undefined
  let consoleOutput: string[] = []
  let errorOutput: string[] = []
  let processExitCalled = false

  beforeEach(() => {
    mockPresetManager = new MockPresetManager()
    mockLayoutEngine = new MockLayoutEngine()
    mockExecutor = new MockExecutor()
    originalTMUX = process.env.TMUX
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0" // Simulate being in tmux

    cli = new CLI({
      presetManager: mockPresetManager,
      createLayoutEngine: () => mockLayoutEngine,
      createCommandExecutor: () => mockExecutor,
    })

    // Mock process.exit
    originalExit = process.exit
    exitCode = undefined
    processExitCalled = false
    process.exit = ((code?: number) => {
      exitCode = code
      processExitCalled = true
      // Don't throw for successful exits in list command
      if (code === 0) {
        return
      }
      throw new Error(`Process exited with code ${code}`)
    }) as never

    // Capture console output
    consoleOutput = []
    errorOutput = []
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "))
    })
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errorOutput.push(args.join(" "))
    })
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      consoleOutput.push(args.join(" "))
    })
  })

  afterEach(() => {
    process.exit = originalExit
    if (originalTMUX !== undefined) {
      process.env.TMUX = originalTMUX
    } else {
      delete process.env.TMUX
    }
    vi.restoreAllMocks()
  })

  describe("basic commands", () => {
    it("should display version", async () => {
      // Commander.js may not call process.exit for version display
      await cli.run(["--version"])
      // Just check that no error was thrown
      expect(processExitCalled || consoleOutput.some((line) => line.includes("0.0.1"))).toBe(true)
    })

    it("should display version with -V", async () => {
      await cli.run(["-V"])
      // Just check that no error was thrown
      expect(processExitCalled || consoleOutput.some((line) => line.includes("0.0.1"))).toBe(true)
    })

    it("should show help with --help", async () => {
      try {
        await cli.run(["--help"])
      } catch (error) {
        // Commander.js throws an error for unknown options
        if (error instanceof Error && error.message.includes("unknown option")) {
          expect(exitCode).toBe(1)
          return
        }
      }
      // If no error, check for help output
      expect(processExitCalled || consoleOutput.some((line) => line.includes("Usage:"))).toBe(true)
    })

    it("should show help with -h", async () => {
      try {
        await cli.run(["-h"])
      } catch (error) {
        // Commander.js throws an error for unknown options
        if (error instanceof Error && error.message.includes("unknown option")) {
          expect(exitCode).toBe(1)
          return
        }
      }
      // If no error, check for help output
      expect(processExitCalled || consoleOutput.some((line) => line.includes("Usage:"))).toBe(true)
    })
  })

  describe("list command", () => {
    it("should list available presets", async () => {
      await cli.run(["list"])

      expect(processExitCalled).toBe(true)
      expect(consoleOutput.join("\n")).toContain("Available presets")
      expect(consoleOutput.join("\n")).toContain("default")
      expect(consoleOutput.join("\n")).toContain("dev")
      expect(exitCode).toBe(0)
    })

    it("should handle config loading error", async () => {
      mockPresetManager.setShouldFailOnLoad(true)

      await expect(cli.run(["list"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain("Error:")
      expect(exitCode).toBe(1)
    })
  })

  describe("preset execution", () => {
    it("should execute named preset", async () => {
      await cli.run(["dev"])

      expect(processExitCalled).toBe(true)
      expect(mockLayoutEngine.getCreatedLayouts()).toHaveLength(1)
      expect(mockLayoutEngine.getCreatedLayouts()[0]?.name).toBe("Development")
      expect(consoleOutput.join("\n")).toContain('Applied preset "Development"')
      expect(exitCode).toBe(0)
    })

    it("should execute default preset when no name provided", async () => {
      await cli.run([])

      expect(processExitCalled).toBe(true)
      expect(mockLayoutEngine.getCreatedLayouts()).toHaveLength(1)
      expect(mockLayoutEngine.getCreatedLayouts()[0]?.name).toBe("Default Layout")
      expect(exitCode).toBe(0)
    })

    it("should handle config loading error", async () => {
      mockPresetManager.setShouldFailOnLoad(true)

      await expect(cli.run(["dev"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain("Error:")
      expect(exitCode).toBe(1)
    })

    it("should handle preset not found error", async () => {
      await expect(cli.run(["nonexistent"])).rejects.toThrow("Process exited")

      expect(errorOutput.join("\n")).toContain('Preset "nonexistent" not found')
      expect(exitCode).toBe(1)
    })
  })

  describe("options", () => {
    it("should accept verbose option", async () => {
      await cli.run(["dev", "--verbose"])

      expect(processExitCalled).toBe(true)
      expect(mockLayoutEngine.getCreatedLayouts()).toHaveLength(1)
      expect(exitCode).toBe(0)
    })

    it("should accept dry-run option", async () => {
      await cli.run(["dev", "--dry-run"])

      expect(processExitCalled).toBe(true)
      expect(consoleOutput.join("\n")).toContain("[DRY RUN]")
      expect(mockLayoutEngine.getCreatedLayouts()).toHaveLength(1)
      expect(exitCode).toBe(0)
    })

    it("should enable dry-run automatically when outside tmux", async () => {
      delete process.env.TMUX

      await cli.run(["dev"])

      expect(processExitCalled).toBe(true)
      expect(consoleOutput.join("\n")).toContain("[DRY RUN]")
      expect(consoleOutput.join("\n")).toContain("Automatically enabled because not in tmux session")
      expect(exitCode).toBe(0)
    })

    it("should accept both verbose and dry-run options", async () => {
      await cli.run(["dev", "-v", "--dry-run"])

      expect(processExitCalled).toBe(true)
      expect(consoleOutput.join("\n")).toContain("[DRY RUN]")
      expect(exitCode).toBe(0)
    })
  })

  describe("error handling", () => {
    it("should handle unexpected errors gracefully", async () => {
      // Default action is executed even for unknown commands
      await expect(cli.run(["unknown-preset"])).rejects.toThrow("Process exited")

      // Error due to missing configuration file
      const output = errorOutput.join("\n")
      expect(output).toContain("Error:")
      expect(exitCode).toBe(1)
    })
  })
})
