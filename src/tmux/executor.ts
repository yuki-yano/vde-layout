import { execa } from "execa"
import { EnvironmentError, ErrorCodes } from "../utils/errors"
import type { ITmuxExecutor } from "../interfaces"
import type { ICommandExecutor } from "../interfaces/command-executor"
import { RealExecutor, DryRunExecutor, MockExecutor } from "../executor"

export interface TmuxExecutorOptions {
  verbose?: boolean
  dryRun?: boolean
  executor?: ICommandExecutor
}

/**
 * Class that manages tmux command execution
 * Provides safe command execution and error handling
 */
export class TmuxExecutor implements ITmuxExecutor {
  private readonly executor: ICommandExecutor

  constructor(options: TmuxExecutorOptions = {}) {
    if (options.executor) {
      this.executor = options.executor
    } else if (options.dryRun === true) {
      this.executor = new DryRunExecutor({ verbose: options.verbose })
    } else if (this.isTestEnvironment()) {
      // Automatically use MockExecutor in test environment when not dry-run
      this.executor = new MockExecutor()
    } else {
      this.executor = new RealExecutor({ verbose: options.verbose })
    }
  }

  private isTestEnvironment(): boolean {
    return process.env.VDE_TEST_MODE === "true" || process.env.NODE_ENV === "test" || process.env.VITEST === "true"
  }

  /**
   * Check if currently inside a tmux session
   * @returns true if inside a tmux session
   */
  isInTmuxSession(): boolean {
    return Boolean(process.env.TMUX)
  }

  /**
   * Verify that tmux environment is properly configured
   * @throws {EnvironmentError} When outside tmux session or tmux is unavailable
   */
  async verifyTmuxEnvironment(): Promise<void> {
    if (!this.isInTmuxSession()) {
      throw new EnvironmentError("Must be run inside a tmux session", ErrorCodes.NOT_IN_TMUX, {
        hint: "Please start a tmux session and try again",
      })
    }

    // Skip tmux command check in dry-run mode or test mode
    if (this.executor.isDryRun()) {
      return
    }

    // Check if tmux command is available
    try {
      await execa("tmux", ["-V"])
    } catch (_error) {
      throw new EnvironmentError("tmux is not installed", ErrorCodes.TMUX_NOT_FOUND, {
        hint: "Please install tmux",
      })
    }
  }

  /**
   * Execute tmux command
   * @param args - Array of tmux command arguments or command string
   * @returns Standard output of the command
   * @throws {TmuxError} When command execution fails
   */
  async execute(commandOrArgs: string | string[]): Promise<string> {
    return this.executor.execute(commandOrArgs)
  }

  /**
   * Execute multiple tmux commands in sequence
   * @param commandsList - Array of commands to execute
   */
  async executeMany(commandsList: string[][]): Promise<void> {
    return this.executor.executeMany(commandsList)
  }

  /**
   * Convert command array to string format
   * @param args - Array of tmux command arguments
   * @returns Formatted command string
   */
  getCommandString(args: string[]): string {
    return ["tmux", ...args].join(" ")
  }

  /**
   * Get current tmux session name
   * @returns Session name
   */
  async getCurrentSessionName(): Promise<string> {
    return this.execute(["display-message", "-p", "#{session_name}"])
  }

  /**
   * Get the internal executor (for testing purposes)
   */
  getExecutor(): ICommandExecutor {
    return this.executor
  }
}
