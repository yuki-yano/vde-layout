import { z } from "zod"
import { ConfigSchema, PresetSchema, LayoutSchema, PaneSchema } from "./schema"

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
export function isSplitPane(pane: Pane): pane is SplitPane {
  return "type" in pane && "panes" in pane && "ratio" in pane
}

export function isTerminalPane(pane: Pane): pane is TerminalPane {
  return "name" in pane && !("panes" in pane)
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
