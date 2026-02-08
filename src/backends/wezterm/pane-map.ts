import { createCoreError } from "../../core/errors"
import { ErrorCodes } from "../../utils/errors"
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
  const direct = paneMap.get(virtualId)
  if (typeof direct === "string" && direct.length > 0) {
    return direct
  }

  let ancestor = virtualId
  while (ancestor.includes(".")) {
    ancestor = ancestor.slice(0, ancestor.lastIndexOf("."))
    const candidate = paneMap.get(ancestor)
    if (typeof candidate === "string" && candidate.length > 0) {
      paneMap.set(virtualId, candidate)
      return candidate
    }
  }

  for (const [key, value] of paneMap.entries()) {
    if (key.startsWith(`${virtualId}.`)) {
      if (typeof value === "string" && value.length > 0) {
        paneMap.set(virtualId, value)
        return value
      }
    }
  }

  throw createCoreError("execution", {
    code: ErrorCodes.INVALID_PANE,
    message: `Unknown wezterm pane mapping for ${virtualId}`,
    path: context.stepId,
  })
}
