import type { ICommandExecutor } from "../interfaces/command-executor"
import type { ITmuxExecutor } from "../interfaces"
import { EnvironmentError, ErrorCodes } from "../utils/errors"

/**
 * Mock executor for testing that simulates tmux behavior
 */
export class MockExecutor implements ICommandExecutor, ITmuxExecutor {
  private mockPaneCounter: number = 0
  private mockPaneIds: string[] = ["%0"]
  private executedCommands: string[][] = []

  async execute(commandOrArgs: string | string[]): Promise<string> {
    const args = this.parseCommand(commandOrArgs)
    this.executedCommands.push(args)

    // Mock responses for common tmux queries
    if (args.includes("display-message") && args.includes("#{pane_id}")) {
      return this.mockPaneIds[0] ?? "%0"
    }

    if (args.includes("list-panes") && args.includes("#{pane_id}")) {
      return this.mockPaneIds.join("\n")
    }

    // Add new pane ID for split-window command
    if (args.includes("split-window")) {
      this.mockPaneCounter++
      const newPaneId = `%${this.mockPaneCounter}`
      this.mockPaneIds.push(newPaneId)
    }

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

  logCommand(_command: string): void {
    // No logging for mock executor
  }

  // Test helper methods
  getExecutedCommands(): string[][] {
    return this.executedCommands
  }

  clearExecutedCommands(): void {
    this.executedCommands = []
  }

  setMockPaneIds(paneIds: string[]): void {
    this.mockPaneIds = paneIds
  }

  getPaneIds(): string[] {
    return this.mockPaneIds
  }

  private parseCommand(commandOrArgs: string | string[]): string[] {
    return typeof commandOrArgs === "string"
      ? commandOrArgs
          .split(" ")
          .filter((s) => s.length > 0)
          .slice(1)
      : commandOrArgs
  }

  // ITmuxExecutor methods
  isInTmuxSession(): boolean {
    return Boolean(process.env.TMUX)
  }

  async verifyTmuxEnvironment(): Promise<void> {
    if (!this.isInTmuxSession()) {
      throw new EnvironmentError("Must be run inside a tmux session", ErrorCodes.NOT_IN_TMUX, {
        hint: "Please start a tmux session and try again",
      })
    }
  }

  getCommandString(args: string[]): string {
    return ["tmux", ...args].join(" ")
  }

  async getCurrentSessionName(): Promise<string> {
    return "mock-session"
  }
}
