import { describe, expect, it, vi } from "vitest"

import type { CoreError } from "../core/index"
import { LogLevel, type Logger } from "../utils/logger"
import { createCliErrorHandlers } from "./error-handling"

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

describe("createCliErrorHandlers", () => {
  it("formats and logs core errors with source, command and stderr details", () => {
    const logger = createMockLogger()
    const handlers = createCliErrorHandlers({
      getLogger: () => logger,
    })
    const error: CoreError = {
      kind: "execution",
      code: "TERMINAL_COMMAND_FAILED",
      message: "command failed",
      source: "preset://dev",
      path: "root.0",
      details: {
        command: ["tmux", "split-window", "-h"],
        stderr: "boom",
      },
    }

    const exitCode = handlers.handleCoreError(error)

    expect(exitCode).toBe(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      "[execution] [TERMINAL_COMMAND_FAILED] [root.0] command failed\nsource: preset://dev\ncommand: tmux split-window -h\nstderr: boom",
    )
  })

  it("logs regular Error instances with stack context", () => {
    const logger = createMockLogger()
    const handlers = createCliErrorHandlers({
      getLogger: () => logger,
    })
    const error = new Error("oops")

    const exitCode = handlers.handleError(error)

    expect(exitCode).toBe(1)
    expect(logger.error).toHaveBeenCalledWith("oops", error)
  })

  it("delegates core errors in pipeline failures to core handler", () => {
    const logger = createMockLogger()
    const handlers = createCliErrorHandlers({
      getLogger: () => logger,
    })
    const error: CoreError = {
      kind: "emit",
      code: "INVALID_PLAN",
      message: "invalid emission",
      path: "plan.root",
    }

    const exitCode = handlers.handlePipelineFailure(error)

    expect(exitCode).toBe(1)
    expect(logger.error).toHaveBeenCalledWith("[emit] [INVALID_PLAN] [plan.root] invalid emission")
  })
})
