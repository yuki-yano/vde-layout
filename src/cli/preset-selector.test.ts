import { afterEach, describe, expect, it, vi } from "vitest"
import * as YAML from "yaml"
import { createLogger, LogLevel } from "../utils/logger"
import { createMockPresetManager } from "../testing/preset-manager-mock"
import { buildPresetPreviewYaml, selectPreset } from "./preset-selector"

describe("preset-selector", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const stripAnsiCodes = (value: string): string => {
    return value.replace(/\u001b\[[0-9;]*m/g, "")
  }

  it("builds preview YAML for the selected preset only", () => {
    const preview = buildPresetPreviewYaml({
      presetKey: "dev",
      preset: {
        name: "Development",
        description: "Run editor and app",
        command: "npm run dev",
      },
    })

    const parsed = YAML.parse(preview) as {
      presets?: Record<string, { name?: string; command?: string; description?: string }>
      defaults?: unknown
    }

    expect(parsed.defaults).toBeUndefined()
    expect(parsed.presets).toEqual({
      dev: {
        name: "Development",
        description: "Run editor and app",
        command: "npm run dev",
      },
    })
  })

  it("returns selected preset key from fzf", async () => {
    vi.stubEnv("FORCE_COLOR", "1")

    const presetManager = createMockPresetManager()
    presetManager.setPresets({
      default: {
        name: "Default Layout",
      },
      dev: {
        name: "Development",
        description: "Editor and app",
        command: "npm run dev",
      },
    })

    const runFzf = vi.fn(async ({ input }: { input: string }) => {
      const lines = input
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      const firstLineCells = (lines[0] ?? "").split("\t")
      const displayText = firstLineCells[1]
      const previewContentBase64 = firstLineCells[2]
      expect(displayText).toContain("\u001b[")
      expect(typeof previewContentBase64).toBe("string")
      expect(previewContentBase64).toBeTruthy()
      const previewContent = Buffer.from(previewContentBase64!, "base64").toString("utf8")
      const previewYaml = YAML.parse(previewContent) as { presets?: Record<string, { name?: string }> }
      expect(previewYaml.presets).toEqual({
        default: {
          name: "Default Layout",
        },
      })

      return {
        stdout: lines[1] ?? "",
      }
    })

    const result = await selectPreset({
      uiMode: "auto",
      surfaceMode: "auto",
      presetManager,
      logger: createLogger({ level: LogLevel.ERROR }),
      isInteractive: () => true,
      checkFzfAvailability: async () => true,
      runFzf,
      cwd: process.cwd(),
      env: { ...process.env, TMUX: undefined },
    })

    expect(result).toEqual({
      status: "selected",
      presetName: "dev",
    })
    expect(runFzf).toHaveBeenCalledTimes(1)
    expect(runFzf).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          "--delimiter=\\t",
          "--ansi",
          "--with-nth=2",
          '--preview=node -e \'process.stdout.write(Buffer.from(process.argv[1], "base64").toString("utf8"))\' {3}',
        ]),
      }),
    )
  })

  it("returns cancelled when fzf exits with 130", async () => {
    const presetManager = createMockPresetManager()
    const runFzf = vi.fn(async () => {
      const error = new Error("cancelled") as Error & { exitCode?: number }
      error.exitCode = 130
      throw error
    })

    const result = await selectPreset({
      uiMode: "fzf",
      surfaceMode: "auto",
      presetManager,
      logger: createLogger({ level: LogLevel.ERROR }),
      isInteractive: () => true,
      checkFzfAvailability: async () => true,
      runFzf,
      cwd: process.cwd(),
      env: { ...process.env, TMUX: undefined },
    })

    expect(result).toEqual({ status: "cancelled" })
  })

  it("throws when auto mode is requested and fzf is unavailable", async () => {
    const presetManager = createMockPresetManager()

    await expect(
      selectPreset({
        uiMode: "auto",
        surfaceMode: "auto",
        presetManager,
        logger: createLogger({ level: LogLevel.ERROR }),
        isInteractive: () => true,
        checkFzfAvailability: async () => false,
        runFzf: vi.fn(),
        cwd: process.cwd(),
        env: { ...process.env, TMUX: undefined },
      }),
    ).rejects.toThrow(/fzf is required/)
  })

  it("can skip config loading when config is already loaded by caller", async () => {
    const presetManager = createMockPresetManager()
    const loadConfigSpy = vi.spyOn(presetManager, "loadConfig")
    const runFzf = vi.fn(async ({ input }: { input: string }) => ({
      stdout: input.split("\n")[0] ?? "",
    }))

    const result = await selectPreset({
      uiMode: "fzf",
      surfaceMode: "auto",
      presetManager,
      logger: createLogger({ level: LogLevel.ERROR }),
      skipLoadConfig: true,
      isInteractive: () => true,
      checkFzfAvailability: async () => true,
      runFzf,
      cwd: process.cwd(),
      env: { ...process.env, TMUX: undefined },
    })

    expect(result).toEqual({
      status: "selected",
      presetName: "default",
    })
    expect(loadConfigSpy).not.toHaveBeenCalled()
  })

  it("uses tmux popup surface in auto mode when TMUX is present", async () => {
    const presetManager = createMockPresetManager()
    const runFzf = vi.fn(async ({ input }: { input: string }) => ({
      stdout: input.split("\n")[0] ?? "",
    }))

    const result = await selectPreset({
      uiMode: "fzf",
      surfaceMode: "auto",
      tmuxPopupOptions: "90%,80%",
      presetManager,
      logger: createLogger({ level: LogLevel.ERROR }),
      isInteractive: () => true,
      checkFzfAvailability: async () => true,
      runFzf,
      cwd: process.cwd(),
      env: { ...process.env, TMUX: "/tmp/tmux-1000/default,1234,0" },
    })

    expect(result).toEqual({
      status: "selected",
      presetName: "default",
    })
    expect(runFzf).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["--tmux=90%,80%"]),
      }),
    )
  })

  it("throws when tmux popup surface is selected outside tmux", async () => {
    const presetManager = createMockPresetManager()

    await expect(
      selectPreset({
        uiMode: "fzf",
        surfaceMode: "tmux-popup",
        presetManager,
        logger: createLogger({ level: LogLevel.ERROR }),
        isInteractive: () => true,
        checkFzfAvailability: async () => true,
        runFzf: vi.fn(),
        cwd: process.cwd(),
        env: { ...process.env, TMUX: undefined },
      }),
    ).rejects.toThrow(/requires running inside tmux/)
  })

  it("appends caller-provided fzf extra args", async () => {
    const presetManager = createMockPresetManager()
    const runFzf = vi.fn(async ({ input }: { input: string }) => ({
      stdout: input.split("\n")[0] ?? "",
    }))

    const result = await selectPreset({
      uiMode: "fzf",
      surfaceMode: "inline",
      fzfExtraArgs: ["--cycle", "--info=inline"],
      presetManager,
      logger: createLogger({ level: LogLevel.ERROR }),
      isInteractive: () => true,
      checkFzfAvailability: async () => true,
      runFzf,
      cwd: process.cwd(),
      env: { ...process.env, TMUX: undefined },
    })

    expect(result).toEqual({
      status: "selected",
      presetName: "default",
    })
    expect(runFzf).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["--cycle", "--info=inline"]),
      }),
    )
  })

  it("rejects extra args that override reserved fzf options", async () => {
    const presetManager = createMockPresetManager()

    await expect(
      selectPreset({
        uiMode: "fzf",
        surfaceMode: "inline",
        fzfExtraArgs: ["--preview=cat /tmp/preview.yml"],
        presetManager,
        logger: createLogger({ level: LogLevel.ERROR }),
        isInteractive: () => true,
        checkFzfAvailability: async () => true,
        runFzf: vi.fn(),
        cwd: process.cwd(),
        env: { ...process.env, TMUX: undefined },
      }),
    ).rejects.toThrow(/reserved fzf option/)
  })

  it("aligns key and name columns in colored display rows", async () => {
    const presetManager = createMockPresetManager()
    presetManager.setPresets({
      s: {
        name: "X",
        description: "first",
      },
      "very-long-preset-key": {
        name: "Long Name",
        description: "second",
      },
    })

    const runFzf = vi.fn(async ({ input }: { input: string }) => {
      const lines = input
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      const firstDisplay = stripAnsiCodes((lines[0] ?? "").split("\t")[1] ?? "")
      const secondDisplay = stripAnsiCodes((lines[1] ?? "").split("\t")[1] ?? "")

      expect(firstDisplay.indexOf("first")).toBeGreaterThanOrEqual(0)
      expect(secondDisplay.indexOf("second")).toBeGreaterThanOrEqual(0)
      expect(firstDisplay.indexOf("first")).toBe(secondDisplay.indexOf("second"))

      return {
        stdout: lines[0] ?? "",
      }
    })

    const result = await selectPreset({
      uiMode: "fzf",
      surfaceMode: "auto",
      presetManager,
      logger: createLogger({ level: LogLevel.ERROR }),
      isInteractive: () => true,
      checkFzfAvailability: async () => true,
      runFzf,
      cwd: process.cwd(),
      env: { ...process.env, TMUX: undefined },
    })

    expect(result).toEqual({
      status: "selected",
      presetName: "s",
    })
  })

  it("throws when preview payload exceeds inline limit", async () => {
    const presetManager = createMockPresetManager()
    presetManager.setPresets({
      huge: {
        name: "Huge",
        command: `echo ${"x".repeat(80_000)}`,
      },
    })

    await expect(
      selectPreset({
        uiMode: "fzf",
        surfaceMode: "auto",
        presetManager,
        logger: createLogger({ level: LogLevel.ERROR }),
        isInteractive: () => true,
        checkFzfAvailability: async () => true,
        runFzf: vi.fn(),
        cwd: process.cwd(),
        env: { ...process.env, TMUX: undefined },
      }),
    ).rejects.toThrow(/Preset preview is too large/)
  })
})
