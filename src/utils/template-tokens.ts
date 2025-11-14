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

/**
 * Replaces template tokens in a command string with actual pane IDs.
 *
 * @param input - Object containing the command and pane ID mappings
 * @returns The command string with all template tokens replaced
 * @throws Error if a referenced pane name is not found in the mapping
 */
export const replaceTemplateTokens = ({
  command,
  currentPaneRealId,
  focusPaneRealId,
  nameToRealIdMap,
}: ReplaceTemplateTokensInput): string => {
  let result = command

  // Replace {{this_pane}} with current pane ID
  result = result.replace(/\{\{this_pane\}\}/g, currentPaneRealId)

  // Replace {{focus_pane}} with focus pane ID
  result = result.replace(/\{\{focus_pane\}\}/g, focusPaneRealId)

  // Replace {{pane_id:<name>}} with the corresponding pane ID
  result = result.replace(/\{\{pane_id:([^}]+)\}\}/g, (match, name: string) => {
    const trimmedName = name.trim()
    const paneId = nameToRealIdMap.get(trimmedName)

    if (paneId === undefined) {
      throw new Error(`Template token error: pane name "${trimmedName}" not found. Available panes: ${Array.from(nameToRealIdMap.keys()).join(", ")}`)
    }

    return paneId
  })

  return result
}

/**
 * Builds a mapping from pane names to real pane IDs.
 *
 * @param terminals - Array of emitted terminals
 * @param paneMap - Map from virtual pane IDs to real pane IDs
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
