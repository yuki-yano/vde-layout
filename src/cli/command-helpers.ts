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
