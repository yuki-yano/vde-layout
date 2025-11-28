type CoreErrorKind = "compile" | "plan" | "emit" | "execution"

export type CoreError = {
  readonly kind: CoreErrorKind
  readonly code: string
  readonly message: string
  readonly source?: string
  readonly path?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export const createCoreError = (
  kind: CoreErrorKind,
  error: {
    readonly code: string
    readonly message: string
    readonly source?: string
    readonly path?: string
    readonly details?: Readonly<Record<string, unknown>>
  },
): CoreError => ({
  kind,
  code: error.code,
  message: error.message,
  source: error.source,
  path: error.path,
  details: error.details,
})

export const isCoreError = (value: unknown): value is CoreError => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const candidate = value as Partial<CoreError>
  return (
    (candidate.kind === "compile" ||
      candidate.kind === "plan" ||
      candidate.kind === "emit" ||
      candidate.kind === "execution") &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  )
}
