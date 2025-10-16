import { createTmuxExecutor } from "../../tmux/executor.ts"
import type { PlanEmission } from "../../core/emitter.ts"
import { executePlan } from "../plan-runner.ts"
import type {
  ApplyPlanParameters,
  ApplyPlanResult,
  DryRunStep,
  TerminalBackend,
  TerminalBackendContext,
} from "../terminal-backend.ts"

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
      command: tmuxExecutor.getCommandString([...step.command]),
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
