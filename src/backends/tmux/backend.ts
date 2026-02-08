import { createTmuxExecutor } from "./executor.ts"
import type { CommandStep, PlanEmission } from "../../core/emitter.ts"
import { executePlan } from "../../executor/plan-runner.ts"
import {
  resolveSplitOrientation as resolveSplitOrientationFromStep,
  resolveSplitPercentage as resolveSplitPercentageFromStep,
} from "../../executor/split-step.ts"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  TerminalBackendContext,
} from "../../executor/terminal-backend.ts"

export const createTmuxBackend = (context: TerminalBackendContext): TerminalBackend => {
  const tmuxExecutor = createTmuxExecutor({
    executor: context.executor,
    verbose: context.verbose,
    dryRun: context.dryRun,
  })

  const buildDryRunSteps = (emission: PlanEmission): DryRunStep[] => {
    return emission.steps.map((step) => ({
      backend: "tmux" as const,
      summary: step.summary,
      command: tmuxExecutor.getCommandString(buildTmuxCommand(step)),
    }))
  }

  const verifyEnvironment = async (): Promise<void> => {
    if (context.dryRun) {
      return
    }
    await tmuxExecutor.verifyTmuxEnvironment()
  }

  const applyPlan = async ({ emission, windowMode, windowName }: ApplyPlanParameters): Promise<ApplyPlanResult> => {
    const executionResult = await executePlan({
      emission,
      executor: tmuxExecutor.getExecutor(),
      windowMode,
      windowName,
      onConfirmKill: context.prompt,
    })

    return {
      executedSteps: executionResult.executedSteps,
      focusPaneId: emission.summary.focusPaneId,
    }
  }

  return {
    verifyEnvironment,
    applyPlan,
    getDryRunSteps: buildDryRunSteps,
  }
}

const buildTmuxCommand = (step: CommandStep): string[] => {
  if (step.kind === "split") {
    const target = resolveTargetPaneId(step)
    const direction = resolveSplitOrientationFromStep(step) === "horizontal" ? "-h" : "-v"
    const percent = resolveSplitPercentageFromStep(step)
    return ["split-window", direction, "-t", target, "-p", percent]
  }

  if (step.kind === "focus") {
    const target = resolveTargetPaneId(step)
    return ["select-pane", "-t", target]
  }

  return [...(step.command ?? [])]
}

const resolveTargetPaneId = (step: CommandStep): string => {
  if (typeof step.targetPaneId === "string" && step.targetPaneId.length > 0) {
    return step.targetPaneId
  }

  const command = step.command ?? []
  const targetIndex = command.findIndex((segment) => segment === "-t")
  if (targetIndex >= 0 && targetIndex + 1 < command.length) {
    const raw = command[targetIndex + 1]
    if (typeof raw === "string" && raw.length > 0) {
      return raw
    }
  }

  return "<unknown>"
}
