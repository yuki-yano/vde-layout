import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { compilePresetFromValue, createLayoutPlan, emitPlan } from "./index"

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), "utf8"))

describe("core plan golden parity", () => {
  it.each([
    ["core-plan-input.json", "core-plan-golden.json"],
    ["core-complex-input.json", "core-complex-golden.json"],
    ["core-single-input.json", "core-single-golden.json"],
  ])("keeps %s as a TypeScript migration golden", (inputName, goldenName) => {
    const value = readFixture(inputName)
    const expected = readFixture(goldenName)
    const { preset } = compilePresetFromValue({ value, source: `tests/fixtures/${inputName}` })
    const { plan } = createLayoutPlan({ preset })
    const emission = emitPlan({ plan })

    expect({
      plan,
      emission: {
        steps: emission.steps,
        summary: emission.summary,
        terminals: emission.terminals,
      },
    }).toEqual(expected)
  })
})
