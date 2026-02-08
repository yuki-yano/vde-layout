import { z } from "zod"

export const WindowModeSchema = z.enum(["new-window", "current-window"])
export const TerminalBackendSchema = z.enum(["tmux", "wezterm"])

// Terminal pane schema
const TerminalPaneSchema = z
  .object({
    name: z.string().min(1),
    command: z.string().optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    delay: z.number().int().positive().optional(),
    title: z.string().optional(),
    focus: z.boolean().optional(),
    ephemeral: z.boolean().optional(),
    closeOnError: z.boolean().optional(),
  })
  .strict()

// Split container schema (recursive)
const SplitPaneSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.enum(["horizontal", "vertical"]),
      ratio: z.array(z.number().positive()).min(1),
      panes: z.array(PaneSchema).min(1),
    })
    .strict()
    .refine((data) => data.ratio.length === data.panes.length, {
      message: "Number of elements in ratio array does not match number of elements in panes array",
    }),
)

// Recursive Pane schema definition
export const PaneSchema: z.ZodType<unknown> = z.lazy(() => z.union([SplitPaneSchema, TerminalPaneSchema]))

// Layout schema definition
export const LayoutSchema = z
  .object({
    type: z.enum(["horizontal", "vertical"]),
    ratio: z.array(z.number().positive()).min(1),
    panes: z.array(PaneSchema).min(1),
  })
  .refine((data) => data.ratio.length === data.panes.length, {
    message: "Number of elements in ratio array does not match number of elements in panes array",
  })

// Preset schema definition
export const PresetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  layout: LayoutSchema.optional(),
  command: z.string().optional(),
  windowMode: WindowModeSchema.optional(),
  backend: TerminalBackendSchema.optional(),
})

// Config schema definition
export const ConfigSchema = z.object({
  defaults: z
    .object({
      windowMode: WindowModeSchema.optional(),
    })
    .optional(),
  presets: z.record(PresetSchema),
})

// Validation result type
type ValidationResult<T> = {
  success: boolean
  data?: T
  error?: string
}

// Helper function to format Zod errors consistently
const formatValidationError = (error: z.ZodError): string => {
  const messages = error.errors.map((e) => {
    const path = e.path.join(".")
    const message = e.message

    // Customize error message for panes array element count check
    if (path === "layout.panes" && message.includes("at least 2 element")) {
      return `${path}: panes array must have at least 2 elements`
    }

    return `${path}: ${message}`
  })

  return messages.join("\n")
}

// Config validation
export const validateConfig = (data: unknown): ValidationResult<z.infer<typeof ConfigSchema>> => {
  try {
    const parsed = ConfigSchema.parse(data)
    return { success: true, data: parsed }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: formatValidationError(error) }
    }
    return { success: false, error: String(error) }
  }
}

// Preset validation
export const validatePreset = (data: unknown): ValidationResult<z.infer<typeof PresetSchema>> => {
  try {
    const parsed = PresetSchema.parse(data)
    return { success: true, data: parsed }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: formatValidationError(error) }
    }
    return { success: false, error: String(error) }
  }
}

// Pane validation
export const validatePane = (data: unknown): ValidationResult<z.infer<typeof PaneSchema>> => {
  try {
    const parsed = PaneSchema.parse(data)
    return { success: true, data: parsed }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: formatValidationError(error) }
    }
    return { success: false, error: String(error) }
  }
}
