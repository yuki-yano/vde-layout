import { TmuxExecutor, type TmuxExecutorOptions } from "../tmux/executor"
import { TmuxCommandGenerator } from "../tmux/commands"
import type { Preset, Layout, Pane, TerminalPane } from "../models/types"
import { normalizeRatio } from "../utils/ratio"
import type { ILayoutEngine, ITmuxExecutor, ITmuxCommandGenerator, ICommandExecutor } from "../interfaces"

export interface LayoutEngineOptions extends Omit<TmuxExecutorOptions, "executor"> {
  executor?: ITmuxExecutor | ICommandExecutor
  commandGenerator?: ITmuxCommandGenerator
}

interface PaneInfo {
  pane: Pane
  paneId: string
  parentPaneId?: string
}

/**
 * Layout Engine
 * Creates tmux pane layouts based on preset definitions
 */
export class LayoutEngine implements ILayoutEngine {
  private readonly executor: ITmuxExecutor
  private readonly commandGenerator: ITmuxCommandGenerator

  constructor(options: LayoutEngineOptions = {}) {
    // If the provided executor implements ITmuxExecutor, use it directly
    if (options.executor && "verifyTmuxEnvironment" in options.executor) {
      this.executor = options.executor as ITmuxExecutor
    } else if (options.executor) {
      // If it's just ICommandExecutor, wrap it in TmuxExecutor
      const executorOptions: TmuxExecutorOptions = {
        verbose: options.verbose,
        dryRun: options.dryRun,
        executor: options.executor as ICommandExecutor,
      }
      this.executor = new TmuxExecutor(executorOptions)
    } else {
      // No executor provided, create a new TmuxExecutor
      const executorOptions: TmuxExecutorOptions = {
        verbose: options.verbose,
        dryRun: options.dryRun,
      }
      this.executor = new TmuxExecutor(executorOptions)
    }
    this.commandGenerator = options.commandGenerator || new TmuxCommandGenerator()
  }

  /**
   * Creates layout based on preset
   * @param preset - Preset to create
   */
  async createLayout(preset: Preset): Promise<void> {
    // Verify tmux environment
    await this.executor.verifyTmuxEnvironment()

    // Create new window
    const windowName = preset.name || "vde-layout"
    await this.executor.execute(this.commandGenerator.newWindow(windowName))

    // Get actual pane ID of the new window
    const initialPaneId = await this.getCurrentPaneId()

    // Create panes based on layout or command
    let paneInfos: PaneInfo[]

    if (preset.layout) {
      // When layout is defined
      paneInfos = await this.createLayoutRecursive(preset.layout, initialPaneId)
    } else {
      // Process as single pane when layout is not defined
      const terminalPane: TerminalPane = {
        name: preset.name,
        command: preset.command, // Default shell when undefined
      }
      paneInfos = [
        {
          pane: terminalPane,
          paneId: initialPaneId,
        },
      ]
    }

    // Apply pane options
    for (const paneInfo of paneInfos) {
      await this.applyPaneOptions(paneInfo)
    }

    // Set focus
    const focusedPane = paneInfos.find((info) => {
      const terminalPane = info.pane as TerminalPane
      return terminalPane.focus === true
    })

    if (focusedPane !== undefined) {
      await this.executor.execute(this.commandGenerator.selectPane(focusedPane.paneId))
    }
  }

  /**
   * Creates layout recursively
   * @param layout - Layout definition
   * @param parentPaneId - Parent pane ID
   * @param isFirst - Whether this is the first pane
   * @returns Array of created pane information
   */
  private async createLayoutRecursive(
    layout: Layout | Pane,
    parentPaneId: string,
    _isFirst = true,
  ): Promise<PaneInfo[]> {
    // Type guard to check if layout is a Layout type
    const isLayout = (l: Layout | Pane): l is Layout => {
      return (
        typeof l === "object" &&
        l !== null &&
        "type" in l &&
        "panes" in l &&
        "ratio" in l &&
        (l.type === "horizontal" || l.type === "vertical")
      )
    }

    // For terminal pane
    if (!isLayout(layout)) {
      return [
        {
          pane: layout,
          paneId: parentPaneId,
        },
      ]
    }

    // For layout (split pane)
    const paneInfos: PaneInfo[] = []
    const currentPaneId = parentPaneId
    let paneIndex = 0
    if (parentPaneId && parentPaneId.startsWith("%")) {
      paneIndex = parseInt(parentPaneId.slice(1), 10) || 0
    }

    // Normalize ratio array
    const normalizedRatio = normalizeRatio(layout.ratio ?? [])

    // Execute splits one by one and record actual pane IDs
    const paneIds: string[] = [parentPaneId] // First pane is the original ID

    for (let i = 1; i < layout.panes.length; i++) {
      let percentage: number
      if (i === 1) {
        // First split: calculate ratio for all remaining panes
        const firstPaneRatio = normalizedRatio[0]!
        const totalRatio = normalizedRatio.reduce((sum, r) => sum + r, 0)
        const remainingRatiosSum = totalRatio - firstPaneRatio
        percentage = Math.round((remainingRatiosSum / totalRatio) * 100)
      } else {
        // Subsequent splits: calculate ratio for new pane within current space
        const currentSpaceRatios = normalizedRatio.slice(i - 1)
        const currentSpaceTotal = currentSpaceRatios.reduce((sum, r) => sum + r, 0)
        const newPaneRatios = normalizedRatio.slice(i)
        const newPaneTotal = newPaneRatios.reduce((sum, r) => sum + r, 0)
        percentage = Math.round((newPaneTotal / currentSpaceTotal) * 100)
      }

      // Get pane ID list before split
      const beforePaneIds = await this.getAllPaneIds()

      // For second and subsequent splits, split the previously created pane
      const targetPaneId = i === 1 ? currentPaneId : paneIds[paneIds.length - 1]!

      await this.executor.execute(this.commandGenerator.splitWindow(layout.type, targetPaneId, percentage))

      // Get pane ID list after split
      const afterPaneIds = await this.getAllPaneIds()

      // Identify newly created pane ID
      const newPaneId = afterPaneIds.find((id) => !beforePaneIds.includes(id))
      if (newPaneId === undefined) {
        // Generate counter-based ID if new pane ID is not found
        const fallbackPaneId = `%${paneIndex + i}`
        paneIds.push(fallbackPaneId)
      } else {
        paneIds.push(newPaneId)
      }

      paneIndex++
    }

    for (let i = 0; i < layout.panes.length; i++) {
      const pane = layout.panes[i]!
      const paneId = paneIds[i]!

      // Create child panes recursively
      const childPaneInfos = await this.createLayoutRecursive(pane, paneId, false)

      // Track number of panes used in child panes
      for (const childInfo of childPaneInfos) {
        if (childInfo.paneId && childInfo.paneId.startsWith("%")) {
          const childIndex = parseInt(childInfo.paneId.slice(1), 10)
          if (!isNaN(childIndex) && childIndex > paneIndex) {
            paneIndex = childIndex
          }
        }
      }

      paneInfos.push(...childPaneInfos)
    }

    return paneInfos
  }

  /**
   * Apply pane options
   * @param paneInfo - Pane information
   */
  private async applyPaneOptions(paneInfo: PaneInfo): Promise<void> {
    const pane = paneInfo.pane as TerminalPane
    const paneId = paneInfo.paneId

    // Change working directory
    if (pane.cwd !== undefined) {
      await this.executor.execute(this.commandGenerator.changeDirectory(paneId, pane.cwd))
    }

    // Set environment variables
    if (pane.env !== undefined) {
      const envCommands = this.commandGenerator.setEnvironment(paneId, pane.env)
      for (const command of envCommands) {
        await this.executor.execute(command)
      }
    }

    // Set pane title
    if (pane.name !== undefined) {
      await this.executor.execute(this.commandGenerator.setPaneTitle(paneId, pane.name))
    }

    // Delay processing
    if (pane.delay !== undefined && pane.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, pane.delay))
    }

    // Execute command
    if (pane.command !== undefined) {
      await this.executor.execute(this.commandGenerator.sendKeys(paneId, pane.command))
    }
  }

  /**
   * Get current active pane ID
   * @returns Current pane ID
   */
  private async getCurrentPaneId(): Promise<string> {
    const result = await this.executor.execute(["display-message", "-p", "#{pane_id}"])
    // Return temporary pane ID in dry-run mode or when result is invalid
    if (!result || typeof result !== "string") {
      return "%0"
    }
    return result.trim() || "%0"
  }

  /**
   * Get all pane IDs in current window
   */
  private async getAllPaneIds(): Promise<string[]> {
    const result = await this.executor.execute(["list-panes", "-F", "#{pane_id}"])
    if (!result || typeof result !== "string") {
      return ["%0"] // Default pane ID
    }
    return result
      .trim()
      .split("\n")
      .filter((id) => id.trim() !== "")
  }
}
