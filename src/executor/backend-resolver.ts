import type { TerminalBackendKind } from "./terminal-backend.ts"

type ResolveBackendOptions = {
  readonly cliFlag?: TerminalBackendKind
  readonly presetBackend?: TerminalBackendKind
  readonly env: NodeJS.ProcessEnv
}

const KNOWN_BACKENDS: TerminalBackendKind[] = ["tmux", "wezterm"]

export const resolveTerminalBackendKind = ({
  cliFlag,
  presetBackend,
  env,
}: ResolveBackendOptions): TerminalBackendKind => {
  const selectedBackend = cliFlag ?? presetBackend
  if (selectedBackend !== undefined) {
    if (!KNOWN_BACKENDS.includes(selectedBackend)) {
      throw new Error(`Unknown backend "${selectedBackend}"`)
    }
    return selectedBackend
  }

  if (typeof env.TMUX === "string" && env.TMUX.trim().length > 0) {
    return "tmux"
  }

  return "tmux"
}
