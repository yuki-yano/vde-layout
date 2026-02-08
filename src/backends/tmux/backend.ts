import { createTmuxExecutor } from "./executor"
import type { CommandStep, PlanEmission } from "../../core/emitter"
import { executePlan } from "../../executor/plan-runner"
import {
  resolveSplitOrientation as resolveSplitOrientationFromStep,
  resolveSplitPercentage as resolveSplitPercentageFromStep,
} from "../../executor/split-step"
import { resolveRequiredStepTargetPaneId } from "../../executor/step-target"
import { createUnsupportedStepKindError } from "../../executor/unsupported-step-kind"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  TmuxTerminalBackendContext,
} from "../../executor/terminal-backend"

export const createTmuxBackend = (context: TmuxTerminalBackendContext): TerminalBackend => {
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
    const target = resolveRequiredStepTargetPaneId(step)
    const direction = resolveSplitOrientationFromStep(step) === "horizontal" ? "-h" : "-v"
    const percent = resolveSplitPercentageFromStep(step)
    return ["split-window", direction, "-t", target, "-p", percent]
  }

  if (step.kind === "focus") {
    const target = resolveRequiredStepTargetPaneId(step)
    return ["select-pane", "-t", target]
  }

  throw createUnsupportedStepKindError(step)
}
