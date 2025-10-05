import { vi } from "vitest"
import type { Result } from "execa"

type TmuxMockCommand = {
  readonly command: string
  readonly args: string[]
  readonly response: string | Error
  readonly exitCode?: number
}

const createExecaResult = (stdout: string, exitCode: number): Result => {
  return {
    stdout,
    stderr: "",
    exitCode,
    command: "tmux",
    escapedCommand: "tmux",
    failed: exitCode !== 0,
    timedOut: false,
    killed: false,
    isCanceled: false,
    pipedFrom: [],
  } as Result
}

export const createTmuxMock = () => {
  let commands: TmuxMockCommand[] = []
  let defaultResponse = ""
  let isInsideTmux = true

  const setIsInsideTmux = (value: boolean) => {
    isInsideTmux = value
  }

  const addCommand = (command: string, args: string[], response: string | Error, exitCode = 0) => {
    commands.push({ command, args, response, exitCode })
  }

  const setDefaultResponse = (response: string) => {
    defaultResponse = response
  }

  const execute = async (command: string, args: string[] = []): Promise<Result> => {
    if (command === "tmux" && args[0] === "info" && !isInsideTmux) {
      throw new Error("sessions should be nested with care, unset $TMUX to force")
    }

    const mockCommand = commands.find(
      (cmd) => cmd.command === command && JSON.stringify(cmd.args) === JSON.stringify(args),
    )

    if (mockCommand) {
      if (mockCommand.response instanceof Error) {
        throw mockCommand.response
      }
      return createExecaResult(mockCommand.response, mockCommand.exitCode ?? 0)
    }

    return createExecaResult(defaultResponse, 0)
  }

  const reset = () => {
    commands = []
    defaultResponse = ""
    isInsideTmux = true
  }

  return {
    setIsInsideTmux,
    addCommand,
    setDefaultResponse,
    execute,
    reset,
  }
}

export const tmuxMock = createTmuxMock()

export const mockExeca = (): ReturnType<typeof vi.fn> => {
  return vi.fn().mockImplementation(async (command: string, args?: string[]) => {
    return tmuxMock.execute(command, args ?? [])
  })
}
