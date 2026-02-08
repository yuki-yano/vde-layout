import { describe, expect, it } from "vitest"

import eslintConfig from "../../eslint.config.mjs"

type RuleEntry = {
  readonly files?: ReadonlyArray<string>
  readonly rules?: Readonly<Record<string, unknown>>
}

const findRuleEntry = (filesPattern: string): RuleEntry | undefined => {
  return (eslintConfig as ReadonlyArray<RuleEntry>).find((entry) => {
    return (
      Array.isArray(entry.files) &&
      entry.files.includes(filesPattern) &&
      typeof entry.rules?.["no-restricted-imports"] !== "undefined"
    )
  })
}

const extractRestrictedPatterns = (filesPattern: string): ReadonlyArray<string> => {
  const entry = findRuleEntry(filesPattern)
  const noRestrictedImportsRule = entry?.rules?.["no-restricted-imports"]
  if (!Array.isArray(noRestrictedImportsRule) || noRestrictedImportsRule.length < 2) {
    return []
  }
  const options = noRestrictedImportsRule[1]
  if (typeof options !== "object" || options === null) {
    return []
  }
  const patterns = (options as { readonly patterns?: ReadonlyArray<string> }).patterns
  if (!Array.isArray(patterns)) {
    return []
  }
  return patterns
}

describe("eslint import boundaries", () => {
  it("defines architectural restrictions for core layer", () => {
    const patterns = extractRestrictedPatterns("src/core/**/*.ts")
    expect(patterns).toContain("../executor/*")
    expect(patterns).toContain("../backends/*")
    expect(patterns).toContain("../cli/*")
    expect(patterns).toContain("../config/*")
  })

  it("defines architectural restrictions for executor layer", () => {
    const patterns = extractRestrictedPatterns("src/executor/**/*.ts")
    expect(patterns).toContain("../cli/*")
    expect(patterns).toContain("../config/*")
  })

  it("defines architectural restrictions for config layer", () => {
    const patterns = extractRestrictedPatterns("src/config/**/*.ts")
    expect(patterns).toContain("../executor/*")
    expect(patterns).toContain("../backends/*")
    expect(patterns).toContain("../cli/*")
  })

  it("forbids legacy backend import paths globally", () => {
    const patterns = extractRestrictedPatterns("src/**/*.ts")
    expect(patterns).toContain("../tmux/*")
    expect(patterns).toContain("../wezterm/*")
    expect(patterns).toContain("./backends/*")
  })
})
