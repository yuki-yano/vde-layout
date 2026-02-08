import { describe, expect, it, vi } from "vitest"

import type { PresetManager } from "../types/preset-manager"
import { LogLevel, type Logger } from "../utils/logger"
import { applyRuntimeOptions, listPresets } from "./runtime-and-list"

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

const createMockPresetManager = (): PresetManager => {
  return {
    loadConfig: vi.fn(async () => {}),
    listPresets: vi.fn(() => []),
    getPreset: vi.fn(),
    getDefaultPreset: vi.fn(),
    getDefaults: vi.fn(() => ({})),
    setConfigPath: vi.fn(),
  }
}

describe("runtime-and-list helpers", () => {
  describe("applyRuntimeOptions", () => {
    it("creates info-level logger when verbose=true and applies config path", () => {
      const presetManager = createMockPresetManager()
      const infoLogger = createMockLogger()
      const defaultLogger = createMockLogger()
      const createLoggerMock = vi.fn((options?: { level?: LogLevel }): Logger => {
        if (options?.level === LogLevel.INFO) {
          return infoLogger
        }
        return defaultLogger
      })

      const logger = applyRuntimeOptions({
        runtimeOptions: {
          verbose: true,
          config: "/tmp/custom.yml",
        },
        createLogger: createLoggerMock,
        presetManager,
      })

      expect(logger).toBe(infoLogger)
      expect(createLoggerMock).toHaveBeenCalledWith({ level: LogLevel.INFO })
      expect(presetManager.setConfigPath).toHaveBeenCalledWith("/tmp/custom.yml")
    })

    it("creates default logger when verbose is false", () => {
      const presetManager = createMockPresetManager()
      const defaultLogger = createMockLogger()
      const createLoggerMock = vi.fn(() => defaultLogger)

      const logger = applyRuntimeOptions({
        runtimeOptions: {
          verbose: false,
        },
        createLogger: createLoggerMock,
        presetManager,
      })

      expect(logger).toBe(defaultLogger)
      expect(createLoggerMock).toHaveBeenCalledWith()
      expect(presetManager.setConfigPath).not.toHaveBeenCalled()
    })
  })

  describe("listPresets", () => {
    it("warns when no presets are defined", async () => {
      const presetManager = createMockPresetManager()
      const logger = createMockLogger()
      const output = vi.fn()
      const onError = vi.fn(() => 1)

      const exitCode = await listPresets({
        presetManager,
        logger,
        output,
        onError,
      })

      expect(exitCode).toBe(0)
      expect(logger.warn).toHaveBeenCalledWith("No presets defined")
      expect(output).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })

    it("renders preset list in aligned format", async () => {
      const presetManager = createMockPresetManager()
      const logger = createMockLogger()
      const output = vi.fn()
      const onError = vi.fn(() => 1)

      vi.mocked(presetManager.listPresets).mockReturnValueOnce([
        { key: "dev", description: "Development", name: "Development" },
        { key: "ops", description: "Operations", name: "Operations" },
      ])

      const exitCode = await listPresets({
        presetManager,
        logger,
        output,
        onError,
      })

      expect(exitCode).toBe(0)
      expect(output).toHaveBeenCalledWith(expect.stringContaining("Available presets:"))
      expect(output).toHaveBeenCalledWith(expect.stringContaining("dev"))
      expect(output).toHaveBeenCalledWith(expect.stringContaining("ops"))
      expect(onError).not.toHaveBeenCalled()
    })

    it("delegates errors to onError handler", async () => {
      const logger = createMockLogger()
      const output = vi.fn()
      const onError = vi.fn(() => 1)
      const presetManager: PresetManager = {
        ...createMockPresetManager(),
        loadConfig: vi.fn(async () => {
          throw new Error("boom")
        }),
      }

      const exitCode = await listPresets({
        presetManager,
        logger,
        output,
        onError,
      })

      expect(exitCode).toBe(1)
      expect(onError).toHaveBeenCalledTimes(1)
    })
  })
})
