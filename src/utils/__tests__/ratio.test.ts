import { describe, expect, it } from "vitest"
import { normalizeRatio, isValidRatio } from "../ratio.ts"

describe("normalizeRatio", () => {
  it("should normalize [1, 1] to [50, 50]", () => {
    const result = normalizeRatio([1, 1])
    expect(result).toEqual([50, 50])
  })

  it("should normalize [2, 3] to [40, 60]", () => {
    const result = normalizeRatio([2, 3])
    expect(result).toEqual([40, 60])
  })

  it("should keep [50, 50] as [50, 50]", () => {
    const result = normalizeRatio([50, 50])
    expect(result).toEqual([50, 50])
  })

  it("should normalize [1, 2, 1] to [25, 50, 25]", () => {
    const result = normalizeRatio([1, 2, 1])
    expect(result).toEqual([25, 50, 25])
  })

  it("should handle three equal ratios [1, 1, 1] to approximately [34, 33, 33]", () => {
    const result = normalizeRatio([1, 1, 1])
    expect(result).toEqual([34, 33, 33])
    expect(result.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it("should handle decimal ratios [1.5, 2.5] to [37, 63]", () => {
    const result = normalizeRatio([1.5, 2.5])
    expect(result).toEqual([37, 63]) // 1.5/4*100=37.5 → 37, 2.5/4*100=62.5 → 63
    expect(result.reduce((a, b) => a + b, 0)).toBe(100) // Adjusted to sum to 100
  })

  it("should handle single element [100] to [100]", () => {
    const result = normalizeRatio([100])
    expect(result).toEqual([100])
  })

  it("should handle single element [50] to [100]", () => {
    const result = normalizeRatio([50])
    expect(result).toEqual([100])
  })

  it("should handle empty array", () => {
    const result = normalizeRatio([])
    expect(result).toEqual([])
  })

  it("should handle all zeros by equal distribution", () => {
    const result = normalizeRatio([0, 0])
    expect(result).toEqual([50, 50])
  })

  it("should handle all zeros with three elements", () => {
    const result = normalizeRatio([0, 0, 0])
    expect(result).toEqual([33, 33, 34]) // 100/3 = 33.33... → 33, 33, 34 (remainder distributed to last)
  })

  it("should ensure sum is always 100 for multi-element arrays", () => {
    const testCases = [
      [1, 1],
      [2, 3],
      [1, 2, 3],
      [5, 10, 15, 20],
      [0.1, 0.2, 0.3],
    ]

    for (const ratio of testCases) {
      const result = normalizeRatio(ratio)
      const sum = result.reduce((a, b) => a + b, 0)
      expect(sum).toBe(100)
    }
  })
})

describe("isValidRatio", () => {
  it("should return true for valid ratios", () => {
    expect(isValidRatio([1, 1])).toBe(true)
    expect(isValidRatio([50, 50])).toBe(true)
    expect(isValidRatio([1, 2, 3])).toBe(true)
    expect(isValidRatio([100])).toBe(true)
  })

  it("should return false for invalid ratios", () => {
    expect(isValidRatio([])).toBe(false)
    expect(isValidRatio([0, 1])).toBe(false)
    expect(isValidRatio([1, 0])).toBe(false)
    expect(isValidRatio([-1, 1])).toBe(false)
    expect(isValidRatio([1, -1])).toBe(false)
  })
})
