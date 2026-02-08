import { describe, expect, it } from "vitest"
import { resolveSplitOrientation, resolveSplitPercentage } from "../split-step"
import type { CommandStep } from "../../core/emitter"

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
  it("prefers structured orientation metadata", () => {
    const step = splitStep({
      orientation: "horizontal",
      command: ["split-window", "-v", "-t", "root.0", "-p", "10"],
    })

    expect(resolveSplitOrientation(step)).toBe("horizontal")
  })

  it("falls back to legacy command flags when orientation metadata is missing", () => {
    expect(resolveSplitOrientation(splitStep({ command: ["split-window", "-h", "-t", "root.0"] }))).toBe("horizontal")
    expect(resolveSplitOrientation(splitStep({ command: ["split-window", "-v", "-t", "root.0"] }))).toBe("vertical")
  })

  it("defaults to vertical when no direction hint exists", () => {
    expect(resolveSplitOrientation(splitStep({ command: ["split-window", "-t", "root.0"] }))).toBe("vertical")
    expect(resolveSplitOrientation(splitStep())).toBe("vertical")
  })

  it("resolves percentage from metadata, command, and defaults", () => {
    expect(resolveSplitPercentage(splitStep({ percentage: 33 }))).toBe("33")
    expect(resolveSplitPercentage(splitStep({ command: ["split-window", "-p", "41"] }))).toBe("41")
    expect(resolveSplitPercentage(splitStep())).toBe("50")
  })
})
