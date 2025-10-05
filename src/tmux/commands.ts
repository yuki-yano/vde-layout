import type { TmuxCommandGeneratorContract } from "../types/tmux.ts"

const DOUBLE_QUOTE = '"'
const ESCAPED_DOUBLE_QUOTE = '\\"'

export const createTmuxCommandGenerator = (): TmuxCommandGeneratorContract => {
  const splitWindow = (direction: "horizontal" | "vertical", targetPane?: string, percentage?: number): string[] => {
    const args = ["split-window"]
    args.push(direction === "horizontal" ? "-h" : "-v")
    if (targetPane !== undefined) {
      args.push("-t", targetPane)
    }
    if (percentage !== undefined) {
      args.push("-p", percentage.toString())
    }
    return args
  }

  const resizePane = (paneId: string, direction: "horizontal" | "vertical", percentage: number): string[] => {
    const size = Math.floor(percentage)
    return ["resize-pane", "-t", paneId, direction === "horizontal" ? "-x" : "-y", `${size}%`]
  }

  const sendKeys = (paneId: string, command: string): string[] => {
    return ["send-keys", "-t", paneId, command, "Enter"]
  }

  const selectPane = (paneId: string): string[] => {
    return ["select-pane", "-t", paneId]
  }

  const setPaneTitle = (paneId: string, title: string): string[] => {
    return ["select-pane", "-t", paneId, "-T", title]
  }

  const changeDirectory = (paneId: string, directory: string): string[] => {
    const escapedDirectory = directory.split(DOUBLE_QUOTE).join(ESCAPED_DOUBLE_QUOTE)
    return sendKeys(paneId, `cd "${escapedDirectory}"`)
  }

  const setPaneOption = (paneId: string, option: string, value: string): string[] => {
    return ["set-option", "-p", "-t", paneId, option, value]
  }

  const setEnvironment = (paneId: string, env: Record<string, string>): string[][] => {
    return Object.entries(env).map(([key, value]) => {
      const escapedValue = value.split(DOUBLE_QUOTE).join(ESCAPED_DOUBLE_QUOTE)
      return sendKeys(paneId, `export ${key}="${escapedValue}"`)
    })
  }

  const newWindow = (windowName?: string, workingDirectory?: string): string[] => {
    const args = ["new-window"]
    if (typeof windowName === "string" && windowName.length > 0) {
      args.push("-n", windowName)
    }
    if (typeof workingDirectory === "string" && workingDirectory.length > 0) {
      args.push("-c", workingDirectory)
    }
    return args
  }

  const killAllPanes = (): string[] => {
    return ["kill-pane", "-a"]
  }

  return {
    newWindow,
    splitWindow,
    sendKeys,
    selectPane,
    setPaneTitle,
    setPaneOption,
    changeDirectory,
    setEnvironment,
    resizePane,
    killAllPanes,
  }
}
