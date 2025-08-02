import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { CLI } from "../cli"

// Separate main function to make it testable
export async function main(): Promise<void> {
  const cli = new CLI()
  try {
    await cli.run(process.argv.slice(2))
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message)

      if (process.env.VDE_DEBUG === "true") {
        console.error(error.stack)
      }
    } else {
      console.error("Unexpected error occurred:", String(error))
    }

    process.exit(1)
  }
}

describe("index.ts", () => {
  let originalArgv: string[]
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalArgv = process.argv
    originalEnv = process.env
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.argv = originalArgv
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("should create CLI instance and run it with sliced argv", async () => {
    const mockRun = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(CLI.prototype, "run").mockImplementation(mockRun)

    process.argv = ["node", "vde-layout", "--help"]
    await main()

    expect(mockRun).toHaveBeenCalledWith(["--help"])
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it("should handle errors from CLI.run", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Process exited")
    })

    const testError = new Error("Test error message")
    vi.spyOn(CLI.prototype, "run").mockRejectedValue(testError)

    await expect(main()).rejects.toThrow("Process exited")

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "Test error message")
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  it("should handle errors with stack trace in debug mode", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Process exited")
    })

    process.env.VDE_DEBUG = "true"
    const testError = new Error("Debug error")
    testError.stack = "Error: Debug error\n    at test.js:1:1"
    vi.spyOn(CLI.prototype, "run").mockRejectedValue(testError)

    await expect(main()).rejects.toThrow("Process exited")

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "Debug error")
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Debug error\n    at test.js:1:1")
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  it("should handle non-Error objects", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Process exited")
    })

    vi.spyOn(CLI.prototype, "run").mockRejectedValue("String error")

    await expect(main()).rejects.toThrow("Process exited")

    expect(consoleErrorSpy).toHaveBeenCalledWith("Unexpected error occurred:", "String error")
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})
