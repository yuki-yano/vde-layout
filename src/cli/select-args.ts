export const selectUiModes = ["auto", "fzf"] as const
export const selectSurfaceModes = ["auto", "inline", "tmux-popup"] as const

export type SelectUiMode = (typeof selectUiModes)[number]
export type SelectSurfaceMode = (typeof selectSurfaceModes)[number]

const selectUiModeSet = new Set<string>(selectUiModes)
const selectSurfaceModeSet = new Set<string>(selectSurfaceModes)

const isSelectUiMode = (value: string): value is SelectUiMode => {
  return selectUiModeSet.has(value)
}

const isSelectSurfaceMode = (value: string): value is SelectSurfaceMode => {
  return selectSurfaceModeSet.has(value)
}

export const normalizeSelectArgs = (args: readonly string[]): string[] => {
  const normalized: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (typeof token !== "string") {
      continue
    }

    if (token === "--") {
      normalized.push(...args.slice(index))
      break
    }

    if (typeof token === "string" && token.startsWith("--select=")) {
      const mode = token.slice("--select=".length)
      normalized.push("--select")
      if (mode.length > 0) {
        normalized.push("--select-ui", mode)
      }
      continue
    }

    if (token === "--select") {
      const nextToken = args[index + 1]
      if (typeof nextToken === "string" && isSelectUiMode(nextToken)) {
        normalized.push("--select", "--select-ui", nextToken)
        index += 1
        continue
      }
    }

    normalized.push(token)
  }

  return normalized
}

export const resolveSelectUiMode = (uiValue: string | undefined): SelectUiMode => {
  if (uiValue === undefined) {
    return "auto"
  }

  if (isSelectUiMode(uiValue)) {
    return uiValue
  }

  throw new Error(`Invalid value for --select-ui: "${uiValue}". Expected one of: ${selectUiModes.join(", ")}`)
}

export const resolveSelectSurfaceMode = (surfaceValue: string | undefined): SelectSurfaceMode => {
  if (surfaceValue === undefined) {
    return "auto"
  }

  if (isSelectSurfaceMode(surfaceValue)) {
    return surfaceValue
  }

  throw new Error(
    `Invalid value for --select-surface: "${surfaceValue}". Expected one of: ${selectSurfaceModes.join(", ")}`,
  )
}
