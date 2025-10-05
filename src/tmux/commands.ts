import type { ITmuxCommandGenerator } from "../interfaces/index.ts"

/**
 * tmux command generator
 * Generates tmux commands necessary for layout creation
 */
export class TmuxCommandGenerator implements ITmuxCommandGenerator {
  /**
   * Generates command to split window
   * @param direction - Split direction (horizontal: horizontal, vertical: vertical)
   * @param targetPane - Target pane ID to split (current pane if omitted)
   * @param percentage - Size of new pane (percentage)
   * @returns Array of tmux command arguments
   */
  splitWindow(direction: "horizontal" | "vertical", targetPane?: string, percentage?: number): string[] {
    const args = ["split-window"]

    // Split direction
    args.push(direction === "horizontal" ? "-h" : "-v")

    // Target pane
    if (targetPane !== undefined) {
      args.push("-t", targetPane)
    }

    // Size specification
    if (percentage !== undefined) {
      args.push("-p", percentage.toString())
    }

    return args
  }

  /**
   * Generates command to resize pane
   * @param paneId - Pane ID
   * @param direction - Resize direction
   * @param percentage - Size (percentage)
   * @returns Array of tmux command arguments
   */
  resizePane(paneId: string, direction: "horizontal" | "vertical", percentage: number): string[] {
    const size = Math.floor(percentage)
    return ["resize-pane", "-t", paneId, direction === "horizontal" ? "-x" : "-y", `${size}%`]
  }

  /**
   * Generates command to send keys to pane
   * @param paneId - Pane ID
   * @param command - Command to execute
   * @returns Array of tmux command arguments
   */
  sendKeys(paneId: string, command: string): string[] {
    return ["send-keys", "-t", paneId, command, "Enter"]
  }

  /**
   * Generates command to select pane
   * @param paneId - Pane ID
   * @returns Array of tmux command arguments
   */
  selectPane(paneId: string): string[] {
    return ["select-pane", "-t", paneId]
  }

  /**
   * Generates command to set pane option
   * @param paneId - Pane ID
   * @param option - Option name
   * @param value - Option value
   * @returns Array of tmux command arguments
   */
  setPaneOption(paneId: string, option: string, value: string): string[] {
    return ["set-option", "-p", "-t", paneId, option, value]
  }

  /**
   * Generates commands to set environment variables
   * @param paneId - Pane ID
   * @param env - Environment variables object
   * @returns Array of arrays of tmux command arguments
   */
  setEnvironment(paneId: string, env: Record<string, string>): string[][] {
    const commands: string[][] = []

    for (const [key, value] of Object.entries(env)) {
      // Escape double quotes
      const escapedValue = value.replace(/"/g, '\\"')
      const exportCommand = `export ${key}="${escapedValue}"`
      commands.push(this.sendKeys(paneId, exportCommand))
    }

    return commands
  }

  /**
   * Generates command to set pane title
   * @param paneId - Pane ID
   * @param title - Pane title
   * @returns Array of tmux command arguments
   */
  setPaneTitle(paneId: string, title: string): string[] {
    return ["select-pane", "-t", paneId, "-T", title]
  }

  /**
   * Generates command to change working directory
   * @param paneId - Pane ID
   * @param directory - Directory path
   * @returns Array of tmux command arguments
   */
  changeDirectory(paneId: string, directory: string): string[] {
    return this.sendKeys(paneId, `cd "${directory}"`)
  }

  /**
   * Generates command to create new window
   * @param windowName - Window name (optional)
   * @param workingDirectory - Working directory (optional)
   * @returns Array of tmux command arguments
   */
  newWindow(windowName?: string, workingDirectory?: string): string[] {
    const args = ["new-window"]

    if (windowName !== undefined && windowName !== "") {
      args.push("-n", windowName)
    }

    if (workingDirectory !== undefined && workingDirectory !== "") {
      args.push("-c", workingDirectory)
    }

    return args
  }

  /**
   * Generates command to kill all panes in current window (except current pane)
   * @returns Array of tmux command arguments
   */
  killAllPanes(): string[] {
    // Kill other panes based on current active pane (current pane is the reference without -t option)
    return ["kill-pane", "-a"]
  }
}
