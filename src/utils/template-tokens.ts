import type { EmittedTerminal } from "../core/emitter.ts"

/**
 * Template token types supported in pane commands:
 * - {{pane_id:<name>}} - resolves to a specific pane's ID by name
 * - {{this_pane}} - references the current pane receiving the command
 * - {{focus_pane}} - references the intended focus pane
 */

type ReplaceTemplateTokensInput = {
  readonly command: string
  readonly currentPaneRealId: string
  readonly focusPaneRealId: string
  readonly nameToRealIdMap: ReadonlyMap<string, string>
}

export class TemplateTokenError extends Error {
  constructor(
    message: string,
    public readonly tokenType: string,
    public readonly availablePanes?: ReadonlyArray<string>,
  ) {
    super(message)
    this.name = "TemplateTokenError"
  }
}

/**
 * Replaces template tokens in a command string with actual pane IDs.
 *
 * Uses a single-pass regex replacement to avoid nested token issues.
 * All tokens are replaced in a single pass, preventing already-replaced
 * values from being re-processed.
 *
 * @param input - Object containing the command and pane ID mappings
 * @returns The command string with all template tokens replaced
 * @throws TemplateTokenError if a referenced pane name is not found in the mapping
 */
export const replaceTemplateTokens = ({
  command,
  currentPaneRealId,
  focusPaneRealId,
  nameToRealIdMap,
}: ReplaceTemplateTokensInput): string => {
  // Single-pass regex that matches all token types
  // This prevents nested token issues by replacing everything in one pass
  const tokenPattern = /\{\{(this_pane|focus_pane|pane_id:([^}]+))\}\}/g

  return command.replace(tokenPattern, (match, tokenContent: string, paneName?: string) => {
    if (tokenContent === "this_pane") {
      return currentPaneRealId
    }

    if (tokenContent === "focus_pane") {
      return focusPaneRealId
    }

    // Must be pane_id:<name> token
    if (tokenContent.startsWith("pane_id:") && paneName !== undefined) {
      const trimmedName = paneName.trim()
      const paneId = nameToRealIdMap.get(trimmedName)

      if (paneId === undefined) {
        throw new TemplateTokenError(
          `Pane name "${trimmedName}" not found. Available panes: ${Array.from(nameToRealIdMap.keys()).join(", ")}`,
          "pane_id",
          Array.from(nameToRealIdMap.keys()),
        )
      }

      return paneId
    }

    // Fallback: return original match if token is malformed
    return match
  })
}

/**
 * Builds a mapping from pane names to real pane IDs.
 *
 * **Duplicate Name Handling:**
 * If multiple panes share the same name, the last one in the terminals
 * array wins. This follows the iteration order of the layout tree.
 * It's recommended to use unique names for panes to avoid ambiguity
 * in template token references.
 *
 * **Virtual to Real ID Resolution:**
 * Only panes with successfully resolved real IDs (present in paneMap)
 * are included in the resulting map. This ensures that template tokens
 * only reference panes that have been properly created.
 *
 * @param terminals - Array of emitted terminals from the layout plan
 * @param paneMap - Map from virtual pane IDs to real pane IDs (backend-specific)
 * @returns A map from pane names to real pane IDs
 */
export const buildNameToRealIdMap = (
  terminals: ReadonlyArray<EmittedTerminal>,
  paneMap: ReadonlyMap<string, string>,
): Map<string, string> => {
  const nameToRealIdMap = new Map<string, string>()

  for (const terminal of terminals) {
    const realId = paneMap.get(terminal.virtualPaneId)
    if (realId !== undefined) {
      nameToRealIdMap.set(terminal.name, realId)
    }
  }

  return nameToRealIdMap
}
