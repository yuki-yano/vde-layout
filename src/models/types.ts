import { z } from "zod"
import { ConfigSchema, PresetSchema, LayoutSchema, PaneSchema } from "./schema.ts"

// Generate types from Zod schemas
export type Config = z.infer<typeof ConfigSchema>
export type Preset = z.infer<typeof PresetSchema>
export type Layout = z.infer<typeof LayoutSchema>
export type Pane = z.infer<typeof PaneSchema>

// Define SplitPane and TerminalPane types based on the union
export type SplitPane = Pane & {
  type: "horizontal" | "vertical"
  ratio: number[]
  panes: Pane[]
}

export type TerminalPane = Pane & {
  name: string
  command?: string
  cwd?: string
  env?: Record<string, string>
  delay?: number
  title?: string
  focus?: boolean
}

// Utility type guards using runtime checks
export function isSplitPane(pane: unknown): pane is SplitPane {
  if (typeof pane !== "object" || pane === null) {
    return false
  }
  const record = pane as Record<string, unknown>
  const orientation = record.type
  if (orientation !== "horizontal" && orientation !== "vertical") {
    return false
  }
  if (!Array.isArray(record.panes) || !Array.isArray(record.ratio)) {
    return false
  }
  return true
}

export function isTerminalPane(pane: unknown): pane is TerminalPane {
  if (typeof pane !== "object" || pane === null) {
    return false
  }
  const record = pane as Record<string, unknown>
  return typeof record.name === "string" && !Array.isArray(record.panes)
}

// Type definition for CLI options
export interface CLIOptions {
  preset?: string
  list?: boolean
  dryRun?: boolean
  verbose?: boolean
}

// Type definition for preset information (for list display)
export interface PresetInfo {
  key: string
  name: string
  description?: string
}
