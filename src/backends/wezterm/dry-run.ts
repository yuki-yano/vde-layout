import type { PlanEmission } from "../../core/emitter"
import { createCoreError } from "../../core/errors"
import { resolveSplitOrientation, resolveSplitPercentage } from "../../executor/split-step"
import { prepareTerminalCommands } from "../../executor/terminal-command-preparation"
import type { DryRunStep } from "../../executor/terminal-backend"
import { ErrorCodes } from "../../utils/errors"

const SINGLE_QUOTE = "'"
const SHELL_SINGLE_QUOTE_ESCAPE = `'"'"'`

export const buildSplitArguments = (params: {
  readonly targetPaneId: string
  readonly percent: string
  readonly horizontal: boolean
}): string[] => {
  const directionFlag = params.horizontal ? "--right" : "--bottom"
  return ["split-pane", directionFlag, "--percent", params.percent, "--pane-id", params.targetPaneId]
}

export const buildDryRunSteps = (emission: PlanEmission): DryRunStep[] => {
  const steps: DryRunStep[] = []

  for (const step of emission.steps) {
    if (step.kind === "split") {
      const target = step.targetPaneId ?? "<unknown>"
      const args = buildSplitArguments({
        targetPaneId: target,
        percent: resolveSplitPercentage(step),
        horizontal: resolveSplitOrientation(step) === "horizontal",
      })
      steps.push({
        backend: "wezterm",
        summary: step.summary,
        command: `wezterm cli ${args.join(" ")}`,
      })
      continue
    }

    if (step.kind === "focus") {
      const target = step.targetPaneId ?? "<unknown>"
      steps.push({
        backend: "wezterm",
        summary: step.summary,
        command: `wezterm cli activate-pane --pane-id ${target}`,
      })
      continue
    }

    throw createCoreError("execution", {
      code: ErrorCodes.INVALID_PLAN,
      message: `Unsupported step kind in emission: ${String((step as { kind?: unknown }).kind)}`,
      path: step.id,
    })
  }

  const prepared = prepareTerminalCommands({
    terminals: emission.terminals,
    focusPaneVirtualId: emission.summary.focusPaneId,
    resolveRealPaneId: (virtualPaneId: string): string => virtualPaneId,
    onTemplateTokenError: ({ terminal, error }): never => {
      throw createCoreError("execution", {
        code: "TEMPLATE_TOKEN_ERROR",
        message: `Template token resolution failed for pane ${terminal.virtualPaneId}: ${error.message}`,
        path: terminal.virtualPaneId,
        details: {
          command: terminal.command,
          tokenType: error.tokenType,
          availablePanes: error.availablePanes,
        },
      })
    },
  })

  const quoteForShellDisplay = (value: string): string => {
    return `${SINGLE_QUOTE}${value.split(SINGLE_QUOTE).join(SHELL_SINGLE_QUOTE_ESCAPE)}${SINGLE_QUOTE}`
  }

  for (const commandSet of prepared.commands) {
    const paneId = commandSet.terminal.virtualPaneId
    if (typeof commandSet.cwdCommand === "string") {
      steps.push({
        backend: "wezterm",
        summary: `set cwd for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- ${quoteForShellDisplay(commandSet.cwdCommand)}`,
      })
    }

    for (const envEntry of commandSet.envCommands) {
      steps.push({
        backend: "wezterm",
        summary: `set env ${envEntry.key} for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- ${quoteForShellDisplay(envEntry.command)}`,
      })
    }

    if (commandSet.command !== undefined) {
      steps.push({
        backend: "wezterm",
        summary: `run command for ${paneId}`,
        command: `wezterm cli send-text --pane-id ${paneId} --no-paste -- ${quoteForShellDisplay(commandSet.command.text)}`,
      })
    }
  }

  return steps
}
