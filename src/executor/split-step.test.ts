import { describe, expect, it } from "vitest"
import { resolveSplitOrientation, resolveSplitPercentage, resolveSplitSize } from "./split-step"
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
    splitSizing: {
      mode: "percent",
      percentage: 50,
    },
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
    expect(resolveSplitPercentage(splitStep({ percentage: 33, splitSizing: undefined }))).toBe("33")
  })

  it("throws when percentage metadata is missing", () => {
    expect(() => resolveSplitPercentage(splitStep({ percentage: undefined, splitSizing: undefined }))).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.INVALID_PLAN,
        path: "root:split:1",
      }),
    )
  })

  it("throws INVALID_PLAN when resolving percentage for dynamic-cells sizing", () => {
    expect(() =>
      resolveSplitPercentage(
        splitStep({
          splitSizing: {
            mode: "dynamic-cells",
            target: { kind: "weight", weight: 1 },
            remainingFixedCells: 0,
            remainingWeight: 1,
            remainingWeightPaneCount: 1,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.INVALID_PLAN,
        path: "root:split:1",
      }),
    )
  })

  it("resolves dynamic split size using pane cells", () => {
    const resolved = resolveSplitSize(
      splitStep({
        splitSizing: {
          mode: "dynamic-cells",
          target: { kind: "fixed-cells", cells: 90 },
          remainingFixedCells: 0,
          remainingWeight: 3,
          remainingWeightPaneCount: 2,
        },
      }),
      { paneCells: 200, paneId: "%1" },
    )

    expect(resolved).toEqual({
      mode: "cells",
      cells: "110",
      targetCells: 90,
      createdCells: 110,
    })
  })

  it("throws SPLIT_SIZE_RESOLUTION_FAILED when dynamic split has no pane size", () => {
    expect(() =>
      resolveSplitSize(
        splitStep({
          splitSizing: {
            mode: "dynamic-cells",
            target: { kind: "weight", weight: 1 },
            remainingFixedCells: 120,
            remainingWeight: 1,
            remainingWeightPaneCount: 1,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.SPLIT_SIZE_RESOLUTION_FAILED,
      }),
    )
  })
})
