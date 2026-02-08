import { z } from "zod"
import { ConfigSchema, PresetSchema, LayoutSchema, PaneSchema, WindowModeSchema } from "./schema"

// Public types inferred from Zod schemas
export type Config = z.infer<typeof ConfigSchema>
export type Preset = z.infer<typeof PresetSchema>
export type Layout = z.infer<typeof LayoutSchema>
export type Pane = z.infer<typeof PaneSchema>
export type WindowMode = z.infer<typeof WindowModeSchema>

// Display info for CLI listings
export type PresetInfo = {
  key: string
  name: string
  description?: string
}
