import type { ICommandExecutor } from "../interfaces/command-executor"
import { Logger, LogLevel } from "../utils/logger"

export interface DryRunExecutorOptions {
  verbose?: boolean
}

/**
 * Dry-run executor that logs commands without executing them
 */
export class DryRunExecutor implements ICommandExecutor {
  private readonly verbose: boolean
  private readonly logger: Logger

  constructor(options: DryRunExecutorOptions = {}) {
    this.verbose = options.verbose ?? false
    this.logger = new Logger({
      level: this.verbose ? LogLevel.INFO : LogLevel.WARN,
      prefix: "[tmux] [DRY RUN]",
    })
  }

  async execute(commandOrArgs: string | string[]): Promise<string> {
    const args = this.parseCommand(commandOrArgs)
    const commandString = this.getCommandString(args)

    this.logCommand(commandString)

    // Return empty string for dry-run
    return ""
  }

  async executeMany(commandsList: string[][]): Promise<void> {
    for (const args of commandsList) {
      await this.execute(args)
    }
  }

  isDryRun(): boolean {
    return true
  }

  logCommand(command: string): void {
    this.logger.info(`Would execute: ${command}`)
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
