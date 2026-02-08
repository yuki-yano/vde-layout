import type { TerminalBackend, TerminalBackendContext, TerminalBackendKind } from "./terminal-backend"
import { createTmuxBackend } from "./backends/tmux-backend"
import { createWeztermBackend } from "./backends/wezterm-backend"

export const createTerminalBackend = (kind: TerminalBackendKind, context: TerminalBackendContext): TerminalBackend => {
  if (kind === "tmux") {
    return createTmuxBackend(context)
  }

  if (kind === "wezterm") {
    return createWeztermBackend(context)
  }

  throw new Error(`Unsupported backend "${kind}"`)
}
