export type TmuxExecutorContract = {
  readonly verifyTmuxEnvironment: () => Promise<void>
  readonly execute: (command: string | string[]) => Promise<string>
  readonly executeMany: (commands: string[][]) => Promise<void>
  readonly getCurrentSessionName: () => Promise<string>
  readonly isInTmuxSession: () => boolean
  readonly getCommandString: (args: string[]) => string
}

export type TmuxCommandGeneratorContract = {
  readonly newWindow: (name?: string) => string[]
  readonly splitWindow: (direction: "horizontal" | "vertical", targetPane?: string, percentage?: number) => string[]
  readonly resizePane: (paneId: string, direction: "horizontal" | "vertical", percentage: number) => string[]
  readonly sendKeys: (paneId: string, command: string) => string[]
  readonly selectPane: (paneId: string) => string[]
  readonly setPaneTitle: (paneId: string, title: string) => string[]
  readonly setPaneOption: (paneId: string, option: string, value: string) => string[]
  readonly changeDirectory: (paneId: string, directory: string) => string[]
  readonly setEnvironment: (paneId: string, env: Record<string, string>) => string[][]
  readonly killAllPanes: () => string[]
}
