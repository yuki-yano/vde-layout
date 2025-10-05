import type { ICommandExecutor } from "../interfaces/command-executor"
import type { ITmuxExecutor } from "../interfaces"
import { EnvironmentError, ErrorCodes } from "../utils/errors"

export interface MockExecutor
  extends ICommandExecutor,
    ITmuxExecutor {
  getExecutedCommands(): string[][]
  clearExecutedCommands(): void
  setMockPaneIds(paneIds: string[]): void
  getPaneIds(): string[]
}

const parseCommand = (commandOrArgs: string | string[]): string[] => {
  return typeof commandOrArgs === "string"
    ? commandOrArgs
        .split(" ")
        .filter((segment) => segment.length > 0)
        .slice(1)
    : commandOrArgs
}

const isInTmuxSession = (): boolean => {
  return Boolean(process.env.TMUX)
}

const toCommandString = (args: string[]): string => {
  return ["tmux", ...args].join(" ")
}

export const createMockExecutor = (): MockExecutor => {
  let mockPaneCounter = 0
  let mockPaneIds: string[] = ["%0"]
  let executedCommands: string[][] = []

  const execute = async (commandOrArgs: string | string[]): Promise<string> => {
    const args = parseCommand(commandOrArgs)
    executedCommands.push(args)

    if (args.includes("display-message") && args.includes("#{pane_id}")) {
      return mockPaneIds[0] ?? "%0"
    }

    if (args.includes("list-panes") && args.includes("#{pane_id}")) {
      return mockPaneIds.join("\n")
    }

    if (args.includes("split-window")) {
      mockPaneCounter += 1
      const newPaneId = `%${mockPaneCounter}`
      mockPaneIds = [...mockPaneIds, newPaneId]
    }

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
    logCommand(): void {
      // noop
    },
    getExecutedCommands(): string[][] {
      return executedCommands
    },
    clearExecutedCommands(): void {
      executedCommands = []
    },
    setMockPaneIds(paneIds: string[]): void {
      mockPaneIds = [...paneIds]
    },
    getPaneIds(): string[] {
      return mockPaneIds
    },
    isInTmuxSession,
    async verifyTmuxEnvironment(): Promise<void> {
      if (!isInTmuxSession()) {
        throw new EnvironmentError("Must be run inside a tmux session", ErrorCodes.NOT_IN_TMUX, {
          hint: "Please start a tmux session and try again",
        })
      }
    },
    getCommandString: toCommandString,
    async getCurrentSessionName(): Promise<string> {
      return "mock-session"
    },
  }
}
