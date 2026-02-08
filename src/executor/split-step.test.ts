import { describe, expect, it } from "vitest"
import { resolveSplitOrientation, resolveSplitPercentage } from "./split-step"
import type { CommandStep } from "../core/emitter"

const splitStep = (overrides: Partial<CommandStep> = {}): CommandStep => {
  return {
    id: "root:split:1",
    kind: "split",
    summary: "split root.0",
    targetPaneId: "root.0",
    createdPaneId: "root.1",
    ...overrides,
  }
}

describe("split-step resolvers", () => {
  it("resolves split orientation from structured metadata", () => {
    expect(resolveSplitOrientation(splitStep({ orientation: "horizontal" }))).toBe("horizontal")
    expect(resolveSplitOrientation(splitStep({ orientation: "vertical" }))).toBe("vertical")
  })

  it("defaults to vertical when orientation metadata is missing", () => {
    expect(resolveSplitOrientation(splitStep())).toBe("vertical")
  })

  it("resolves percentage from metadata and defaults", () => {
    expect(resolveSplitPercentage(splitStep({ percentage: 33 }))).toBe("33")
    expect(resolveSplitPercentage(splitStep())).toBe("50")
  })
})
