import { describe, expect, it } from "vitest"
import { resolveWindowMode } from "../window-mode.ts"

describe("resolveWindowMode", () => {
  it("prefers CLI override over other sources", () => {
    const result = resolveWindowMode({
      cli: "current-window",
      preset: "new-window",
      defaults: "new-window",
    })

    expect(result).toEqual({ mode: "current-window", source: "cli" })
  })

  it("falls back to preset when CLI override is absent", () => {
    const result = resolveWindowMode({
      preset: "current-window",
      defaults: "new-window",
    })

    expect(result).toEqual({ mode: "current-window", source: "preset" })
  })

  it("uses defaults when preset omits windowMode", () => {
    const result = resolveWindowMode({
      defaults: "current-window",
    })

    expect(result).toEqual({ mode: "current-window", source: "defaults" })
  })

  it("returns new-window when no sources specify mode", () => {
    const result = resolveWindowMode({})
    expect(result).toEqual({ mode: "new-window", source: "fallback" })
  })
})
