import { describe, expect, it } from "vitest"

type RuleEntry = {
  readonly files?: ReadonlyArray<string>
  readonly rules?: Readonly<Record<string, unknown>>
}

const loadEslintConfig = async (): Promise<ReadonlyArray<RuleEntry>> => {
  const specifier = new URL("../../eslint.config.mjs", import.meta.url).href
  const module = (await import(specifier)) as { readonly default?: ReadonlyArray<RuleEntry> }
  return module.default ?? []
}

const extractRelativeTsImportPatterns = async (): Promise<ReadonlyArray<string>> => {
  const config = await loadEslintConfig()
  const entry = config.find((candidate) => {
    return typeof candidate.rules?.["no-restricted-imports"] !== "undefined"
  })

  const noRestrictedImports = entry?.rules?.["no-restricted-imports"]
  if (!Array.isArray(noRestrictedImports) || noRestrictedImports.length < 2) {
    return []
  }

  const options = noRestrictedImports[1]
  if (typeof options !== "object" || options === null) {
    return []
  }

  const patterns = (options as { readonly patterns?: ReadonlyArray<unknown> }).patterns
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return []
  }

  const first = patterns[0]
  if (typeof first !== "object" || first === null) {
    return []
  }

  const group = (first as { readonly group?: ReadonlyArray<string> }).group
  return Array.isArray(group) ? group : []
}

describe("eslint import extension restriction", () => {
  it("uses depth-agnostic patterns for relative .ts imports", async () => {
    const patterns = await extractRelativeTsImportPatterns()
    expect(patterns).toEqual(["./**/*.ts", "../**/*.ts"])
  })
})
