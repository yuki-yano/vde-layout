import { describe, expect, it, vi } from "vitest"

import { loadPackageVersion } from "./package-version"

type RequireLikeError = Error & {
  readonly code?: string
}

const moduleNotFound = (message: string): RequireLikeError => {
  const error = new Error(message) as RequireLikeError
  Object.assign(error, { code: "MODULE_NOT_FOUND" })
  return error
}

describe("loadPackageVersion", () => {
  it("prefers package.json in the current package directory", () => {
    const requireFn = vi.fn((path: string) => {
      if (path === "../package.json") {
        return { version: "1.2.3" }
      }
      throw moduleNotFound(`Cannot find module '${path}'`)
    })

    expect(loadPackageVersion(requireFn as unknown as NodeJS.Require)).toBe("1.2.3")
    expect(requireFn).toHaveBeenCalledTimes(1)
    expect(requireFn).toHaveBeenCalledWith("../package.json")
  })

  it("falls back to parent package path only when module is not found", () => {
    const requireFn = vi.fn((path: string) => {
      if (path === "../package.json") {
        throw moduleNotFound("Cannot find module '../package.json'")
      }
      if (path === "../../package.json") {
        return { version: "2.0.0" }
      }
      throw moduleNotFound(`Cannot find module '${path}'`)
    })

    expect(loadPackageVersion(requireFn as unknown as NodeJS.Require)).toBe("2.0.0")
    expect(requireFn).toHaveBeenCalledTimes(2)
    expect(requireFn).toHaveBeenNthCalledWith(1, "../package.json")
    expect(requireFn).toHaveBeenNthCalledWith(2, "../../package.json")
  })

  it("rethrows unexpected errors without swallowing them", () => {
    const syntaxError = new SyntaxError("Unexpected token")
    const requireFn = vi.fn(() => {
      throw syntaxError
    })

    expect(() => loadPackageVersion(requireFn as unknown as NodeJS.Require)).toThrow(syntaxError)
    expect(requireFn).toHaveBeenCalledTimes(1)
  })
})
