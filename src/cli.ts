import { Command } from "commander"
import chalk from "chalk"
import { stringify as toYAML } from "yaml"
import { createRequire } from "module"
import { PresetManager } from "./layout/preset.ts"
import type { Preset, PresetInfo } from "./models/types"
import type { IPresetManager, ICommandExecutor } from "./interfaces"
import { createRealExecutor, createDryRunExecutor } from "./executor/index.ts"
import { executePlan } from "./executor/plan-runner.ts"
import { createLogger, LogLevel, type Logger } from "./utils/logger.ts"
import {
  runDiagnostics,
  compilePreset as defaultCompilePreset,
  createLayoutPlan as defaultCreateLayoutPlan,
  emitPlan as defaultEmitPlan,
} from "./core/index.ts"
import type {
  DiagnosticsReport,
  DiagnosticsSeverity,
  CompilePresetInput,
  PlanEmission,
  StructuredError,
} from "./core/index.ts"

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

export interface FunctionalCoreBridge {
  readonly compilePreset: (input: CompilePresetInput) => ReturnType<typeof defaultCompilePreset>
  readonly createLayoutPlan: (
    input: Parameters<typeof defaultCreateLayoutPlan>[0],
  ) => ReturnType<typeof defaultCreateLayoutPlan>
  readonly emitPlan: (input: Parameters<typeof defaultEmitPlan>[0]) => ReturnType<typeof defaultEmitPlan>
}

export interface CLIOptions {
  readonly presetManager?: IPresetManager
  readonly createCommandExecutor?: (options: { verbose: boolean; dryRun: boolean }) => ICommandExecutor
  readonly functionalCore?: FunctionalCoreBridge
}

export interface CLI {
  run(args?: string[]): Promise<void>
}

export const createCli = (options: CLIOptions = {}): CLI => {
  const presetManager = options.presetManager ?? new PresetManager()
  const createCommandExecutor =
    options.createCommandExecutor ??
    ((opts: { verbose: boolean; dryRun: boolean }): ICommandExecutor => {
      if (opts.dryRun) {
        return createDryRunExecutor({ verbose: opts.verbose })
      }
      return createRealExecutor({ verbose: opts.verbose })
    })

  const functionalCore: FunctionalCoreBridge =
    options.functionalCore ??
    ({
      compilePreset: defaultCompilePreset,
      createLayoutPlan: defaultCreateLayoutPlan,
      emitPlan: defaultEmitPlan,
    } as const)

  const program = new Command()
  const require = createRequire(import.meta.url)
  const { version } = require("../package.json") as { version: string }
  let logger: Logger = createLogger()

  const renderDiagnosticsReport = (report: DiagnosticsReport): void => {
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

  const renderDryRun = (emission: PlanEmission): void => {
    console.log(chalk.bold("\nPlanned tmux steps (dry-run)"))
    emission.steps.forEach((step, index) => {
      const commandString = step.command.join(" ")
      console.log(` ${index + 1}. ${step.summary}: tmux ${commandString}`)
    })
  }

  const buildPresetDocument = (preset: Preset, presetName?: string): string => {
    const document: Record<string, unknown> = {
      name: preset.name ?? presetName ?? "vde-layout",
      command: preset.command,
      layout: preset.layout,
    }

    if (typeof preset.command !== "string" || preset.command.length === 0) {
      delete document.command
    }

    if (preset.layout === undefined || preset.layout === null) {
      delete document.layout
    }

    return toYAML(document)
  }

  const buildPresetSource = (presetName?: string): string => {
    return typeof presetName === "string" && presetName.length > 0 ? `preset://${presetName}` : "preset://default"
  }

  const handleFunctionalError = (error: StructuredError): never => {
    const segments: string[] = []
    if (typeof error.code === "string" && error.code.length > 0) {
      segments.push(`[${error.code}]`)
    }
    if (typeof error.path === "string" && error.path.length > 0) {
      segments.push(`[${error.path}]`)
    }

    const header = segments.join(" ")
    const lines = [`${header} ${error.message}`.trim()]

    if (typeof error.source === "string" && error.source.length > 0) {
      lines.push(`source: ${error.source}`)
    }

    const commandDetail = error.details?.command
    if (Array.isArray(commandDetail)) {
      const tmuxCommand = commandDetail.filter((segment): segment is string => typeof segment === "string")
      lines.push(`command: tmux ${tmuxCommand.join(" ")}`)
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

  const diagnosePreset = async (presetName: string | undefined): Promise<never> => {
    try {
      await presetManager.loadConfig()
      const preset =
        typeof presetName === "string" && presetName.length > 0
          ? presetManager.getPreset(presetName)
          : presetManager.getDefaultPreset()

      const presetDocument = toYAML(preset ?? {})
      const report = runDiagnostics({
        presetDocument,
        knownIssues: KNOWN_ISSUES,
      })

      renderDiagnosticsReport(report)
      process.exit(0)
    } catch (error) {
      return handleError(error)
    }
  }

  const executePreset = async (
    presetName: string | undefined,
    options: { verbose: boolean; dryRun: boolean },
  ): Promise<never> => {
    try {
      await presetManager.loadConfig()

      const preset =
        typeof presetName === "string" && presetName.length > 0
          ? presetManager.getPreset(presetName)
          : presetManager.getDefaultPreset()

      const tmuxEnv = process.env.TMUX
      const insideTmux = typeof tmuxEnv === "string" && tmuxEnv.length > 0
      if (!insideTmux && options.dryRun !== true) {
        throw new Error("Must be run inside a tmux session")
      }

      const executor = createCommandExecutor({
        verbose: options.verbose,
        dryRun: options.dryRun,
      })

      if (options.dryRun === true) {
        console.log("[DRY RUN] No actual commands will be executed")
      }

      const compiled = functionalCore.compilePreset({
        document: buildPresetDocument(preset, presetName),
        source: buildPresetSource(presetName),
      })

      if (!compiled.ok) {
        return handleFunctionalError(compiled.error)
      }

      const planResult = functionalCore.createLayoutPlan({
        preset: compiled.value.preset,
      })

      if (!planResult.ok) {
        return handleFunctionalError(planResult.error)
      }

      const emissionResult = functionalCore.emitPlan({
        plan: planResult.value.plan,
      })

      if (!emissionResult.ok) {
        return handleFunctionalError(emissionResult.error)
      }

      const emission = emissionResult.value

      if (options.dryRun === true) {
        renderDryRun(emission)
      } else {
        const executionResult = await executePlan({ emission, executor })
        if (!executionResult.ok) {
          return handleFunctionalError(executionResult.error)
        }
        logger.info(`Executed ${executionResult.value.executedSteps} tmux steps`)
      }

      logger.success(`✓ Applied preset "${preset.name}"`)
      process.exit(0)
    } catch (error) {
      return handleError(error)
    }
  }

  const setupProgram = (): void => {
    program
      .name("vde-layout")
      .description("VDE (Vibrant Development Environment) Layout Manager - tmux pane layout management tool")
      .version(version, "-V, --version", "Show version")
      .helpOption("-h, --help", "Show help")

    program.option("-v, --verbose", "Show detailed logs", false)
    program.option("--dry-run", "Display commands without executing", false)
    program.option("--config <path>", "Path to configuration file")

    program
      .command("list")
      .description("List available presets")
      .action(async () => {
        await listPresets()
      })

    program
      .command("diagnose")
      .description("Functional Coreリライトに向けた診断レポートを表示する")
      .argument("[preset]", 'Preset name (defaults to "default" preset when omitted)')
      .action(async (presetName?: string) => {
        await diagnosePreset(presetName)
      })

    program
      .argument("[preset]", 'Preset name (defaults to "default" preset when omitted)')
      .action(async (presetName?: string) => {
        const opts = program.opts<{ verbose?: boolean; dryRun?: boolean }>()
        await executePreset(presetName, {
          verbose: opts.verbose === true,
          dryRun: opts.dryRun === true,
        })
      })
  }

  setupProgram()

  const run = async (args: string[] = process.argv.slice(2)): Promise<void> => {
    const requestedVersion = args.includes("--version") || args.includes("-V")
    const requestedHelp = args.includes("--help") || args.includes("-h")
    try {
      await program.parseAsync(args, { from: "user" })
      const opts = program.opts<{ verbose?: boolean; config?: string }>()

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
