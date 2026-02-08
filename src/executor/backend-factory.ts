import type {
  TerminalBackend,
  TerminalBackendContext,
  TerminalBackendKind,
  TmuxTerminalBackendContext,
  WeztermTerminalBackendContext,
} from "./terminal-backend"
import { createTmuxBackend } from "../backends/tmux/backend"
import { createWeztermBackend } from "../backends/wezterm/backend"

export function createTerminalBackend(kind: "tmux", context: TmuxTerminalBackendContext): TerminalBackend
export function createTerminalBackend(kind: "wezterm", context: WeztermTerminalBackendContext): TerminalBackend
export function createTerminalBackend(kind: TerminalBackendKind, context: TerminalBackendContext): TerminalBackend {
  if (kind === "tmux") {
    if (!("executor" in context)) {
      throw new Error("tmux backend requires executor context")
    }
    return createTmuxBackend(context)
  }

  if (kind === "wezterm") {
    return createWeztermBackend(context)
  }

  throw new Error(`Unsupported backend "${kind}"`)
}
