import { describe, expect, it, vi } from "vitest"

import type { TerminalBackend } from "../terminal-backend.ts"
import { createTerminalBackend } from "../backend-factory.ts"
import { resolveTerminalBackendKind } from "../backend-resolver.ts"
import { LogLevel } from "../../utils/logger.ts"
import type { Logger } from "../../utils/logger.ts"

vi.mock("../backends/tmux-backend.ts", () => {
  return {
    createTmuxBackend: vi.fn((): TerminalBackend => {
      return {
        verifyEnvironment: vi.fn(),
        applyPlan: vi.fn(),
        getDryRunSteps: vi.fn(),
      }
    }),
  }
})

vi.mock("../backends/wezterm-backend.ts", () => {
  return {
    createWeztermBackend: vi.fn((): TerminalBackend => {
      return {
        verifyEnvironment: vi.fn(),
        applyPlan: vi.fn(),
        getDryRunSteps: vi.fn(),
      }
    }),
  }
})

describe("resolveTerminalBackendKind", () => {
  it("prefers CLI flag when provided", () => {
    const backend = resolveTerminalBackendKind({ cliFlag: "tmux", env: {} })
    expect(backend).toBe("tmux")
  })

  it("uses preset backend when CLI flag is not provided", () => {
    const backend = resolveTerminalBackendKind({ presetBackend: "wezterm", env: {} })
    expect(backend).toBe("wezterm")
  })

  it("keeps CLI flag precedence over preset backend", () => {
    const backend = resolveTerminalBackendKind({
      cliFlag: "tmux",
      presetBackend: "wezterm",
      env: {},
    })
    expect(backend).toBe("tmux")
  })

  it("throws when CLI flag is invalid", () => {
    expect(() => resolveTerminalBackendKind({ cliFlag: "invalid" as never, env: {} })).toThrow(
      'Unknown backend "invalid"',
    )
  })

  it("throws when preset backend is invalid", () => {
    expect(() => resolveTerminalBackendKind({ presetBackend: "screen" as never, env: {} })).toThrow(
      'Unknown backend "screen"',
    )
  })

  it("returns tmux when TMUX env is present", () => {
    const backend = resolveTerminalBackendKind({ env: { TMUX: "%1" } })
    expect(backend).toBe("tmux")
  })

  it("defaults to tmux when no hints are provided", () => {
    const backend = resolveTerminalBackendKind({ env: {} })
    expect(backend).toBe("tmux")
  })
})

describe("createTerminalBackend", () => {
  it("creates a tmux backend when requested", () => {
    const context = {
      executor: {
        execute: vi.fn(),
        executeMany: vi.fn(),
        isDryRun: vi.fn(() => false),
        logCommand: vi.fn(),
      },
      logger: createMockLogger(),
      dryRun: false,
      verbose: false,
      cwd: "/workspace",
      paneId: undefined,
    }

    const backend = createTerminalBackend("tmux", context)
    expect(backend).toBeDefined()
    expect(typeof backend.verifyEnvironment).toBe("function")
    expect(typeof backend.applyPlan).toBe("function")
    expect(typeof backend.getDryRunSteps).toBe("function")
  })

  it("creates a wezterm backend when requested", () => {
    const context = {
      executor: {
        execute: vi.fn(),
        executeMany: vi.fn(),
        isDryRun: vi.fn(() => false),
        logCommand: vi.fn(),
      },
      logger: createMockLogger(),
      dryRun: false,
      verbose: false,
      cwd: "/workspace",
      paneId: undefined,
    }

    const backend = createTerminalBackend("wezterm", context)
    expect(backend).toBeDefined()
    expect(typeof backend.verifyEnvironment).toBe("function")
  })
})
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
