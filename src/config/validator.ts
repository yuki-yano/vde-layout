import * as YAML from "yaml"
import { z } from "zod"
import { ConfigSchema } from "../models/schema.ts"
import type { Config } from "../models/types.ts"
import { createValidationError, ErrorCodes, isVDELayoutError } from "../utils/errors.ts"

/**
 * Parse YAML text into an object
 * @param yamlText - YAML text to parse
 * @returns Parsed object
 * @throws {ValidationError} When YAML parsing fails
 */
const parseYAML = (yamlText: string): unknown => {
  // Input validation
  if (!yamlText || typeof yamlText !== "string") {
    throw createValidationError("YAML text not provided", ErrorCodes.CONFIG_PARSE_ERROR, {
      received: typeof yamlText,
    })
  }

  try {
    return YAML.parse(yamlText)
  } catch (error) {
    throw createValidationError("Failed to parse YAML", ErrorCodes.CONFIG_PARSE_ERROR, {
      parseError: error instanceof Error ? error.message : String(error),
      yamlSnippet: yamlText.substring(0, 200),
    })
  }
}

/**
 * Validate basic configuration structure
 * @param parsed - Parsed YAML object
 * @throws {ValidationError} When structure is invalid
 */
const validateConfigStructure = (parsed: unknown): void => {
  // Check for empty YAML
  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    throw createValidationError("YAML is empty or invalid format", ErrorCodes.CONFIG_PARSE_ERROR, {
      parsed: parsed,
    })
  }

  // Check for presets field existence
  const parsedObj = parsed as Record<string, unknown>
  if (!("presets" in parsedObj) || parsedObj.presets === undefined || parsedObj.presets === null) {
    throw createValidationError("presets field is required", ErrorCodes.INVALID_PRESET, {
      availableFields: Object.keys(parsedObj),
    })
  }

  // Check for empty presets
  const presetsObj = parsedObj.presets
  if (typeof presetsObj !== "object" || presetsObj === null || Object.keys(presetsObj).length === 0) {
    throw createValidationError("At least one preset is required", ErrorCodes.INVALID_PRESET, {
      presets: presetsObj,
    })
  }
}

/**
 * Format Zod validation errors into user-friendly messages
 * @param error - Zod validation error
 * @returns Formatted error issues
 */
const formatZodErrors = (error: z.ZodError): Array<{ path: string; message: string; code: string }> => {
  return error.issues.map((issue) => {
    const path = issue.path.join(".")
    let message = issue.message

    // Custom error messages
    if (issue.code === "invalid_type") {
      if (issue.path.includes("command") && issue.expected === "string") {
        message = "command field must be a string"
      } else if (issue.path.includes("workingDirectory") && issue.expected === "string") {
        message = "workingDirectory field must be a string"
      } else if (issue.received === "number" && issue.expected === "string") {
        message = `${path} must be a string`
      } else if (issue.received === "array" && issue.expected === "string") {
        message = `${path} must be a string`
      }
    } else if (issue.code === "invalid_union") {
      // Detailed error messages for union types
      const unionIssue = issue as z.ZodIssue & { unionErrors?: z.ZodError[] }
      if (unionIssue.unionErrors !== undefined) {
        // When command is missing in terminal pane
        const terminalError = unionIssue.unionErrors.find(
          (e) => e.issues?.some((i) => i.path.includes("command") && i.code === "invalid_type") === true,
        )
        if (terminalError !== undefined) {
          message = "command field is required"
        } else {
          // When panes is missing in split pane
          const splitError = unionIssue.unionErrors.find(
            (e) => e.issues?.some((i) => i.path.includes("panes") && i.code === "invalid_type") === true,
          )
          if (splitError !== undefined) {
            message = "panes field is required"
          } else {
            message = 'Pane type must be "terminal" or "split"'
          }
        }
      } else {
        message = 'Pane type must be "terminal" or "split"'
      }
    } else if (issue.code === "invalid_literal") {
      if (issue.path.includes("direction")) {
        message = 'direction must be "horizontal" or "vertical"'
      }
    } else if (issue.message.includes("required")) {
      // Use the message as is
      message = issue.message
    } else if (issue.code === "custom" && issue.message.includes("ratio array")) {
      message = issue.message
    } else if (issue.code === "too_small" && issue.message.includes("Array must contain at least")) {
      // Minimum array elements error
      if (path.includes("panes")) {
        message = "panes array must contain at least 2 elements"
      } else if (path.includes("ratio")) {
        message = "ratio array must contain at least 2 elements"
      } else {
        message = issue.message
      }
    }

    return {
      path,
      message,
      code: issue.code,
    }
  })
}

/**
 * Validates YAML text and converts it to a type-safe Config object
 * @param yamlText - YAML text to validate
 * @returns Validated Config object
 * @throws {ValidationError} When YAML is invalid
 */
export const validateYAML = (yamlText: string): Config => {
  // Parse YAML
  const parsed = parseYAML(yamlText)

  // Validate basic structure
  validateConfigStructure(parsed)

  // Ratio sum validation removed - unnecessary due to automatic normalization

  // Validation with Zod schema
  try {
    const validated = ConfigSchema.parse(parsed)
    return validated
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = formatZodErrors(error)

      // Use the first error message as the primary message
      const primaryMessage = issues.length > 0 && issues[0] ? issues[0].message : "Configuration validation failed"

      throw createValidationError(primaryMessage, ErrorCodes.CONFIG_PARSE_ERROR, {
        issues,
        rawErrors: error.issues,
      })
    }

    if (isVDELayoutError(error) && error.name === "ValidationError") {
      throw error
    }

    // Other errors
    throw createValidationError("Unexpected validation error occurred", ErrorCodes.CONFIG_PARSE_ERROR, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
