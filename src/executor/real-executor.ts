import { execa } from "execa"
import { TmuxError, ErrorCodes } from "../utils/errors"
import type { ICommandExecutor } from "../interfaces/command-executor"
import { Logger, LogLevel } from "../utils/logger"

export interface RealExecutorOptions {
  verbose?: boolean
}

/**
 * Real command executor that runs actual tmux commands
 */
export class RealExecutor implements ICommandExecutor {
  private readonly verbose: boolean
  private readonly logger: Logger

  constructor(options: RealExecutorOptions = {}) {
    this.verbose = options.verbose ?? false
    this.logger = new Logger({
      level: this.verbose ? LogLevel.INFO : LogLevel.WARN,
      prefix: "[tmux]",
    })
  }

  async execute(commandOrArgs: string | string[]): Promise<string> {
    const args = this.parseCommand(commandOrArgs)
    const commandString = this.getCommandString(args)

    this.logCommand(commandString)

    try {
      const result = await execa("tmux", args)
      return result.stdout
    } catch (error) {
      const execaError = error as { exitCode?: number; stderr?: string; message: string }

      throw new TmuxError("Failed to execute tmux command", ErrorCodes.TMUX_COMMAND_FAILED, {
        command: commandString,
        exitCode: execaError.exitCode,
        stderr: execaError.stderr,
      })
    }
  }

  async executeMany(commandsList: string[][]): Promise<void> {
    for (const args of commandsList) {
      await this.execute(args)
    }
  }

  isDryRun(): boolean {
    return false
  }

  logCommand(command: string): void {
    this.logger.info(`Executing: ${command}`)
  }

  private parseCommand(commandOrArgs: string | string[]): string[] {
    return typeof commandOrArgs === "string"
      ? commandOrArgs
          .split(" ")
          .filter((s) => s.length > 0)
          .slice(1)
      : commandOrArgs
  }

  private getCommandString(args: string[]): string {
    return ["tmux", ...args].join(" ")
  }
}
