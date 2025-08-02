/**
 * Interface for command execution
 * Allows for different implementations (real execution, dry-run, mock for testing)
 */
export interface ICommandExecutor {
  /**
   * Execute a command
   * @param command - Command string or array of arguments
   * @returns Command output
   */
  execute(command: string | string[]): Promise<string>

  /**
   * Execute multiple commands in sequence
   * @param commands - Array of commands
   */
  executeMany(commands: string[][]): Promise<void>

  /**
   * Check if the executor is in dry-run mode
   */
  isDryRun(): boolean

  /**
   * Log a command (for verbose mode)
   */
  logCommand(command: string): void
}
