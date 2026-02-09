import { describe, expect, it } from "vitest"
import { resolveSplitOrientation, resolveSplitPercentage } from "./split-step"
import type { CommandStep } from "../core/emitter"
import { ErrorCodes } from "../utils/errors"

const splitStep = (overrides: Partial<CommandStep> = {}): CommandStep => {
  return {
    id: "root:split:1",
    kind: "split",
    summary: "split root.0",
    targetPaneId: "root.0",
    createdPaneId: "root.1",
    orientation: "horizontal",
    percentage: 50,
    ...overrides,
  }
}

describe("split-step resolvers", () => {
  it("resolves split orientation from structured metadata", () => {
    expect(resolveSplitOrientation(splitStep({ orientation: "horizontal" }))).toBe("horizontal")
    expect(resolveSplitOrientation(splitStep({ orientation: "vertical" }))).toBe("vertical")
  })

  it("throws when orientation metadata is missing", () => {
    expect(() => resolveSplitOrientation(splitStep({ orientation: undefined }))).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.INVALID_PLAN,
        path: "root:split:1",
      }),
    )
  })

  it("resolves percentage from metadata", () => {
    expect(resolveSplitPercentage(splitStep({ percentage: 33 }))).toBe("33")
  })

  it("throws when percentage metadata is missing", () => {
    expect(() => resolveSplitPercentage(splitStep({ percentage: undefined }))).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.INVALID_PLAN,
        path: "root:split:1",
      }),
    )
  })
})
