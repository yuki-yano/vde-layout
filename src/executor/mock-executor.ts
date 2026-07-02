import type { CommandExecutor } from "../contracts"
import type { TmuxExecutorContract } from "../contracts"
import { createEnvironmentError, ErrorCodes } from "../utils/errors"

export type MockExecutor = CommandExecutor &
  TmuxExecutorContract & {
    readonly getExecutedCommands: () => string[][]
    readonly clearExecutedCommands: () => void
    readonly setMockPaneIds: (paneIds: string[]) => void
    readonly getPaneIds: () => string[]
    readonly setMockProtectedPaneIds: (paneIds: string[]) => void
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
  let mockProtectedPaneIds: string[] = []
  let executedCommands: string[][] = []

  const execute = async (commandOrArgs: string | string[]): Promise<string> => {
    const args = parseCommand(commandOrArgs)
    executedCommands.push(args)

    if (args[0] === "new-window") {
      mockPaneCounter = 0
      mockPaneIds = ["%0"]
      return "%0"
    }

    if (args.includes("display-message")) {
      const parts: string[] = []
      if (args.includes("#{pane_id}")) {
        parts.push(mockPaneIds[0] ?? "%0")
      }
      if (args.includes("#{pane_width}")) {
        parts.push("200")
      }
      if (args.includes("#{pane_height}")) {
        parts.push("60")
      }
      if (parts.length > 0) {
        return parts.join(" ")
      }
    }

    // The two list-panes formats below are matched by exact string equality on the
    // -F argument, so at most one of these branches ever applies to a given call.
    if (args.includes("list-panes") && args.includes("#{pane_id}\t#{@vde_sidebar}")) {
      const protectedPaneIds = new Set(mockProtectedPaneIds)
      return mockPaneIds.map((paneId) => `${paneId}\t${protectedPaneIds.has(paneId) ? "1" : ""}`).join("\n")
    }

    if (args.includes("list-panes") && args.includes("#{pane_id}")) {
      return mockPaneIds.join("\n")
    }

    if (args[0] === "kill-pane" && args.includes("-a")) {
      // NOTE: Real tmux's `kill-pane -a -t <target>` kills every other pane in the
      // window, including sidebar panes. This mock deliberately diverges by keeping
      // mockProtectedPaneIds alive so tests can simulate protection, but production
      // code must not rely on `kill-pane -a` alone to spare the sidebar: it has to
      // compute the kill target set explicitly via classifyWindowPanes and kill
      // non-sidebar panes individually (see plan.md Step 1-4).
      const targetIndex = args.indexOf("-t")
      const targetPane =
        (targetIndex >= 0 && targetIndex + 1 < args.length ? args[targetIndex + 1] : mockPaneIds[0]) ?? "%0"
      const survivingPaneIds = mockPaneIds.filter(
        (paneId) => paneId === targetPane || mockProtectedPaneIds.includes(paneId),
      )
      mockPaneIds = survivingPaneIds.includes(targetPane) ? survivingPaneIds : [targetPane, ...survivingPaneIds]
      const parsedCounter = Number(targetPane.replace("%", ""))
      if (!Number.isNaN(parsedCounter)) {
        mockPaneCounter = parsedCounter
      }
      return ""
    }

    if (args[0] === "kill-pane") {
      // Individual `kill-pane -t <target>` (no `-a`): only the named pane is
      // removed, matching real tmux. Production code relies on this to close
      // non-sidebar panes one at a time (see plan.md Step 1-4).
      const targetIndex = args.indexOf("-t")
      const targetPane = targetIndex >= 0 && targetIndex + 1 < args.length ? args[targetIndex + 1] : undefined
      if (typeof targetPane === "string") {
        mockPaneIds = mockPaneIds.filter((paneId) => paneId !== targetPane)
      }
      return ""
    }

    if (args.includes("split-window")) {
      mockPaneCounter += 1
      const newPaneId = `%${mockPaneCounter}`
      mockPaneIds = [...mockPaneIds, newPaneId]

      // `-P -F "#{pane_id}"` asks tmux to print the newly created pane id, matching
      // real tmux's split-window behavior (see splitPaneBesideSidebar).
      if (args.includes("-P") && args.includes("#{pane_id}")) {
        return newPaneId
      }
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
    setMockProtectedPaneIds(paneIds: string[]): void {
      mockProtectedPaneIds = [...paneIds]
    },
    isInTmuxSession,
    async verifyTmuxEnvironment(): Promise<void> {
      if (!isInTmuxSession()) {
        throw createEnvironmentError("Must be run inside a tmux session", ErrorCodes.NOT_IN_TMUX_SESSION, {
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
