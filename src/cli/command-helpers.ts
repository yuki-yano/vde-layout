import chalk from "chalk"

import type { WindowMode } from "../models/types"
import type { DryRunStep } from "../executor/terminal-backend"

export const renderDryRun = (
  steps: ReadonlyArray<DryRunStep>,
  output: (message: string) => void = (message): void => console.log(message),
): void => {
  output(chalk.bold("\nPlanned terminal steps (dry-run)"))
  steps.forEach((step, index) => {
    output(` ${index + 1}. [${step.backend}] ${step.summary}: ${step.command}`)
  })
}

export const renderDryRunHook = (
  afterApply: string | undefined,
  output: (message: string) => void = (message): void => console.log(message),
): void => {
  if (typeof afterApply !== "string" || afterApply.length === 0) {
    return
  }

  // Dry-run has not created any panes, so pane ids aren't known yet; show the raw,
  // unresolved hook command rather than attempting template token resolution.
  output(chalk.bold("\nPlanned hooks (dry-run)"))
  output(` 1. [afterApply] ${afterApply}`)
}

export const buildPresetSource = (presetName?: string): string => {
  return typeof presetName === "string" && presetName.length > 0 ? `preset://${presetName}` : "preset://default"
}

export const determineCliWindowMode = (options: {
  currentWindow?: boolean
  newWindow?: boolean
}): WindowMode | undefined => {
  if (options.currentWindow === true && options.newWindow === true) {
    throw new Error("Cannot use --current-window and --new-window at the same time")
  }

  if (options.currentWindow === true) {
    return "current-window"
  }

  if (options.newWindow === true) {
    return "new-window"
  }

  return undefined
}
