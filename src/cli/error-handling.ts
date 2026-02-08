import { isCoreError, type CoreError } from "../core/index"
import type { Logger } from "../utils/logger"

type CliErrorHandlers = {
  handleCoreError: (error: CoreError) => number
  handleError: (error: unknown) => number
  handlePipelineFailure: (error: unknown) => number
}

export const createCliErrorHandlers = ({ getLogger }: { getLogger: () => Logger }): CliErrorHandlers => {
  const handleCoreError = (error: CoreError): number => {
    const header = [`[${error.kind}]`, `[${error.code}]`]
    if (typeof error.path === "string" && error.path.length > 0) {
      header.push(`[${error.path}]`)
    }

    const lines = [`${header.join(" ")} ${error.message}`.trim()]

    if (typeof error.source === "string" && error.source.length > 0) {
      lines.push(`source: ${error.source}`)
    }

    const commandDetail = error.details?.command
    if (Array.isArray(commandDetail)) {
      const parts = commandDetail.filter((segment): segment is string => typeof segment === "string")
      if (parts.length > 0) {
        lines.push(`command: ${parts.join(" ")}`)
      }
    } else if (typeof commandDetail === "string" && commandDetail.length > 0) {
      lines.push(`command: ${commandDetail}`)
    }

    const stderrDetail = error.details?.stderr
    if (typeof stderrDetail === "string" && stderrDetail.length > 0) {
      lines.push(`stderr: ${stderrDetail}`)
    } else if (stderrDetail !== undefined) {
      lines.push(`stderr: ${String(stderrDetail)}`)
    }

    getLogger().error(lines.join("\n"))
    return 1
  }

  const handleError = (error: unknown): number => {
    if (error instanceof Error) {
      getLogger().error(error.message, error)
    } else {
      getLogger().error("An unexpected error occurred")
    }

    return 1
  }

  const handlePipelineFailure = (error: unknown): number => {
    if (isCoreError(error)) {
      return handleCoreError(error)
    }
    return handleError(error)
  }

  return {
    handleCoreError,
    handleError,
    handlePipelineFailure,
  }
}
