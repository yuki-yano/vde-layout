import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import type { ConfirmPaneClosure, ConfirmPaneClosureContext } from "../types/confirm-pane.ts"
import type { Logger } from "../utils/logger.ts"

export const createPaneKillPrompter = (logger: Logger): ConfirmPaneClosure => {
  return async ({ panesToClose, dryRun }: ConfirmPaneClosureContext): Promise<boolean> => {
    if (panesToClose.length === 0) {
      return true
    }

    const paneList = panesToClose.join(", ")

    if (dryRun) {
      logger.warn(`[DRY RUN] Would close panes: ${paneList}`)
      return true
    }

    logger.warn(`This operation will close the following panes: ${paneList}`)

    if (input.isTTY !== true || output.isTTY !== true) {
      logger.error("Cannot prompt for confirmation because the terminal is not interactive")
      return false
    }

    const rl = createInterface({ input, output })
    try {
      const answer = await rl.question("Continue? [y/N]: ")
      const normalized = answer.trim().toLowerCase()
      return normalized === "y" || normalized === "yes"
    } finally {
      rl.close()
    }
  }
}
