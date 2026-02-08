import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createInterfaceMock = vi.hoisted(() => vi.fn())

vi.mock("node:readline/promises", () => ({
  createInterface: createInterfaceMock,
}))

import { createPaneKillPrompter } from "./user-prompt"
import type { Logger } from "../utils/logger"
import { LogLevel } from "../utils/logger"

const createMockLogger = (): Logger => {
  const logger: Logger = {
    level: LogLevel.INFO,
    prefix: "",
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    createChild: vi.fn((): Logger => logger),
  }
  return logger
}

const setTTY = (stdinTTY: boolean, stdoutTTY: boolean): void => {
  Object.defineProperty(process.stdin, "isTTY", { value: stdinTTY, configurable: true })
  Object.defineProperty(process.stdout, "isTTY", { value: stdoutTTY, configurable: true })
}

describe("createPaneKillPrompter", () => {
  const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
  const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")

  beforeEach(() => {
    createInterfaceMock.mockReset()
  })

  afterEach(() => {
    if (stdinTTYDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinTTYDescriptor)
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY")
    }
    if (stdoutTTYDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTTYDescriptor)
    } else {
      Reflect.deleteProperty(process.stdout, "isTTY")
    }
  })

  it("returns true when there are no panes to close", async () => {
    const logger = createMockLogger()
    const prompt = createPaneKillPrompter(logger)

    const result = await prompt({ panesToClose: [], dryRun: false })

    expect(result).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("logs warning and returns true in dry-run mode", async () => {
    const logger = createMockLogger()
    const prompt = createPaneKillPrompter(logger)

    const result = await prompt({ panesToClose: ["%1", "%2"], dryRun: true })

    expect(result).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith("[DRY RUN] Would close panes: %1, %2")
    expect(createInterfaceMock).not.toHaveBeenCalled()
  })

  it("returns false when terminal is not interactive", async () => {
    const logger = createMockLogger()
    const prompt = createPaneKillPrompter(logger)
    setTTY(false, true)

    const result = await prompt({ panesToClose: ["%1"], dryRun: false })

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith("Cannot prompt for confirmation because the terminal is not interactive")
    expect(createInterfaceMock).not.toHaveBeenCalled()
  })

  it("accepts yes answers and closes readline interface", async () => {
    const logger = createMockLogger()
    const prompt = createPaneKillPrompter(logger)
    setTTY(true, true)
    const question = vi.fn(async () => "yes")
    const close = vi.fn(() => undefined)
    createInterfaceMock.mockReturnValue({ question, close })

    const result = await prompt({ panesToClose: ["%1"], dryRun: false })

    expect(result).toBe(true)
    expect(createInterfaceMock).toHaveBeenCalledWith({ input: process.stdin, output: process.stdout })
    expect(question).toHaveBeenCalledWith("Continue? [y/N]: ")
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("rejects non-yes answers", async () => {
    const logger = createMockLogger()
    const prompt = createPaneKillPrompter(logger)
    setTTY(true, true)
    createInterfaceMock.mockReturnValue({
      question: vi.fn(async () => "no"),
      close: vi.fn(() => undefined),
    })

    const result = await prompt({ panesToClose: ["%1"], dryRun: false })

    expect(result).toBe(false)
  })
})
