import type { PlanEmission } from "../core/emitter"
import type { WindowMode } from "../models/types"
import type { CommandExecutor } from "../contracts"
import type { Logger } from "../utils/logger"
import type { ConfirmPaneClosure } from "../contracts"

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

type TerminalBackendBaseContext = {
  readonly logger: Logger
  readonly dryRun: boolean
  readonly verbose: boolean
  readonly prompt?: ConfirmPaneClosure
  readonly cwd: string
  readonly paneId?: string
}

export type TmuxTerminalBackendContext = TerminalBackendBaseContext & {
  readonly executor: CommandExecutor
}

export type WeztermTerminalBackendContext = TerminalBackendBaseContext

export type TerminalBackendContext = TmuxTerminalBackendContext | WeztermTerminalBackendContext
