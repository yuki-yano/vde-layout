// Sidebar pane detection.
//
// vde-tmux-sidebar marks its own pane by setting the tmux pane user option
// `@vde_sidebar` to `1`. Verified against real tmux 3.7b that a single
// `list-panes -F "#{pane_id}\t#{@vde_sidebar}"` query expands both the pane
// id and the pane user option value in one call: panes with the option set
// return `1`, panes without it return an empty string. No per-pane
// `show-options -pqv -t <pane> @vde_sidebar` fallback is needed.
import type { CommandExecutor } from "../contracts"
import { executeCommand } from "./plan-runner-helpers"
import { ErrorCodes } from "../utils/errors"

export const SIDEBAR_LIST_PANES_FORMAT = "#{pane_id}\t#{@vde_sidebar}"

export type ClassifyWindowPanesResult = {
  readonly sidebarPanes: string[]
  readonly normalPanes: string[]
}

export const classifyWindowPanes = async (
  executor: CommandExecutor,
  contextPath: string,
  targetPaneId?: string,
): Promise<ClassifyWindowPanesResult> => {
  // `-t <pane-id>` scopes `list-panes` to the window that pane belongs to (tmux
  // resolves a pane id target to its containing window), so passing the current
  // pane id here guarantees the classification covers that pane's window even in
  // multi-window/multi-session setups where the "active" window might differ.
  const command =
    typeof targetPaneId === "string" && targetPaneId.length > 0
      ? ["list-panes", "-t", targetPaneId, "-F", SIDEBAR_LIST_PANES_FORMAT]
      : ["list-panes", "-F", SIDEBAR_LIST_PANES_FORMAT]

  const output = await executeCommand(executor, command, {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: "Failed to list tmux panes for sidebar detection",
    path: contextPath,
  })

  const sidebarPanes: string[] = []
  const normalPanes: string[] = []

  for (const line of output.split("\n")) {
    const [paneId, sidebarFlag] = line.split("\t")
    if (typeof paneId !== "string" || paneId.trim().length === 0) {
      continue
    }

    if (sidebarFlag?.trim() === "1") {
      sidebarPanes.push(paneId.trim())
    } else {
      normalPanes.push(paneId.trim())
    }
  }

  return { sidebarPanes, normalPanes }
}
