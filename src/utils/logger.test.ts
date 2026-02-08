import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLogger, LogLevel } from "./logger"

describe("createLogger", () => {
  const originalDebug = process.env.VDE_DEBUG
  const originalVerbose = process.env.VDE_VERBOSE

  beforeEach(() => {
    delete process.env.VDE_DEBUG
    delete process.env.VDE_VERBOSE
  })

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.VDE_DEBUG
    } else {
      process.env.VDE_DEBUG = originalDebug
    }

    if (originalVerbose === undefined) {
      delete process.env.VDE_VERBOSE
    } else {
      process.env.VDE_VERBOSE = originalVerbose
    }

    vi.restoreAllMocks()
  })

  it("defaults to WARN level when verbose flags are absent", () => {
    const logger = createLogger()
    expect(logger.level).toBe(LogLevel.WARN)
  })

  it("resolves INFO level from VDE_VERBOSE and DEBUG level from VDE_DEBUG", () => {
    process.env.VDE_VERBOSE = "true"
    expect(createLogger().level).toBe(LogLevel.INFO)

    process.env.VDE_DEBUG = "true"
    expect(createLogger().level).toBe(LogLevel.DEBUG)
  })

  it("logs warn only when level allows it", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    createLogger({ level: LogLevel.ERROR }).warn("hidden")
    createLogger({ level: LogLevel.WARN }).warn("visible")

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("visible"))
  })

  it("logs debug messages only at DEBUG level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    createLogger({ level: LogLevel.INFO }).debug("skip")
    createLogger({ level: LogLevel.DEBUG, prefix: "[app]" }).debug("run")

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] run"))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[app]"))
  })

  it("prints stack traces for errors when VDE_DEBUG is enabled", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new Error("boom")
    error.stack = "stack trace body"

    createLogger({ level: LogLevel.ERROR, prefix: "[cli]" }).error("failed", error)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error: failed"))

    process.env.VDE_DEBUG = "true"
    createLogger({ level: LogLevel.ERROR }).error("failed", error)
    expect(errorSpy).toHaveBeenCalledTimes(3)
    expect(errorSpy).toHaveBeenNthCalledWith(3, expect.stringContaining("stack trace body"))
  })

  it("inherits level and concatenates prefixes in child loggers", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const root = createLogger({ level: LogLevel.INFO, prefix: "[root]" })
    const child = root.createChild("[worker]")
    const childWithoutRoot = createLogger({ level: LogLevel.INFO }).createChild("[solo]")

    expect(child.level).toBe(LogLevel.INFO)
    expect(child.prefix).toBe("[root] [worker]")

    child.info("hello")
    childWithoutRoot.success("done")

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[root] [worker] hello"))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[solo] done"))
  })
})
