import { Command } from "commander"
import chalk from "chalk"
import { createRequire } from "module"
import { createPresetManager } from "../layout/preset.ts"
import { loadPackageVersion } from "./package-version.ts"
import { resolveWindowMode } from "./window-mode.ts"
import { createPaneKillPrompter } from "./user-prompt.ts"
import type { PresetInfo, WindowMode } from "../models/types"
import type { CommandExecutor } from "../types/command-executor.ts"
import type { PresetManager } from "../types/preset-manager.ts"
import { createRealExecutor, createDryRunExecutor } from "../executor/index.ts"
import { createTerminalBackend } from "../executor/backend-factory.ts"
import { resolveTerminalBackendKind } from "../executor/backend-resolver.ts"
import type { DryRunStep, TerminalBackendKind } from "../executor/terminal-backend.ts"
import { createLogger, LogLevel, type Logger } from "../utils/logger.ts"
import {
  compilePreset as defaultCompilePreset,
  compilePresetFromValue as defaultCompilePresetFromValue,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "../core/index.ts"
import type {
  CompilePresetFromValueInput,
  CompilePresetInput,
  PlanEmission,
  CoreError,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
} from "../core/index.ts"
import { isCoreError } from "../core/index.ts"

export type CoreBridge = {
  readonly compilePreset: (input: CompilePresetInput) => ReturnType<typeof defaultCompilePreset>
  readonly compilePresetFromValue: (
    input: CompilePresetFromValueInput,
  ) => ReturnType<typeof defaultCompilePresetFromValue>
  readonly createLayoutPlan: (
    input: Parameters<typeof defaultCreateLayoutPlan>[0],
  ) => ReturnType<typeof defaultCreateLayoutPlan>
  readonly emitPlan: (input: Parameters<typeof defaultEmitPlan>[0]) => ReturnType<typeof defaultEmitPlan>
}

export type CLIOptions = {
  readonly presetManager?: PresetManager
  readonly createCommandExecutor?: (options: { verbose: boolean; dryRun: boolean }) => CommandExecutor
  readonly core?: CoreBridge
}

export type CLI = {
  run(args?: string[]): Promise<void>
}

export const createCli = (options: CLIOptions = {}): CLI => {
  const presetManager = options.presetManager ?? createPresetManager()
  const createCommandExecutor =
    options.createCommandExecutor ??
    ((opts: { verbose: boolean; dryRun: boolean }): CommandExecutor => {
      if (opts.dryRun) {
        return createDryRunExecutor({ verbose: opts.verbose })
      }
      return createRealExecutor({ verbose: opts.verbose })
    })

  const core: CoreBridge =
    options.core ??
    ({
      compilePreset: defaultCompilePreset,
      compilePresetFromValue: defaultCompilePresetFromValue,
      createLayoutPlan: defaultCreateLayoutPlan,
      emitPlan: defaultEmitPlan,
    } as const)

  const program = new Command()
  const require = createRequire(import.meta.url)
  const version = loadPackageVersion(require)
  let logger: Logger = createLogger()

  const renderDryRun = (steps: ReadonlyArray<DryRunStep>): void => {
    console.log(chalk.bold("\nPlanned terminal steps (dry-run)"))
    steps.forEach((step, index) => {
      console.log(` ${index + 1}. [${step.backend}] ${step.summary}: ${step.command}`)
    })
  }

  const buildPresetSource = (presetName?: string): string => {
    return typeof presetName === "string" && presetName.length > 0 ? `preset://${presetName}` : "preset://default"
  }

  const determineCliWindowMode = (options: {
    currentWindow?: boolean
    newWindow?: boolean
  }): WindowMode | undefined => {
    if (options.currentWindow === true && options.newWindow === true) {
      throw new Error("Cannot use --current-window and --new-window at the same time")
    }

    if (options.currentWindow === true) {
      return "current-window"
    }

    if (options.newWindow === true) {
      return "new-window"
    }

    return undefined
  }

  const handleCoreError = (error: CoreError): never => {
    const header = [`[${error.kind}]`, `[${error.code}]`]
    if (typeof error.path === "string" && error.path.length > 0) {
      header.push(`[${error.path}]`)
    }

    const lines = [`${header.join(" ")} ${error.message}`.trim()]

    if (typeof error.source === "string" && error.source.length > 0) {
      lines.push(`source: ${error.source}`)
    }

    const commandDetail = error.details?.command
    if (Array.isArray(commandDetail)) {
      const parts = commandDetail.filter((segment): segment is string => typeof segment === "string")
      if (parts.length > 0) {
        lines.push(`command: ${parts.join(" ")}`)
      }
    } else if (typeof commandDetail === "string" && commandDetail.length > 0) {
      lines.push(`command: ${commandDetail}`)
    }

    const stderrDetail = error.details?.stderr
    if (typeof stderrDetail === "string" && stderrDetail.length > 0) {
      lines.push(`stderr: ${stderrDetail}`)
    } else if (stderrDetail !== undefined) {
      lines.push(`stderr: ${String(stderrDetail)}`)
    }

    logger.error(lines.join("\n"))
    process.exit(1)
  }

  const handleError = (error: unknown): never => {
    if (error instanceof Error) {
      logger.error(error.message, error)
    } else {
      logger.error("An unexpected error occurred")
    }

    process.exit(1)
  }

  const handlePipelineFailure = (error: unknown): never => {
    if (isCoreError(error)) {
      return handleCoreError(error)
    }
    return handleError(error)
  }

  const listPresets = async (): Promise<never> => {
    try {
      await presetManager.loadConfig()
      const presets = presetManager.listPresets()

      if (presets.length === 0) {
        logger.warn("No presets defined")
        process.exit(0)
      }

      console.log(chalk.bold("Available presets:\n"))

      const maxKeyLength = Math.max(...presets.map((p) => p.key.length))

      presets.forEach((preset: PresetInfo) => {
        const paddedKey = preset.key.padEnd(maxKeyLength + 2)
        const description = preset.description ?? ""
        console.log(`  ${chalk.cyan(paddedKey)} ${description}`)
      })

      process.exit(0)
    } catch (error) {
      return handleError(error)
    }
  }

  const executePreset = async (
    presetName: string | undefined,
    options: {
      verbose: boolean
      dryRun: boolean
      currentWindow: boolean
      newWindow: boolean
      backend?: string
    },
  ): Promise<never> => {
    try {
      await presetManager.loadConfig()

      const preset =
        typeof presetName === "string" && presetName.length > 0
          ? presetManager.getPreset(presetName)
          : presetManager.getDefaultPreset()

      const cliWindowMode = determineCliWindowMode({
        currentWindow: options.currentWindow,
        newWindow: options.newWindow,
      })
      const defaults = presetManager.getDefaults()
      const windowModeResolution = resolveWindowMode({
        cli: cliWindowMode,
        preset: preset.windowMode,
        defaults: defaults?.windowMode,
      })
      const windowMode = windowModeResolution.mode
      logger.info(`Window mode: ${windowMode} (source: ${windowModeResolution.source})`)
      const confirmPaneClosure = createPaneKillPrompter(logger)

      const executor = createCommandExecutor({
        verbose: options.verbose,
        dryRun: options.dryRun,
      })

      const backendKind = resolveTerminalBackendKind({
        cliFlag: options.backend as TerminalBackendKind | undefined,
        presetBackend: preset.backend,
        env: process.env,
      })
      logger.info(`Terminal backend: ${backendKind}`)

      const backend = createTerminalBackend(backendKind, {
        executor,
        logger,
        dryRun: options.dryRun,
        verbose: options.verbose,
        prompt: confirmPaneClosure,
        cwd: process.cwd(),
        paneId: process.env.WEZTERM_PANE,
      })

      await backend.verifyEnvironment()

      if (options.dryRun === true) {
        console.log("[DRY RUN] No actual commands will be executed")
      }

      let compileResult: CompilePresetSuccess
      let planResult: CreateLayoutPlanSuccess
      let emission: PlanEmission

      try {
        compileResult = core.compilePresetFromValue({
          value: preset,
          source: buildPresetSource(presetName),
        })
        planResult = core.createLayoutPlan({ preset: compileResult.preset })
        emission = core.emitPlan({ plan: planResult.plan })
      } catch (error) {
        return handlePipelineFailure(error)
      }

      if (options.dryRun === true) {
        const dryRunSteps = backend.getDryRunSteps(emission)
        renderDryRun(dryRunSteps)
      } else {
        try {
          const executionResult = await backend.applyPlan({
            emission,
            windowMode,
            windowName: preset.name ?? presetName ?? "vde-layout",
          })
          logger.info(`Executed ${executionResult.executedSteps} ${backendKind} steps`)
        } catch (error) {
          return handlePipelineFailure(error)
        }
      }

      logger.success(`Applied preset "${preset.name}"`)
      process.exit(0)
    } catch (error) {
      return handleError(error)
    }
  }

  const setupProgram = (): void => {
    program
      .name("vde-layout")
      .description("VDE (Vibrant Development Environment) Layout Manager - tmux pane layout management tool")
      .version(version, "-v, --version", "Show version")
      .helpOption("-h, --help", "Show help")

    program.option("--verbose", "Show detailed logs", false)
    program.option("--dry-run", "Display commands without executing", false)
    program.option("--backend <backend>", "Select terminal backend (tmux or wezterm)")
    program.option("--config <path>", "Path to configuration file")
    program.option("--current-window", "Use the current tmux window for layout (kills other panes)", false)
    program.option("--new-window", "Always create a new tmux window for layout", false)

    program
      .command("list")
      .description("List available presets")
      .action(async () => {
        await listPresets()
      })

    program
      .argument("[preset]", 'Preset name (defaults to "default" preset when omitted)')
      .action(async (presetName?: string) => {
        const opts = program.opts<{
          verbose?: boolean
          dryRun?: boolean
          currentWindow?: boolean
          newWindow?: boolean
          backend?: string
        }>()
        await executePreset(presetName, {
          verbose: opts.verbose === true,
          dryRun: opts.dryRun === true,
          currentWindow: opts.currentWindow === true,
          newWindow: opts.newWindow === true,
          backend: opts.backend,
        })
      })
  }

  setupProgram()

  const run = async (args: string[] = process.argv.slice(2)): Promise<void> => {
    const requestedVersion = args.some((arg) => arg === "--version" || arg === "-v")
    const requestedHelp = args.includes("--help") || args.includes("-h")
    try {
      await program.parseAsync(args, { from: "user" })
      const opts = program.opts<{
        verbose?: boolean
        config?: string
        V?: boolean
        currentWindow?: boolean
        newWindow?: boolean
      }>()

      if (requestedVersion || requestedHelp) {
        return
      }

      if (opts.verbose === true) {
        logger = createLogger({ level: LogLevel.INFO })
      } else {
        logger = createLogger()
      }

      if (
        typeof opts.config === "string" &&
        opts.config.length > 0 &&
        typeof presetManager.setConfigPath === "function"
      ) {
        presetManager.setConfigPath(opts.config)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Process exited")) {
        throw error
      }
      handleError(error)
    }
  }

  return { run }
}
