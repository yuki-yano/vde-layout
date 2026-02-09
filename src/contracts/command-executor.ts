export type CommandExecutor = {
  readonly execute: (command: string | string[]) => Promise<string>
  readonly executeMany: (commands: string[][]) => Promise<void>
  readonly isDryRun: () => boolean
  readonly logCommand: (command: string) => void
}
