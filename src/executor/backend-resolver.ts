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
  if (cliFlag !== undefined) {
    if (!KNOWN_BACKENDS.includes(cliFlag)) {
      throw new Error(`Unknown backend "${cliFlag}"`)
    }
    return cliFlag
  }

  if (presetBackend !== undefined) {
    if (!KNOWN_BACKENDS.includes(presetBackend)) {
      throw new Error(`Unknown backend "${presetBackend}"`)
    }
    return presetBackend
  }

  if (typeof env.TMUX === "string" && env.TMUX.trim().length > 0) {
    return "tmux"
  }

  return "tmux"
}
