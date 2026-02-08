import { createTmuxExecutor } from "../../tmux/executor.ts"
import type { CommandStep, PlanEmission } from "../../core/emitter.ts"
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
    const direction = resolveSplitOrientation(step) === "horizontal" ? "-h" : "-v"
    const percent = resolveSplitPercentage(step)
    return ["split-window", direction, "-t", target, "-p", percent]
  }

  if (step.kind === "focus") {
    const target = resolveTargetPaneId(step)
    return ["select-pane", "-t", target]
  }

  return [...step.command]
}

const resolveTargetPaneId = (step: CommandStep): string => {
  if (typeof step.targetPaneId === "string" && step.targetPaneId.length > 0) {
    return step.targetPaneId
  }

  const targetIndex = step.command.findIndex((segment) => segment === "-t")
  if (targetIndex >= 0 && targetIndex + 1 < step.command.length) {
    const raw = step.command[targetIndex + 1]
    if (typeof raw === "string" && raw.length > 0) {
      return raw
    }
  }

  return "<unknown>"
}

const resolveSplitOrientation = (step: CommandStep): "horizontal" | "vertical" => {
  if (step.kind === "split" && (step.orientation === "horizontal" || step.orientation === "vertical")) {
    return step.orientation
  }

  return step.command.includes("-v") ? "vertical" : "horizontal"
}

const resolveSplitPercentage = (step: CommandStep): string => {
  if (step.kind === "split" && typeof step.percentage === "number" && Number.isFinite(step.percentage)) {
    return String(clampPercentage(step.percentage))
  }

  const percentIndex = step.command.findIndex((segment) => segment === "-p")
  if (percentIndex >= 0 && percentIndex + 1 < step.command.length) {
    const raw = step.command[percentIndex + 1]
    if (typeof raw === "string" && raw.trim().length > 0) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) {
        return String(clampPercentage(parsed))
      }
    }
  }

  return "50"
}

const clampPercentage = (value: number): number => {
  return Math.min(99, Math.max(1, Math.round(value)))
}
