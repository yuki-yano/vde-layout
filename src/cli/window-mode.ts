import type { WindowMode } from "../models/types.ts"

export type WindowModeSource = {
  readonly cli?: WindowMode
  readonly preset?: WindowMode
  readonly defaults?: WindowMode
}

export type WindowModeResolutionSource = "cli" | "preset" | "defaults" | "fallback"

export type WindowModeResolution = {
  readonly mode: WindowMode
  readonly source: WindowModeResolutionSource
}

export const resolveWindowMode = ({ cli, preset, defaults }: WindowModeSource): WindowModeResolution => {
  if (cli !== undefined) {
    return { mode: cli, source: "cli" }
  }

  if (preset !== undefined) {
    return { mode: preset, source: "preset" }
  }

  if (defaults !== undefined) {
    return { mode: defaults, source: "defaults" }
  }

  return { mode: "new-window", source: "fallback" }
}
