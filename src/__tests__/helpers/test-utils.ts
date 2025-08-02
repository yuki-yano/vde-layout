import { afterEach, vi, type MockInstance } from "vitest"
import type { Config, Preset, Layout, Pane } from "../../models/types"

// Mock environment variable cleanup
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

// Console mocking utilities
export interface ConsoleCapture {
  output: string[]
  errors: string[]
  logSpy: MockInstance
  errorSpy: MockInstance
  warnSpy: MockInstance
}

export const captureConsole = (): ConsoleCapture => {
  const output: string[] = []
  const errors: string[] = []

  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    output.push(args.join(" "))
  })

  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.join(" "))
  })

  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
    output.push(args.join(" "))
  })

  return { output, errors, logSpy, errorSpy, warnSpy }
}

// Sample data builders for testing
export const createMockConfig = (overrides?: Partial<Config>): Config => ({
  presets: {
    default: createMockPreset({ name: "Default Layout" }),
    development: createMockPreset({ name: "Development Layout" }),
  },
  ...overrides,
})

export const createMockPreset = (overrides?: Partial<Preset>): Preset => ({
  name: "Test Preset",
  description: "A test preset",
  layout: createMockLayout(),
  ...overrides,
})

export const createMockLayout = (overrides?: Partial<Layout>): Layout => ({
  type: "horizontal",
  ratio: [50, 50],
  panes: [createMockPane({ name: "pane1" }), createMockPane({ name: "pane2" })],
  ...overrides,
})

export const createMockPane = (overrides?: Partial<Pane>): Pane => ({
  name: "test-pane",
  command: 'echo "test"',
  ...overrides,
})
