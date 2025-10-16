import type { PlanEmission } from "../core/emitter.ts"
import type { WindowMode } from "../models/types.ts"
import type { CommandExecutor } from "../types/command-executor.ts"
import type { Logger } from "../utils/logger.ts"
import type { ConfirmPaneClosure } from "../types/confirm-pane.ts"

export type TerminalBackendKind = "tmux" | "wezterm"

export type ApplyPlanParameters = {
  readonly emission: PlanEmission
  readonly windowMode: WindowMode
  readonly windowName?: string
}

export type ApplyPlanResult = {
  readonly executedSteps: number
  readonly focusPaneId?: string
}

export type DryRunStep = {
  readonly backend: TerminalBackendKind
  readonly summary: string
  readonly command: string
}

export type TerminalBackend = {
  readonly verifyEnvironment: () => Promise<void>
  readonly applyPlan: (parameters: ApplyPlanParameters) => Promise<ApplyPlanResult>
  readonly getDryRunSteps: (emission: PlanEmission) => DryRunStep[]
}

export type TerminalBackendContext = {
  readonly executor: CommandExecutor
  readonly logger: Logger
  readonly dryRun: boolean
  readonly verbose: boolean
  readonly prompt?: ConfirmPaneClosure
  readonly cwd: string
  readonly paneId?: string
}
