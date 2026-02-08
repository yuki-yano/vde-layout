import { createCoreError } from "../../core/errors"
import { ErrorCodes } from "../../utils/errors"
import { resolvePaneMapping } from "../../utils/pane-map"
import type { PaneMap } from "./shared"

export const registerPaneWithAncestors = (map: PaneMap, virtualId: string, realId: string): void => {
  map.set(virtualId, realId)

  let ancestor = virtualId
  while (ancestor.includes(".")) {
    ancestor = ancestor.slice(0, ancestor.lastIndexOf("."))
    if (!map.has(ancestor)) {
      map.set(ancestor, realId)
    } else {
      break
    }
  }
}

export const resolveRealPaneId = (
  paneMap: PaneMap,
  virtualId: string,
  context: { readonly stepId: string },
): string => {
  const resolved = resolvePaneMapping(paneMap, virtualId)
  if (typeof resolved === "string" && resolved.length > 0) {
    return resolved
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PANE,
    message: `Unknown wezterm pane mapping for ${virtualId}`,
    path: context.stepId,
  })
}
