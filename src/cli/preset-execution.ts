import { createTerminalBackend } from "../executor/backend-factory"
import { resolveTerminalBackendKind } from "../executor/backend-resolver"
import type { TerminalBackendKind } from "../executor/terminal-backend"
import type { WindowMode } from "../models/types"
import type { CommandExecutor } from "../types/command-executor"
import type { PresetManager } from "../types/preset-manager"
import type { Logger } from "../utils/logger"
import { buildPresetSource, determineCliWindowMode, renderDryRun } from "./command-helpers"
import type { CoreBridge } from "./core-bridge"
import { createPaneKillPrompter } from "./user-prompt"
import { resolveWindowMode } from "./window-mode"

type ExecutePresetCliOptions = {
  readonly verbose: boolean
  readonly dryRun: boolean
  readonly currentWindow: boolean
  readonly newWindow: boolean
  readonly backend?: string
}

type ExecutePresetInput = {
  readonly presetName: string | undefined
  readonly options: ExecutePresetCliOptions
  readonly presetManager: PresetManager
  readonly createCommandExecutor: (options: { verbose: boolean; dryRun: boolean }) => CommandExecutor
  readonly core: CoreBridge
  readonly logger: Logger
  readonly handleError: (error: unknown) => number
  readonly handlePipelineFailure: (error: unknown) => number
  readonly output?: (line: string) => void
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

export const executePreset = async ({
  presetName,
  options,
  presetManager,
  createCommandExecutor,
  core,
  logger,
  handleError,
  handlePipelineFailure,
  output = (line: string): void => console.log(line),
  cwd = process.cwd(),
  env = process.env,
}: ExecutePresetInput): Promise<number> => {
  try {
    await presetManager.loadConfig()

    const preset =
      typeof presetName === "string" && presetName.length > 0
        ? presetManager.getPreset(presetName)
        : presetManager.getDefaultPreset()

    const windowModeResolution = resolveWindowModeForPreset({
      presetManager,
      options,
      presetWindowMode: preset.windowMode,
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
      env,
    })
    logger.info(`Terminal backend: ${backendKind}`)
    const backendContextBase = {
      logger,
      dryRun: options.dryRun,
      verbose: options.verbose,
      prompt: confirmPaneClosure,
      cwd,
      paneId: env.WEZTERM_PANE,
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
      output("[DRY RUN] No actual commands will be executed")
    }

    let emission
    try {
      emission = buildPlanEmission({
        core,
        preset,
        presetName,
      })
    } catch (error) {
      return handlePipelineFailure(error)
    }

    if (options.dryRun === true) {
      const dryRunSteps = backend.getDryRunSteps(emission)
      renderDryRun(dryRunSteps, output)
    } else {
      try {
        const executionResult = await backend.applyPlan({
          emission,
          windowMode,
          windowName: resolveWindowName({
            presetName,
            presetDisplayName: preset.name,
          }),
        })
        logger.info(`Executed ${executionResult.executedSteps} ${backendKind} steps`)
      } catch (error) {
        return handlePipelineFailure(error)
      }
    }

    logger.success(`Applied preset "${preset.name}"`)
    return 0
  } catch (error) {
    return handleError(error)
  }
}

const buildPlanEmission = ({
  core,
  preset,
  presetName,
}: {
  readonly core: CoreBridge
  readonly preset: ReturnType<PresetManager["getDefaultPreset"]>
  readonly presetName?: string
}): ReturnType<CoreBridge["emitPlan"]> => {
  const compileResult = core.compilePresetFromValue({
    value: preset,
    source: buildPresetSource(presetName),
  })
  const planResult = core.createLayoutPlan({ preset: compileResult.preset })
  return core.emitPlan({ plan: planResult.plan })
}

const resolveWindowName = ({
  presetName,
  presetDisplayName,
}: {
  readonly presetName: string | undefined
  readonly presetDisplayName?: string
}): string => {
  return presetDisplayName ?? presetName ?? "vde-layout"
}

const resolveWindowModeForPreset = ({
  presetManager,
  options,
  presetWindowMode,
}: {
  readonly presetManager: PresetManager
  readonly options: ExecutePresetCliOptions
  readonly presetWindowMode: WindowMode | undefined
}): ReturnType<typeof resolveWindowMode> => {
  const cliWindowMode = determineCliWindowMode({
    currentWindow: options.currentWindow,
    newWindow: options.newWindow,
  })
  const defaults = presetManager.getDefaults()
  return resolveWindowMode({
    cli: cliWindowMode,
    preset: presetWindowMode,
    defaults: defaults?.windowMode,
  })
}
