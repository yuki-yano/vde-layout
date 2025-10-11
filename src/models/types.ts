import { z } from "zod"
import { ConfigSchema, PresetSchema, LayoutSchema, PaneSchema, WindowModeSchema } from "./schema.ts"

// 型はZodスキーマから推論して公開
export type Config = z.infer<typeof ConfigSchema>
export type Preset = z.infer<typeof PresetSchema>
export type Layout = z.infer<typeof LayoutSchema>
export type Pane = z.infer<typeof PaneSchema>
export type WindowMode = z.infer<typeof WindowModeSchema>

// CLI向けの表示情報
export type PresetInfo = {
  key: string
  name: string
  description?: string
}
