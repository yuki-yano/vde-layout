import type { CommandExecutor } from "../types/command-executor.ts"
import type { TmuxExecutorContract } from "../types/tmux.ts"
import { createEnvironmentError, ErrorCodes } from "../utils/errors.ts"

export type MockExecutor = CommandExecutor &
  TmuxExecutorContract & {
    readonly getExecutedCommands: () => string[][]
    readonly clearExecutedCommands: () => void
    readonly setMockPaneIds: (paneIds: string[]) => void
    readonly getPaneIds: () => string[]
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

    if (args[0] === "new-window") {
      mockPaneCounter = 0
      mockPaneIds = ["%0"]
      return "%0"
    }

    if (args.includes("display-message") && args.includes("#{pane_id}")) {
      return mockPaneIds[0] ?? "%0"
    }

    if (args.includes("list-panes") && args.includes("#{pane_id}")) {
      return mockPaneIds.join("\n")
    }

    if (args[0] === "kill-pane" && args.includes("-a")) {
      const targetIndex = args.indexOf("-t")
      const targetPane =
        (targetIndex >= 0 && targetIndex + 1 < args.length ? args[targetIndex + 1] : mockPaneIds[0]) ?? "%0"
      mockPaneIds = [targetPane]
      const parsedCounter = Number(targetPane.replace("%", ""))
      if (!Number.isNaN(parsedCounter)) {
        mockPaneCounter = parsedCounter
      }
      return ""
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
        throw createEnvironmentError("Must be run inside a tmux session", ErrorCodes.NOT_IN_TMUX, {
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
