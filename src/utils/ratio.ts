/**
 * Utility function to normalize ratio arrays
 * Treats [50, 50] and [1, 1] as the same and converts to tmux-compatible format
 */

/**
 * Normalize ratio array to 100%
 * @param ratio - Ratio array to normalize
 * @returns Ratio array normalized to 100%
 * @example
 * normalizeRatio([1, 1]) => [50, 50]
 * normalizeRatio([2, 3]) => [40, 60]
 * normalizeRatio([50, 50]) => [50, 50]
 */
export function normalizeRatio(ratio: number[]): number[] {
  if (ratio.length === 0) {
    return []
  }

  if (ratio.length === 1) {
    return [100]
  }

  // Calculate sum
  const sum = ratio.reduce((acc, val) => acc + val, 0)

  if (sum === 0) {
    // If all are 0, divide equally
    const equalRatio = Math.floor(100 / ratio.length)
    const remainder = 100 % ratio.length
    const result = ratio.map(() => equalRatio)

    // Distribute remainder from last elements
    for (let i = 0; i < remainder; i++) {
      result[result.length - 1 - i]!++
    }

    return result
  }

  // Normalize to 100%
  const normalized = ratio.map((val) => (val / sum) * 100)

  // Round to integers
  const rounded = normalized.map((val) => Math.round(val))

  // Adjust rounding errors
  const roundedSum = rounded.reduce((acc, val) => acc + val, 0)
  const diff = 100 - roundedSum

  if (diff !== 0) {
    // Adjust from elements closest to decimal points
    const fractionalParts = normalized.map((val, index) => ({
      index,
      fractional: val - rounded[index]!,
    }))

    // Sort by fractional part descending (if diff > 0) or ascending (if diff < 0)
    fractionalParts.sort((a, b) => (diff > 0 ? b.fractional - a.fractional : a.fractional - b.fractional))

    // Adjust as needed
    for (let i = 0; i < Math.abs(diff); i++) {
      if (i < fractionalParts.length) {
        const targetIndex = fractionalParts[i]!.index
        rounded[targetIndex]! += diff > 0 ? 1 : -1
      }
    }
  }

  return rounded
}

/**
 * Check if ratio array is valid
 * @param ratio - Ratio array to check
 * @returns true if valid
 */
export function isValidRatio(ratio: number[]): boolean {
  return ratio.length > 0 && ratio.every((val) => val > 0)
}
