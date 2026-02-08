type PackageJsonModule = {
  readonly version: string
}

type ModuleLoadError = Error & {
  readonly code?: string
}

const CANDIDATE_PATHS = ["../package.json", "../../package.json"] as const

const isModuleNotFoundError = (error: unknown): error is ModuleLoadError => {
  return error instanceof Error && (error as ModuleLoadError).code === "MODULE_NOT_FOUND"
}

export const loadPackageVersion = (requireFn: NodeJS.Require): string => {
  let lastNotFound: ModuleLoadError | undefined

  for (const path of CANDIDATE_PATHS) {
    try {
      return (requireFn(path) as PackageJsonModule).version
    } catch (error) {
      if (isModuleNotFoundError(error)) {
        lastNotFound = error
        continue
      }

      throw error
    }
  }

  throw lastNotFound ?? new Error(`Unable to resolve package version from candidates: ${CANDIDATE_PATHS.join(", ")}`)
}
