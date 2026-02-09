import chalk from "chalk"

import type { PresetInfo } from "../models/types"
import type { PresetManager } from "../contracts/preset-manager"
import { LogLevel, type Logger } from "../utils/logger"

type RuntimeOptions = {
  readonly verbose?: boolean
  readonly config?: string
}

export const applyRuntimeOptions = ({
  runtimeOptions,
  createLogger,
  presetManager,
}: {
  readonly runtimeOptions: RuntimeOptions
  readonly createLogger: (options?: { level?: LogLevel }) => Logger
  readonly presetManager: PresetManager
}): Logger => {
  const logger =
    runtimeOptions.verbose === true
      ? createLogger({
          level: LogLevel.INFO,
        })
      : createLogger()

  if (
    typeof runtimeOptions.config === "string" &&
    runtimeOptions.config.length > 0 &&
    typeof presetManager.setConfigPath === "function"
  ) {
    presetManager.setConfigPath(runtimeOptions.config)
  }

  return logger
}

export const listPresets = async ({
  presetManager,
  logger,
  onError,
  output = (line: string): void => console.log(line),
}: {
  readonly presetManager: PresetManager
  readonly logger: Logger
  readonly onError: (error: unknown) => number
  readonly output?: (line: string) => void
}): Promise<number> => {
  try {
    await presetManager.loadConfig()
    const presets = presetManager.listPresets()

    if (presets.length === 0) {
      logger.warn("No presets defined")
      return 0
    }

    output(chalk.bold("Available presets:\n"))

    const maxKeyLength = Math.max(...presets.map((preset) => preset.key.length))
    presets.forEach((preset: PresetInfo) => {
      const paddedKey = preset.key.padEnd(maxKeyLength + 2)
      const description = preset.description ?? ""
      output(`  ${chalk.cyan(paddedKey)} ${description}`)
    })

    return 0
  } catch (error) {
    return onError(error)
  }
}
