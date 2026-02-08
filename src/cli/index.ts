import { Command, CommanderError } from "commander"
import chalk from "chalk"
import { createRequire } from "module"
import { createPresetManager } from "../layout/preset"
import { loadPackageVersion } from "./package-version"
import { resolveWindowMode } from "./window-mode"
import { createPaneKillPrompter } from "./user-prompt"
import { buildPresetSource, determineCliWindowMode, renderDryRun } from "./command-helpers"
import { createCliErrorHandlers } from "./error-handling"
import type { PresetInfo } from "../models/types"
import type { CommandExecutor } from "../types/command-executor"
import type { PresetManager } from "../types/preset-manager"
import { createRealExecutor, createDryRunExecutor } from "../executor/index"
import { createTerminalBackend } from "../executor/backend-factory"
import { resolveTerminalBackendKind } from "../executor/backend-resolver"
import type { TerminalBackendKind } from "../executor/terminal-backend"
import { createLogger, LogLevel, type Logger } from "../utils/logger"
import {
  compilePreset as defaultCompilePreset,
  compilePresetFromValue as defaultCompilePresetFromValue,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "../core/index"
import type {
  CompilePresetFromValueInput,
  CompilePresetInput,
  PlanEmission,
  CompilePresetSuccess,
  CreateLayoutPlanSuccess,
} from "../core/index"

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
  run(args?: string[]): Promise<number>
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
  const errorHandlers = createCliErrorHandlers({
    getLogger: () => logger,
  })

  const applyRuntimeOptions = (runtimeOptions: { verbose?: boolean; config?: string }): void => {
    if (runtimeOptions.verbose === true) {
      logger = createLogger({ level: LogLevel.INFO })
    } else {
      logger = createLogger()
    }

    if (
      typeof runtimeOptions.config === "string" &&
      runtimeOptions.config.length > 0 &&
      typeof presetManager.setConfigPath === "function"
    ) {
      presetManager.setConfigPath(runtimeOptions.config)
    }
  }

  const listPresets = async (): Promise<number> => {
    try {
      await presetManager.loadConfig()
      const presets = presetManager.listPresets()

      if (presets.length === 0) {
        logger.warn("No presets defined")
        return 0
      }

      console.log(chalk.bold("Available presets:\n"))

      const maxKeyLength = Math.max(...presets.map((p) => p.key.length))

      presets.forEach((preset: PresetInfo) => {
        const paddedKey = preset.key.padEnd(maxKeyLength + 2)
        const description = preset.description ?? ""
        console.log(`  ${chalk.cyan(paddedKey)} ${description}`)
      })

      return 0
    } catch (error) {
      return errorHandlers.handleError(error)
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
  ): Promise<number> => {
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
      const backendContextBase = {
        logger,
        dryRun: options.dryRun,
        verbose: options.verbose,
        prompt: confirmPaneClosure,
        cwd: process.cwd(),
        paneId: process.env.WEZTERM_PANE,
      } as const

      const backend =
        backendKind === "tmux"
          ? createTerminalBackend("tmux", {
              ...backendContextBase,
              executor,
            })
          : createTerminalBackend("wezterm", backendContextBase)

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
        return errorHandlers.handlePipelineFailure(error)
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
          return errorHandlers.handlePipelineFailure(error)
        }
      }

      logger.success(`Applied preset "${preset.name}"`)
      return 0
    } catch (error) {
      return errorHandlers.handleError(error)
    }
  }

  const setupProgram = (): void => {
    program.exitOverride()

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
    program.hook("preAction", (_thisCommand, actionCommand) => {
      const runtimeOptions =
        typeof actionCommand.optsWithGlobals === "function"
          ? actionCommand.optsWithGlobals()
          : program.opts<{ verbose?: boolean; config?: string }>()
      applyRuntimeOptions(runtimeOptions)
    })

    program
      .command("list")
      .description("List available presets")
      .action(async () => {
        lastExitCode = await listPresets()
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
        lastExitCode = await executePreset(presetName, {
          verbose: opts.verbose === true,
          dryRun: opts.dryRun === true,
          currentWindow: opts.currentWindow === true,
          newWindow: opts.newWindow === true,
          backend: opts.backend,
        })
      })
  }

  let lastExitCode = 0
  setupProgram()

  const run = async (args: string[] = process.argv.slice(2)): Promise<number> => {
    lastExitCode = 0
    logger = createLogger()

    try {
      await program.parseAsync(args, { from: "user" })
    } catch (error) {
      if (error instanceof CommanderError) {
        return error.exitCode
      }
      return errorHandlers.handleError(error)
    }

    return lastExitCode
  }

  return { run }
}
