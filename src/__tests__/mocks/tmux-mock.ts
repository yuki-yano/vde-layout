import { vi } from "vitest"
import type { Result } from "execa"

interface TmuxMockCommand {
  command: string
  args: string[]
  response: string | Error
  exitCode?: number
}

export class TmuxMock {
  private commands: TmuxMockCommand[] = []
  private defaultResponse = ""
  private isInsideTmux = true

  setIsInsideTmux(value: boolean): void {
    this.isInsideTmux = value
  }

  addCommand(command: string, args: string[], response: string | Error, exitCode = 0): void {
    this.commands.push({ command, args, response, exitCode })
  }

  setDefaultResponse(response: string): void {
    this.defaultResponse = response
  }

  async execute(command: string, args: string[] = []): Promise<Result> {
    // tmux environment check
    if (command === "tmux" && args[0] === "info" && !this.isInsideTmux) {
      throw new Error("sessions should be nested with care, unset $TMUX to force")
    }

    // Search for registered command
    const mockCommand = this.commands.find(
      (cmd) => cmd.command === command && JSON.stringify(cmd.args) === JSON.stringify(args),
    )

    if (mockCommand) {
      if (mockCommand.response instanceof Error) {
        throw mockCommand.response
      }
      return this.createExecaResult(mockCommand.response, mockCommand.exitCode ?? 0)
    }

    // Default response
    return this.createExecaResult(this.defaultResponse, 0)
  }

  private createExecaResult(stdout: string, exitCode: number): Result {
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

  reset(): void {
    this.commands = []
    this.defaultResponse = ""
    this.isInsideTmux = true
  }
}

// Global mock instance
export const tmuxMock = new TmuxMock()

// execa mock
export const mockExeca = (): ReturnType<typeof vi.fn> => {
  return vi.fn().mockImplementation(async (command: string, args?: string[]) => {
    return tmuxMock.execute(command, args || [])
  })
}
