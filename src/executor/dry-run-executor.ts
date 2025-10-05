import type { CommandExecutor } from "../types/command-executor.ts"
import { createLogger, LogLevel } from "../utils/logger.ts"

export type DryRunExecutorOptions = {
  readonly verbose?: boolean
}

const parseCommand = (commandOrArgs: string | string[]): string[] => {
  return typeof commandOrArgs === "string"
    ? commandOrArgs
        .split(" ")
        .filter((segment) => segment.length > 0)
        .slice(1)
    : commandOrArgs
}

const toCommandString = (args: string[]): string => {
  return ["tmux", ...args].join(" ")
}

export const createDryRunExecutor = (options: DryRunExecutorOptions = {}): CommandExecutor => {
  const verbose = options.verbose ?? false
  const logger = createLogger({
    level: verbose ? LogLevel.INFO : LogLevel.WARN,
    prefix: "[tmux] [DRY RUN]",
  })

  const execute = async (commandOrArgs: string | string[]): Promise<string> => {
    const args = parseCommand(commandOrArgs)
    const commandString = toCommandString(args)
    logger.info(`Would execute: ${commandString}`)
    return ""
  }

  return {
    execute,
    async executeMany(commandsList: string[][]): Promise<void> {
      for (const args of commandsList) {
        await execute(args)
      }
    },
    isDryRun(): boolean {
      return true
    },
    logCommand(command: string): void {
      logger.info(`Would execute: ${command}`)
    },
  }
}
