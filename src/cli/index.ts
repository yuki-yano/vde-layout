import { defineCommand, parseArgs, renderUsage } from "citty"
import type { ArgsDef } from "citty"
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
  normalizeSelectArgs,
  resolveSelectSurfaceMode,
  resolveSelectUiMode,
  selectSurfaceModes,
  selectUiModes,
} from "./select-args"
import { selectPreset as defaultSelectPreset, type SelectPresetInput, type SelectPresetResult } from "./preset-selector"
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
  readonly selectPreset?: (input: SelectPresetInput) => Promise<SelectPresetResult>
}

export type CLI = {
  run(args?: string[]): Promise<number>
}

const backendValues = ["tmux", "wezterm"] as const
const listCommandName = "list"
const EXIT_CODE_CANCELLED = 130

type OptionValueKind = "boolean" | "value"

type OptionSpec = {
  readonly kind: OptionValueKind
  readonly allowOptionLikeValue: boolean
}

type OptionSpecs = {
  readonly longOptions: Map<string, OptionSpec>
  readonly shortOptions: Map<string, OptionSpec>
}

const optionNamesAllowOptionLikeValue = new Set(["fzfArg", "fzf-arg"])

const toKebabCase = (value: string): string => {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

const toOptionSpec = (kind: OptionValueKind, optionName: string): OptionSpec => {
  return {
    kind,
    allowOptionLikeValue: optionNamesAllowOptionLikeValue.has(optionName),
  }
}

const buildOptionSpecs = (argsDef: Readonly<ArgsDef>): OptionSpecs => {
  const longOptions = new Map<string, OptionSpec>()
  const shortOptions = new Map<string, OptionSpec>()

  for (const [argName, arg] of Object.entries(argsDef)) {
    if (arg.type === "positional") {
      continue
    }

    const valueKind: OptionValueKind = arg.type === "boolean" ? "boolean" : "value"
    const kebabName = toKebabCase(argName)
    longOptions.set(argName, toOptionSpec(valueKind, argName))
    longOptions.set(kebabName, toOptionSpec(valueKind, kebabName))

    const aliases =
      "alias" in arg ? (Array.isArray(arg.alias) ? arg.alias : typeof arg.alias === "string" ? [arg.alias] : []) : []
    for (const alias of aliases) {
      if (alias.length === 1) {
        shortOptions.set(alias, toOptionSpec(valueKind, alias))
        continue
      }

      longOptions.set(alias, toOptionSpec(valueKind, alias))
      const kebabAlias = toKebabCase(alias)
      longOptions.set(kebabAlias, toOptionSpec(valueKind, kebabAlias))
    }
  }

  return { longOptions, shortOptions }
}

const validateRawOptions = (args: readonly string[], optionSpecs: OptionSpecs): void => {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (typeof token !== "string") {
      continue
    }

    if (token === "--") {
      break
    }

    if (!token.startsWith("-") || token === "-") {
      continue
    }

    if (token.startsWith("--")) {
      const value = token.slice(2)
      if (value.length === 0) {
        continue
      }

      const separatorIndex = value.indexOf("=")
      const rawOptionName = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value
      const optionName = rawOptionName.startsWith("no-") ? rawOptionName.slice(3) : rawOptionName
      const optionSpec = optionSpecs.longOptions.get(optionName)
      const kind = optionSpec?.kind

      if (kind === undefined) {
        throw new Error(`Unknown option: --${rawOptionName}`)
      }

      if (kind === "value") {
        if (separatorIndex >= 0) {
          const inlineValue = value.slice(separatorIndex + 1)
          if (inlineValue.length === 0) {
            throw new Error(`Missing value for option: --${optionName}`)
          }
        } else {
          const nextToken = args[index + 1]
          if (typeof nextToken !== "string" || nextToken.length === 0) {
            throw new Error(`Missing value for option: --${optionName}`)
          }
          if (nextToken.startsWith("-") && optionSpec?.allowOptionLikeValue !== true) {
            throw new Error(`Missing value for option: --${optionName}`)
          }
          index += 1
        }
      }
      continue
    }

    const shortFlags = token.slice(1)
    for (let flagIndex = 0; flagIndex < shortFlags.length; flagIndex += 1) {
      const option = shortFlags[flagIndex]
      if (typeof option !== "string" || option.length === 0) {
        continue
      }

      const optionSpec = optionSpecs.shortOptions.get(option)
      const kind = optionSpec?.kind
      if (kind === undefined) {
        throw new Error(`Unknown option: -${option}`)
      }

      if (kind === "value") {
        if (flagIndex < shortFlags.length - 1) {
          break
        }

        const nextToken = args[index + 1]
        if (typeof nextToken !== "string" || nextToken.length === 0) {
          throw new Error(`Missing value for option: -${option}`)
        }
        if (nextToken.startsWith("-") && optionSpec?.allowOptionLikeValue !== true) {
          throw new Error(`Missing value for option: -${option}`)
        }
        index += 1
        break
      }
    }
  }
}

const getPositionals = (args: { readonly _: unknown[] }): string[] => {
  return args._.filter((value): value is string => typeof value === "string")
}

const collectOptionValues = ({
  args,
  optionNames,
}: {
  readonly args: readonly string[]
  readonly optionNames: ReadonlyArray<string>
}): string[] => {
  const values: string[] = []
  const optionNameSet = new Set(optionNames)

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (typeof token !== "string") {
      continue
    }

    if (token === "--") {
      break
    }

    if (!token.startsWith("--")) {
      continue
    }

    const eqIndex = token.indexOf("=")
    const rawName = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2)
    if (optionNameSet.has(rawName) !== true) {
      continue
    }

    if (eqIndex >= 0) {
      values.push(token.slice(eqIndex + 1))
      continue
    }

    const nextToken = args[index + 1]
    if (typeof nextToken === "string") {
      values.push(nextToken)
      index += 1
    }
  }

  return values
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
  const selectPreset = options.selectPreset ?? defaultSelectPreset

  const core: CoreBridge =
    options.core ??
    ({
      compilePreset: defaultCompilePreset,
      compilePresetFromValue: defaultCompilePresetFromValue,
      createLayoutPlan: defaultCreateLayoutPlan,
      emitPlan: defaultEmitPlan,
    } as const)

  const require = createRequire(import.meta.url)
  const version = loadPackageVersion(require)
  let logger: Logger = createLogger()
  const errorHandlers = createCliErrorHandlers({
    getLogger: () => logger,
  })

  const rootArgsDef = {
    preset: {
      type: "positional",
      description: 'Preset name (defaults to "default" preset when omitted)',
      required: false,
    },
    verbose: {
      type: "boolean",
      description: "Show detailed logs",
    },
    dryRun: {
      type: "boolean",
      description: "Display commands without executing",
    },
    backend: {
      type: "enum",
      options: [...backendValues],
      description: "Select terminal backend (tmux or wezterm)",
    },
    config: {
      type: "string",
      valueHint: "path",
      description: "Path to configuration file",
    },
    currentWindow: {
      type: "boolean",
      description: "Use the current tmux window for layout (kills other panes)",
    },
    newWindow: {
      type: "boolean",
      description: "Always create a new tmux window for layout",
    },
    select: {
      type: "boolean",
      description: "Select preset from interactive UI",
    },
    selectUi: {
      type: "enum",
      options: [...selectUiModes],
      description: "Select preset UI backend (auto or fzf)",
    },
    selectSurface: {
      type: "enum",
      options: [...selectSurfaceModes],
      description: "Select selector surface mode (auto, inline, or tmux-popup)",
    },
    selectTmuxPopupOpts: {
      type: "string",
      valueHint: "opts",
      description: "tmux popup options used for fzf --tmux=<opts> (example: 80%,70%)",
    },
    fzfArg: {
      type: "string",
      valueHint: "arg",
      description: "Additional argument passed to fzf selector (repeatable)",
    },
    help: {
      type: "boolean",
      alias: "h",
      description: "Show help",
    },
    version: {
      type: "boolean",
      alias: "v",
      description: "Show version",
    },
  } satisfies ArgsDef

  const listCommand = defineCommand<typeof rootArgsDef>({
    meta: {
      name: listCommandName,
      description: "List available presets",
    },
  })

  const rootCommand = defineCommand({
    meta: {
      name: "vde-layout",
      description: "VDE (Vibrant Development Environment) Layout Manager - tmux pane layout management tool",
      version,
    },
    args: rootArgsDef,
    subCommands: {
      [listCommandName]: listCommand,
    },
  })

  const optionSpecs = buildOptionSpecs(rootArgsDef)

  const run = async (args: string[] = process.argv.slice(2)): Promise<number> => {
    logger = createLogger()

    try {
      const normalizedArgs = normalizeSelectArgs(args)
      validateRawOptions(normalizedArgs, optionSpecs)
      const parsedArgs = parseArgs(normalizedArgs, rootArgsDef)
      const fzfCliArgs = collectOptionValues({
        args: normalizedArgs,
        optionNames: ["fzf-arg", "fzfArg"],
      })
      const positionals = getPositionals(parsedArgs)
      const headPositional = positionals[0]

      if (parsedArgs.help === true) {
        const usage =
          headPositional === listCommandName
            ? await renderUsage(listCommand, rootCommand)
            : await renderUsage(rootCommand)
        console.log(`${usage}\n`)
        return 0
      }

      if (parsedArgs.version === true) {
        console.log(version)
        return 0
      }

      logger = applyRuntimeOptions({
        runtimeOptions: {
          verbose: parsedArgs.verbose === true,
          config: typeof parsedArgs.config === "string" ? parsedArgs.config : undefined,
        },
        createLogger,
        presetManager,
      })

      if (headPositional === listCommandName) {
        const extraArgs = positionals.slice(1)
        if (extraArgs.length > 0) {
          throw new Error(
            `too many arguments for '${listCommandName}'. Expected 0 arguments but got ${extraArgs.length}.`,
          )
        }

        return await listPresets({
          presetManager,
          logger,
          onError: errorHandlers.handleError,
        })
      }

      if (positionals.length > 1) {
        throw new Error(`too many arguments. Expected at most 1 argument but got ${positionals.length}.`)
      }

      if (parsedArgs.selectUi !== undefined && parsedArgs.select !== true) {
        throw new Error("--select-ui requires --select")
      }

      if (parsedArgs.selectSurface !== undefined && parsedArgs.select !== true) {
        throw new Error("--select-surface requires --select")
      }

      if (parsedArgs.selectTmuxPopupOpts !== undefined && parsedArgs.select !== true) {
        throw new Error("--select-tmux-popup-opts requires --select")
      }

      if (fzfCliArgs.length > 0 && parsedArgs.select !== true) {
        throw new Error("--fzf-arg requires --select")
      }

      if (parsedArgs.select === true && typeof headPositional === "string" && headPositional.length > 0) {
        throw new Error("Cannot use preset argument with --select")
      }

      let resolvedPresetName = headPositional
      let configLoaded = false
      if (parsedArgs.select === true) {
        await presetManager.loadConfig()
        configLoaded = true

        const selectorDefaults = presetManager.getDefaults()?.selector
        const selectUiMode = resolveSelectUiMode(
          typeof parsedArgs.selectUi === "string" ? parsedArgs.selectUi : selectorDefaults?.ui,
        )
        const selectSurfaceMode = resolveSelectSurfaceMode(
          typeof parsedArgs.selectSurface === "string" ? parsedArgs.selectSurface : selectorDefaults?.surface,
        )
        const selectTmuxPopupOptions =
          typeof parsedArgs.selectTmuxPopupOpts === "string"
            ? parsedArgs.selectTmuxPopupOpts
            : selectorDefaults?.tmuxPopupOpts
        const configFzfArgs = selectorDefaults?.fzf?.extraArgs ?? []
        const selection = await selectPreset({
          uiMode: selectUiMode,
          surfaceMode: selectSurfaceMode,
          tmuxPopupOptions: selectTmuxPopupOptions,
          fzfExtraArgs: [...configFzfArgs, ...fzfCliArgs],
          presetManager,
          logger,
          skipLoadConfig: true,
        })

        if (selection.status === "cancelled") {
          return EXIT_CODE_CANCELLED
        }

        resolvedPresetName = selection.presetName
      }

      return await executePreset({
        presetName: resolvedPresetName,
        skipLoadConfig: configLoaded,
        options: {
          verbose: parsedArgs.verbose === true,
          dryRun: parsedArgs.dryRun === true,
          currentWindow: parsedArgs.currentWindow === true,
          newWindow: parsedArgs.newWindow === true,
          backend: typeof parsedArgs.backend === "string" ? parsedArgs.backend : undefined,
        },
        presetManager,
        createCommandExecutor,
        core,
        logger,
        handleError: errorHandlers.handleError,
        handlePipelineFailure: errorHandlers.handlePipelineFailure,
      })
    } catch (error) {
      return errorHandlers.handleError(error)
    }
  }

  return { run }
}
