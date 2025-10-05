import { execa } from "execa"
import { createTmuxError, ErrorCodes } from "../utils/errors.ts"
import type { CommandExecutor } from "../types/command-executor.ts"
import { createLogger, LogLevel } from "../utils/logger.ts"

export type RealExecutorOptions = {
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

export const createRealExecutor = (options: RealExecutorOptions = {}): CommandExecutor => {
  const verbose = options.verbose ?? false
  const logger = createLogger({
    level: verbose ? LogLevel.INFO : LogLevel.WARN,
    prefix: "[tmux]",
  })

  const execute = async (commandOrArgs: string | string[]): Promise<string> => {
    const args = parseCommand(commandOrArgs)
    const commandString = toCommandString(args)

    logger.info(`Executing: ${commandString}`)

    try {
      const result = await execa("tmux", args)
      return result.stdout
    } catch (error) {
      const execaError = error as { exitCode?: number; stderr?: string; message: string }

      throw createTmuxError("Failed to execute tmux command", ErrorCodes.TMUX_COMMAND_FAILED, {
        command: commandString,
        exitCode: execaError.exitCode,
        stderr: execaError.stderr,
      })
    }
  }

  return {
    execute,
    async executeMany(commandsList: string[][]): Promise<void> {
      for (const args of commandsList) {
        await execute(args)
      }
    },
    isDryRun(): boolean {
      return false
    },
    logCommand(command: string): void {
      logger.info(`Executing: ${command}`)
    },
  }
}
