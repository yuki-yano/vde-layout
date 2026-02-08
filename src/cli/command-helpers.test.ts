import { describe, expect, it, vi } from "vitest"

import type { DryRunStep } from "../executor/terminal-backend"
import { buildPresetSource, determineCliWindowMode, renderDryRun } from "./command-helpers"

describe("command helpers", () => {
  describe("buildPresetSource", () => {
    it("returns default source when preset name is omitted", () => {
      expect(buildPresetSource()).toBe("preset://default")
    })

    it("returns named preset source", () => {
      expect(buildPresetSource("dev")).toBe("preset://dev")
    })
  })

  describe("determineCliWindowMode", () => {
    it("throws when both current-window and new-window are true", () => {
      expect(() =>
        determineCliWindowMode({
          currentWindow: true,
          newWindow: true,
        }),
      ).toThrow("Cannot use --current-window and --new-window at the same time")
    })

    it("returns current-window when currentWindow is true", () => {
      expect(
        determineCliWindowMode({
          currentWindow: true,
          newWindow: false,
        }),
      ).toBe("current-window")
    })

    it("returns new-window when newWindow is true", () => {
      expect(
        determineCliWindowMode({
          currentWindow: false,
          newWindow: true,
        }),
      ).toBe("new-window")
    })

    it("returns undefined when no mode is explicitly set", () => {
      expect(
        determineCliWindowMode({
          currentWindow: false,
          newWindow: false,
        }),
      ).toBeUndefined()
    })
  })

  describe("renderDryRun", () => {
    it("renders dry-run steps in numbered format", () => {
      const steps: ReadonlyArray<DryRunStep> = [
        {
          backend: "tmux",
          summary: "split root",
          command: "tmux split-window -h -t root -p 50",
        },
      ]
      const output = vi.fn()

      renderDryRun(steps, output)

      expect(output).toHaveBeenCalledTimes(2)
      expect(output).toHaveBeenNthCalledWith(1, expect.stringContaining("Planned terminal steps (dry-run)"))
      expect(output).toHaveBeenNthCalledWith(2, " 1. [tmux] split root: tmux split-window -h -t root -p 50")
    })
  })
})
