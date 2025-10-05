import type { ICommandExecutor } from "../interfaces/command-executor"
import type { PlanEmission, CommandStep, StructuredError } from "../functional-core"
import { ErrorCodes } from "../utils/errors"

export interface ExecutePlanInput {
  readonly emission: PlanEmission
  readonly executor: ICommandExecutor
}

export interface ExecutePlanSuccess {
  readonly executedSteps: number
}

export type ExecutePlanResult = { ok: true; value: ExecutePlanSuccess } | { ok: false; error: StructuredError }

export async function executePlan({ emission, executor }: ExecutePlanInput): Promise<ExecutePlanResult> {
  let executedSteps = 0

  for (const step of emission.steps) {
    try {
      await executor.execute([...step.command])
      executedSteps += 1
    } catch (error) {
      return {
        ok: false,
        error: toStructuredError(error, step),
      }
    }
  }

  return {
    ok: true,
    value: {
      executedSteps,
    },
  }
}

const toStructuredError = (error: unknown, step: CommandStep): StructuredError => {
  if (typeof error === "object" && error !== null && "code" in error && typeof (error as any).code === "string") {
    const known = error as { code: string; message: string; details?: Record<string, unknown> }
    return {
      code: known.code,
      message: known.message,
      path: step.id,
      details: {
        command: step.command,
        ...known.details,
      },
    }
  }

  return {
    code: ErrorCodes.TMUX_COMMAND_FAILED,
    message: error instanceof Error ? error.message : "Unknown tmux execution error",
    path: step.id,
    details: {
      command: step.command,
    },
  }
}
