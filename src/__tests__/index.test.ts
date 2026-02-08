import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const loadEntrypoint = async (): Promise<void> => {
  await import("../index")
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe("index entrypoint", () => {
  let originalArgv: string[]
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalArgv = process.argv
    originalEnv = process.env
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.argv = originalArgv
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("runs CLI with sliced argv", async () => {
    const run = vi.fn(async () => undefined)
    vi.doMock("../cli", () => ({
      createCli: vi.fn(() => ({ run })),
    }))
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)
    process.argv = ["node", "vde-layout", "--help"]

    await loadEntrypoint()

    expect(run).toHaveBeenCalledWith(["--help"])
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it("prints error and exits when CLI run fails", async () => {
    const run = vi.fn(async () => {
      throw new Error("Test error message")
    })
    vi.doMock("../cli", () => ({
      createCli: vi.fn(() => ({ run })),
    }))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)

    await loadEntrypoint()

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "Test error message")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it("prints stack trace in debug mode", async () => {
    const error = new Error("Debug error")
    error.stack = "Error: Debug error\n    at test.js:1:1"
    const run = vi.fn(async () => {
      throw error
    })
    vi.doMock("../cli", () => ({
      createCli: vi.fn(() => ({ run })),
    }))
    process.env = { ...process.env, VDE_DEBUG: "true" }
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)

    await loadEntrypoint()

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", "Debug error")
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Debug error\n    at test.js:1:1")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it("handles non-Error throw values", async () => {
    const run = vi.fn(async () => {
      throw "String error"
    })
    vi.doMock("../cli", () => ({
      createCli: vi.fn(() => ({ run })),
    }))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never)

    await loadEntrypoint()

    expect(consoleErrorSpy).toHaveBeenCalledWith("An unexpected error occurred:", "String error")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
