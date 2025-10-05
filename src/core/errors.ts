export type FunctionalCoreErrorKind = "compile" | "plan" | "emit" | "execution"

export type FunctionalCoreError = {
  readonly kind: FunctionalCoreErrorKind
  readonly code: string
  readonly message: string
  readonly source?: string
  readonly path?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export const createFunctionalError = (
  kind: FunctionalCoreErrorKind,
  error: {
    readonly code: string
    readonly message: string
    readonly source?: string
    readonly path?: string
    readonly details?: Readonly<Record<string, unknown>>
  },
): FunctionalCoreError => ({
  kind,
  code: error.code,
  message: error.message,
  source: error.source,
  path: error.path,
  details: error.details,
})

export const isFunctionalCoreError = (value: unknown): value is FunctionalCoreError => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const candidate = value as Partial<FunctionalCoreError>
  return (
    (candidate.kind === "compile" ||
      candidate.kind === "plan" ||
      candidate.kind === "emit" ||
      candidate.kind === "execution") &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  )
}
