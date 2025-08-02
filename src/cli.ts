import { Command } from "commander"
import chalk from "chalk"
import { PresetManager } from "./layout/preset"
import { LayoutEngine } from "./layout/engine"
import { version } from "../package.json"
import type { PresetInfo } from "./models/types"
import type { IPresetManager, ILayoutEngine, ICommandExecutor } from "./interfaces"
import { RealExecutor, DryRunExecutor } from "./executor"
import { Logger, LogLevel } from "./utils/logger"

export interface CLIOptions {
  presetManager?: IPresetManager
  createLayoutEngine?: (options: { verbose: boolean; dryRun: boolean; executor?: ICommandExecutor }) => ILayoutEngine
  createCommandExecutor?: (options: { verbose: boolean; dryRun: boolean }) => ICommandExecutor
}

/**
 * CLI Interface
 * Parses command-line arguments and executes appropriate actions
 */
export class CLI {
  private program: Command
  private presetManager: IPresetManager
  private createLayoutEngine: (options: {
    verbose: boolean
    dryRun: boolean
    executor?: ICommandExecutor
  }) => ILayoutEngine
  private createCommandExecutor: (options: { verbose: boolean; dryRun: boolean }) => ICommandExecutor
  private logger: Logger

  constructor(options: CLIOptions = {}) {
    this.program = new Command()
    this.presetManager = options.presetManager || new PresetManager()
    this.createLayoutEngine = options.createLayoutEngine || ((opts): LayoutEngine => new LayoutEngine(opts))
    this.createCommandExecutor =
      options.createCommandExecutor ||
      ((opts): ICommandExecutor => {
        if (opts.dryRun) {
          return new DryRunExecutor({ verbose: opts.verbose })
        }
        return new RealExecutor({ verbose: opts.verbose })
      })
    this.logger = new Logger()
    this.setupCommands()
  }

  /**
   * Setup commands
   */
  private setupCommands(): void {
    this.program
      .name("vde-layout")
      .description("VDE (Vibrant Development Environment) Layout Manager - tmux pane layout management tool")
      .version(version, "-V, --version", "Show version")
      .helpOption("-h, --help", "Show help")

    // Global options
    this.program
      .option("-v, --verbose", "Show detailed logs", false)
      .option("--dry-run", "Display commands without executing", false)

    // list command
    this.program
      .command("list")
      .description("List available presets")
      .action(async () => {
        await this.listPresets()
      })

    // Default action (execute preset)
    this.program
      .argument("[preset]", 'Preset name (defaults to "default" preset when omitted)')
      .action(async (presetName?: string) => {
        const options = this.program.opts()
        await this.executePreset(presetName, {
          verbose: options.verbose as boolean,
          dryRun: options.dryRun as boolean,
        })
      })
  }

  /**
   * Execute CLI
   * @param args - Command-line arguments
   */
  async run(args: string[] = process.argv.slice(2)): Promise<void> {
    try {
      // Parse args first to get verbose option
      await this.program.parseAsync(args, { from: "user" })

      // Update logger level based on verbose option
      const opts = this.program.opts()
      if (opts.verbose === true) {
        this.logger = new Logger({ level: LogLevel.INFO })
      }
    } catch (error) {
      // Ignore errors thrown by Commander.js for help and version display
      if (error instanceof Error && error.message.includes("Process exited")) {
        throw error
      }
      this.handleError(error)
    }
  }

  /**
   * Display preset list
   */
  private async listPresets(): Promise<void> {
    try {
      await this.presetManager.loadConfig()
      const presets = this.presetManager.listPresets()

      if (presets.length === 0) {
        this.logger.warn("No presets defined")
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
      this.handleError(error)
    }
  }

  /**
   * Execute preset
   * @param presetName - Preset name
   * @param options - Execution options
   */
  private async executePreset(
    presetName: string | undefined,
    options: { verbose: boolean; dryRun: boolean },
  ): Promise<void> {
    try {
      await this.presetManager.loadConfig()

      // Get preset
      const preset =
        presetName !== undefined && presetName.length > 0
          ? this.presetManager.getPreset(presetName)
          : this.presetManager.getDefaultPreset()

      // Force dry-run mode when outside tmux
      const forceDryRun = process.env.TMUX === undefined
      const effectiveDryRun = options.dryRun || forceDryRun

      // Create command executor
      const executor = this.createCommandExecutor({
        verbose: options.verbose,
        dryRun: effectiveDryRun,
      })

      // Create layout engine with executor
      const engine = this.createLayoutEngine({
        verbose: options.verbose,
        dryRun: effectiveDryRun,
        executor,
      })

      if (effectiveDryRun) {
        this.logger.warn("[DRY RUN] No actual commands will be executed")
        if (forceDryRun && !options.dryRun) {
          this.logger.warn("(Automatically enabled because not in tmux session)")
        }
      }

      await engine.createLayout(preset)

      this.logger.success(`✓ Applied preset "${preset.name}"`)
      process.exit(0)
    } catch (error) {
      this.handleError(error)
    }
  }

  /**
   * Error handling
   * @param error - Error object
   */
  private handleError(error: unknown): void {
    if (error instanceof Error) {
      this.logger.error(error.message, error)
    } else {
      this.logger.error("An unexpected error occurred")
    }

    process.exit(1)
  }
}
