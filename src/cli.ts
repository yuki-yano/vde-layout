import { Command } from "commander"
import chalk from "chalk"
import { stringify as toYAML } from "yaml"
import { PresetManager } from "./layout/preset"
import { version } from "../package.json"
import type { Preset } from "./models/types"
import type { PresetInfo } from "./models/types"
import type { IPresetManager, ICommandExecutor } from "./interfaces"
import { RealExecutor, DryRunExecutor } from "./executor"
import { executePlan } from "./executor/plan-runner"
import { Logger, LogLevel } from "./utils/logger"
import {
  runDiagnostics,
  compilePreset as defaultCompilePreset,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "./functional-core"
import type {
  DiagnosticsReport,
  DiagnosticsSeverity,
  CompilePresetInput,
  PlanEmission,
  StructuredError,
} from "./functional-core"

const KNOWN_ISSUES: ReadonlyArray<string> = [
  "LayoutEngineがtmux依存とI/Oを同一クラスで扱っている",
  "dry-run実行と本番適用でPlan構造が共有されていない",
  "Loggerが境界層とFunctional Coreの責務を混在させている",
]

const formatSeverityTag = (severity: DiagnosticsSeverity): string => {
  switch (severity) {
    case "high":
      return chalk.red("[HIGH]")
    case "medium":
      return chalk.yellow("[MEDIUM]")
    case "low":
    default:
      return chalk.blue("[LOW]")
  }
}

interface FunctionalCoreBridge {
  compilePreset: (input: CompilePresetInput) => ReturnType<typeof defaultCompilePreset>
  createLayoutPlan: (input: Parameters<typeof defaultCreateLayoutPlan>[0]) => ReturnType<typeof defaultCreateLayoutPlan>
  emitPlan: (input: Parameters<typeof defaultEmitPlan>[0]) => ReturnType<typeof defaultEmitPlan>
}

export interface CLIOptions {
  presetManager?: IPresetManager
  createCommandExecutor?: (options: { verbose: boolean; dryRun: boolean }) => ICommandExecutor
  functionalCore?: FunctionalCoreBridge
}

/**
 * CLI Interface
 * Parses command-line arguments and executes appropriate actions
 */
export class CLI {
  private program: Command
  private presetManager: IPresetManager
  private createCommandExecutor: (options: { verbose: boolean; dryRun: boolean }) => ICommandExecutor
  private logger: Logger
  private functionalCore: FunctionalCoreBridge

  constructor(options: CLIOptions = {}) {
    this.program = new Command()
    this.presetManager = options.presetManager || new PresetManager()
    this.createCommandExecutor =
      options.createCommandExecutor ||
      ((opts): ICommandExecutor => {
        if (opts.dryRun) {
          return new DryRunExecutor({ verbose: opts.verbose })
        }
        return new RealExecutor({ verbose: opts.verbose })
      })
    this.logger = new Logger()
    this.functionalCore =
      options.functionalCore ||
      ({ compilePreset: defaultCompilePreset, createLayoutPlan: defaultCreateLayoutPlan, emitPlan: defaultEmitPlan } as const)
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
      .option("--config <path>", "Path to configuration file")

    // list command
    this.program
      .command("list")
      .description("List available presets")
      .action(async () => {
        await this.listPresets()
      })

    this.program
      .command("diagnose")
      .description("Functional Coreリライトに向けた診断レポートを表示する")
      .argument("[preset]", 'Preset name (defaults to "default" preset when omitted)')
      .action(async (presetName?: string) => {
        await this.diagnosePreset(presetName)
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

      if (opts.config && typeof opts.config === "string" && this.presetManager.setConfigPath) {
        this.presetManager.setConfigPath(opts.config)
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

  private async diagnosePreset(presetName: string | undefined): Promise<void> {
    try {
      await this.presetManager.loadConfig()
      const preset =
        presetName !== undefined && presetName.length > 0
          ? this.presetManager.getPreset(presetName)
          : this.presetManager.getDefaultPreset()

      const presetDocument = toYAML(preset ?? {})
      const report = runDiagnostics({
        presetDocument,
        knownIssues: KNOWN_ISSUES,
      })

      this.renderDiagnosticsReport(report)
      process.exit(0)
    } catch (error) {
      this.handleError(error)
    }
  }

  private renderDiagnosticsReport(report: DiagnosticsReport): void {
    console.log(chalk.bold("\nFunctional Core Diagnostics\n"))

    if (report.backlog.length > 0) {
      console.log(chalk.bold("改善バックログ"))
      report.backlog.forEach((item, index) => {
        const prefix = `${index + 1}. ${formatSeverityTag(item.severity)}`
        console.log(`${prefix} ${item.summary}`)
        item.actions.forEach((action) => {
          console.log(`   - ${action}`)
        })
      })
      console.log("")
    }

    if (report.findings.length > 0) {
      console.log(chalk.bold("診断結果"))
      report.findings.forEach((finding) => {
        console.log(`${formatSeverityTag(finding.severity)} ${finding.path} :: ${finding.description}`)
      })
      console.log("")
    }

    if (report.nextSteps.length > 0) {
      console.log(chalk.bold("次のアクション"))
      report.nextSteps.forEach((step) => {
        console.log(` - ${step}`)
      })
      console.log("")
    }
  }

  private renderDryRun(emission: PlanEmission): void {
    console.log(chalk.bold("\nPlanned tmux steps (dry-run)"))
    emission.steps.forEach((step, index) => {
      const commandString = step.command.join(" ")
      console.log(` ${index + 1}. ${step.summary}: tmux ${commandString}`)
    })
  }

  private buildPresetDocument(preset: Preset, presetName?: string): string {
    const document: Record<string, unknown> = {
      name: preset.name ?? presetName ?? "vde-layout",
      command: preset.command,
      layout: preset.layout,
    }

    if (!preset.command) {
      delete document.command
    }

    if (!preset.layout) {
      delete document.layout
    }

    return toYAML(document)
  }

  private buildPresetSource(presetName?: string): string {
    return presetName ? `preset://${presetName}` : "preset://default"
  }

  private handleFunctionalError(error: StructuredError): never {
    const segments: string[] = []
    if (error.code) {
      segments.push(`[${error.code}]`)
    }
    if (error.path) {
      segments.push(`[${error.path}]`)
    }
    const header = segments.join(" ")
    const lines = [
      `${header} ${error.message}`.trim(),
    ]

    if (error.source) {
      lines.push(`source: ${error.source}`)
    }

    if (error.details?.command) {
      const command = Array.isArray(error.details.command)
        ? `tmux ${(error.details.command as string[]).join(" ")}`
        : String(error.details.command)
      lines.push(`command: ${command}`)
    }

    if (error.details?.stderr) {
      lines.push(`stderr: ${String(error.details.stderr)}`)
    }

    this.logger.error(lines.join("\n"))
    process.exit(1)
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

      const insideTmux = Boolean(process.env.TMUX && process.env.TMUX.length > 0)
      if (!insideTmux && !options.dryRun) {
        throw new Error("Must be run inside a tmux session")
      }

      const effectiveDryRun = options.dryRun

      // Create command executor
      const executor = this.createCommandExecutor({
        verbose: options.verbose,
        dryRun: effectiveDryRun,
      })

      if (effectiveDryRun) {
        const dryRunMessage = "[DRY RUN] No actual commands will be executed"
        console.log(dryRunMessage)
      }

      const compiled = this.functionalCore.compilePreset({
        document: this.buildPresetDocument(preset, presetName),
        source: this.buildPresetSource(presetName),
      })

      if (!compiled.ok) {
        this.handleFunctionalError(compiled.error)
      }

      const planResult = this.functionalCore.createLayoutPlan({
        preset: compiled.value.preset,
      })

      if (!planResult.ok) {
        this.handleFunctionalError(planResult.error)
      }

      const emissionResult = this.functionalCore.emitPlan({
        plan: planResult.value.plan,
      })

      if (!emissionResult.ok) {
        this.handleFunctionalError(emissionResult.error)
      }

      const emission = emissionResult.value

      if (effectiveDryRun) {
        this.renderDryRun(emission)
      } else {
        const executionResult = await executePlan({ emission, executor })
        if (!executionResult.ok) {
          this.handleFunctionalError(executionResult.error)
        }
        this.logger.info(`Executed ${executionResult.value.executedSteps} tmux steps`)
      }

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
