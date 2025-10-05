import { execa } from "execa"
import { createEnvironmentError, ErrorCodes } from "../utils/errors.ts"
import type { TmuxExecutorContract } from "../types/tmux.ts"
import type { CommandExecutor } from "../types/command-executor.ts"
import { createRealExecutor, createDryRunExecutor, createMockExecutor } from "../executor/index.ts"

type TmuxExecutorOptions = {
  readonly verbose?: boolean
  readonly dryRun?: boolean
  readonly executor?: CommandExecutor
}

export type TmuxExecutor = TmuxExecutorContract & {
  readonly getExecutor: () => CommandExecutor
}

export const createTmuxExecutor = (options: TmuxExecutorOptions = {}): TmuxExecutor => {
  const executor = resolveExecutor(options)

  const isInTmuxSession = (): boolean => {
    return Boolean(process.env.TMUX)
  }

  const verifyTmuxEnvironment = async (): Promise<void> => {
    if (!isInTmuxSession()) {
      throw createEnvironmentError("Must be run inside a tmux session", ErrorCodes.NOT_IN_TMUX, {
        hint: "Please start a tmux session and try again",
      })
    }

    if (executor.isDryRun()) {
      return
    }

    try {
      await execa("tmux", ["-V"])
    } catch (_error) {
      throw createEnvironmentError("tmux is not installed", ErrorCodes.TMUX_NOT_FOUND, {
        hint: "Please install tmux",
      })
    }
  }

  const execute = async (commandOrArgs: string | string[]): Promise<string> => {
    return executor.execute(commandOrArgs)
  }

  const executeMany = async (commandsList: string[][]): Promise<void> => {
    for (const command of commandsList) {
      await execute(command)
    }
  }

  const getCommandString = (args: string[]): string => {
    return ["tmux", ...args].join(" ")
  }

  const getCurrentSessionName = async (): Promise<string> => {
    return execute(["display-message", "-p", "#{session_name}"])
  }

  return {
    verifyTmuxEnvironment,
    execute,
    executeMany,
    isInTmuxSession,
    getCurrentSessionName,
    getCommandString,
    getExecutor: () => executor,
  }
}

const resolveExecutor = (options: TmuxExecutorOptions): CommandExecutor => {
  if (options.executor) {
    return options.executor
  }

  if (options.dryRun === true) {
    return createDryRunExecutor({ verbose: options.verbose })
  }

  if (isTestEnvironment()) {
    return createMockExecutor()
  }

  return createRealExecutor({ verbose: options.verbose })
}

const isTestEnvironment = (): boolean => {
  return process.env.VDE_TEST_MODE === "true" || process.env.NODE_ENV === "test" || process.env.VITEST === "true"
}
