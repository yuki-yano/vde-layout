import { describe, expect, it } from "vitest"
import { normalizeSelectArgs, resolveSelectSurfaceMode, resolveSelectUiMode } from "./select-args"

describe("select-args", () => {
  describe("normalizeSelectArgs", () => {
    it("keeps --select when mode is omitted", () => {
      expect(normalizeSelectArgs(["--select"])).toEqual(["--select"])
    })

    it("normalizes --select=fzf syntax", () => {
      expect(normalizeSelectArgs(["--select=fzf"])).toEqual(["--select", "--select-ui", "fzf"])
    })

    it("normalizes --select fzf syntax", () => {
      expect(normalizeSelectArgs(["--select", "fzf"])).toEqual(["--select", "--select-ui", "fzf"])
    })

    it("does not consume positional preset names after --select", () => {
      expect(normalizeSelectArgs(["--select", "dev"])).toEqual(["--select", "dev"])
    })

    it("stops normalization after -- separator", () => {
      expect(normalizeSelectArgs(["--select", "fzf", "--", "--select=tui"])).toEqual([
        "--select",
        "--select-ui",
        "fzf",
        "--",
        "--select=tui",
      ])
    })
  })

  describe("resolveSelectUiMode", () => {
    it("defaults to auto when ui is omitted", () => {
      expect(resolveSelectUiMode(undefined)).toBe("auto")
    })

    it("accepts known ui values", () => {
      expect(resolveSelectUiMode("auto")).toBe("auto")
      expect(resolveSelectUiMode("fzf")).toBe("fzf")
    })

    it("throws for unknown ui values", () => {
      expect(() => resolveSelectUiMode("peco")).toThrow(/Invalid value for --select-ui/)
    })
  })

  describe("resolveSelectSurfaceMode", () => {
    it("defaults to auto when surface is omitted", () => {
      expect(resolveSelectSurfaceMode(undefined)).toBe("auto")
    })

    it("accepts known surface values", () => {
      expect(resolveSelectSurfaceMode("auto")).toBe("auto")
      expect(resolveSelectSurfaceMode("inline")).toBe("inline")
      expect(resolveSelectSurfaceMode("tmux-popup")).toBe("tmux-popup")
    })

    it("throws for unknown surface values", () => {
      expect(() => resolveSelectSurfaceMode("floating")).toThrow(/Invalid value for --select-surface/)
    })
  })
})
