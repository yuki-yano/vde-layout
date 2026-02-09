import { describe, expect, it } from "vitest"

type RuleEntry = {
  readonly files?: ReadonlyArray<string>
  readonly rules?: Readonly<Record<string, unknown>>
}

const loadEslintConfig = async (): Promise<ReadonlyArray<RuleEntry>> => {
  const specifier = new URL("../eslint.config.mjs", import.meta.url).href
  const module = (await import(specifier)) as { readonly default?: ReadonlyArray<RuleEntry> }
  return module.default ?? []
}

const findRuleEntry = async (filesPattern: string): Promise<RuleEntry | undefined> => {
  const eslintConfig = await loadEslintConfig()
  return eslintConfig.find((entry) => {
    return (
      Array.isArray(entry.files) &&
      entry.files.includes(filesPattern) &&
      typeof entry.rules?.["no-restricted-imports"] !== "undefined"
    )
  })
}

const extractRestrictedPatterns = async (filesPattern: string): Promise<ReadonlyArray<string>> => {
  const entry = await findRuleEntry(filesPattern)
  const noRestrictedImportsRule = entry?.rules?.["no-restricted-imports"]
  if (!Array.isArray(noRestrictedImportsRule) || noRestrictedImportsRule.length < 2) {
    return []
  }
  const options = noRestrictedImportsRule[1]
  if (typeof options !== "object" || options === null) {
    return []
  }
  const patterns = (options as { readonly patterns?: ReadonlyArray<unknown> }).patterns
  if (!Array.isArray(patterns)) {
    return []
  }

  const flattened: string[] = []
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      flattened.push(pattern)
      continue
    }

    if (typeof pattern === "object" && pattern !== null) {
      const group = (pattern as { readonly group?: ReadonlyArray<string> }).group
      if (Array.isArray(group)) {
        flattened.push(...group)
      }
    }
  }

  return flattened
}

describe("eslint import boundaries", () => {
  it("defines architectural restrictions for core layer", async () => {
    const patterns = await extractRestrictedPatterns("src/core/**/*.ts")
    expect(patterns).toContain("../executor/**")
    expect(patterns).toContain("../backends/**")
    expect(patterns).toContain("../cli/**")
    expect(patterns).toContain("../config/**")
  })

  it("defines architectural restrictions for executor layer", async () => {
    const patterns = await extractRestrictedPatterns("src/executor/**/*.ts")
    expect(patterns).toContain("../cli/**")
    expect(patterns).toContain("../config/**")
  })

  it("defines architectural restrictions for config layer", async () => {
    const patterns = await extractRestrictedPatterns("src/config/**/*.ts")
    expect(patterns).toContain("../executor/**")
    expect(patterns).toContain("../backends/**")
    expect(patterns).toContain("../cli/**")
  })

  it("defines architectural restrictions for backends layer", async () => {
    const patterns = await extractRestrictedPatterns("src/backends/**/*.ts")
    expect(patterns).toContain("../../cli/**")
    expect(patterns).toContain("../../config/**")
  })

  it("forbids legacy import paths globally", async () => {
    const patterns = await extractRestrictedPatterns("src/**/*.ts")
    expect(patterns).toContain("../tmux/**")
    expect(patterns).toContain("../wezterm/**")
    expect(patterns).toContain("./backends/**")
    expect(patterns).toContain("../executor/backends/**")
    expect(patterns).toContain("../types/**")
    expect(patterns).toContain("../../types/**")
  })
})
