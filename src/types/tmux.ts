export type TmuxExecutorContract = {
  readonly verifyTmuxEnvironment: () => Promise<void>
  readonly execute: (command: string | string[]) => Promise<string>
  readonly executeMany: (commands: string[][]) => Promise<void>
  readonly getCurrentSessionName: () => Promise<string>
  readonly isInTmuxSession: () => boolean
  readonly getCommandString: (args: string[]) => string
}
