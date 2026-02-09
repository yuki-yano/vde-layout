import { Command, CommanderError } from "commander"
import { createRequire } from "module"
import { createPresetManager } from "../layout/preset"
import { loadPackageVersion } from "./package-version"
import { createCliErrorHandlers } from "./error-handling"
import { applyRuntimeOptions, listPresets } from "./runtime-and-list"
import { executePreset } from "./preset-execution"
import type { CommandExecutor } from "../contracts"
import type { PresetManager } from "../contracts"
import { createRealExecutor, createDryRunExecutor } from "../executor/index"
import { createLogger, type Logger } from "../utils/logger"
import {
  compilePreset as defaultCompilePreset,
  compilePresetFromValue as defaultCompilePresetFromValue,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "../core/index"
import type { CoreBridge } from "./core-bridge"
export type { CoreBridge } from "./core-bridge"

type CLIOptions = {
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
      logger = applyRuntimeOptions({
        runtimeOptions,
        createLogger,
        presetManager,
      })
    })

    program
      .command("list")
      .description("List available presets")
      .action(async () => {
        lastExitCode = await listPresets({
          presetManager,
          logger,
          onError: errorHandlers.handleError,
        })
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
        lastExitCode = await executePreset({
          presetName,
          options: {
            verbose: opts.verbose === true,
            dryRun: opts.dryRun === true,
            currentWindow: opts.currentWindow === true,
            newWindow: opts.newWindow === true,
            backend: opts.backend,
          },
          presetManager,
          createCommandExecutor,
          core,
          logger,
          handleError: errorHandlers.handleError,
          handlePipelineFailure: errorHandlers.handlePipelineFailure,
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
