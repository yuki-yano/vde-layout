import { describe, expect, it } from "vitest"
import { replaceTemplateTokens, buildNameToRealIdMap } from "../template-tokens.ts"
import type { EmittedTerminal } from "../../core/emitter.ts"

describe("replaceTemplateTokens", () => {
  it("should replace {{this_pane}} with current pane ID", () => {
    const result = replaceTemplateTokens({
      command: 'echo "Current pane: {{this_pane}}"',
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap: new Map(),
    })
    expect(result).toBe('echo "Current pane: %1"')
  })

  it("should replace {{focus_pane}} with focus pane ID", () => {
    const result = replaceTemplateTokens({
      command: 'tmux select-pane -t {{focus_pane}}',
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap: new Map(),
    })
    expect(result).toBe("tmux select-pane -t %2")
  })

  it("should replace {{pane_id:<name>}} with corresponding pane ID", () => {
    const nameToRealIdMap = new Map([
      ["editor", "%3"],
      ["terminal", "%4"],
    ])
    const result = replaceTemplateTokens({
      command: 'tmux send-keys -t {{pane_id:editor}} "test"',
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap,
    })
    expect(result).toBe('tmux send-keys -t %3 "test"')
  })

  it("should replace multiple template tokens in one command", () => {
    const nameToRealIdMap = new Map([
      ["editor", "%3"],
      ["terminal", "%4"],
    ])
    const result = replaceTemplateTokens({
      command: 'echo "This: {{this_pane}}, Focus: {{focus_pane}}, Editor: {{pane_id:editor}}"',
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap,
    })
    expect(result).toBe('echo "This: %1, Focus: %2, Editor: %3"')
  })

  it("should replace the same token multiple times", () => {
    const result = replaceTemplateTokens({
      command: "{{this_pane}} and {{this_pane}} again",
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap: new Map(),
    })
    expect(result).toBe("%1 and %1 again")
  })

  it("should handle commands with no template tokens", () => {
    const result = replaceTemplateTokens({
      command: "echo 'Hello, world!'",
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap: new Map(),
    })
    expect(result).toBe("echo 'Hello, world!'")
  })

  it("should throw error when referencing non-existent pane name", () => {
    const nameToRealIdMap = new Map([["editor", "%3"]])
    expect(() => {
      replaceTemplateTokens({
        command: 'tmux send-keys -t {{pane_id:nonexistent}} "test"',
        currentPaneRealId: "%1",
        focusPaneRealId: "%2",
        nameToRealIdMap,
      })
    }).toThrow(/pane name "nonexistent" not found/)
  })

  it("should trim whitespace in pane names", () => {
    const nameToRealIdMap = new Map([["editor", "%3"]])
    const result = replaceTemplateTokens({
      command: "{{pane_id: editor }}",
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap,
    })
    expect(result).toBe("%3")
  })

  it("should handle pane names with special characters", () => {
    const nameToRealIdMap = new Map([["my-editor-pane", "%3"]])
    const result = replaceTemplateTokens({
      command: "{{pane_id:my-editor-pane}}",
      currentPaneRealId: "%1",
      focusPaneRealId: "%2",
      nameToRealIdMap,
    })
    expect(result).toBe("%3")
  })
})

describe("buildNameToRealIdMap", () => {
  it("should build correct mapping from terminals and paneMap", () => {
    const terminals: EmittedTerminal[] = [
      {
        virtualPaneId: "root.0",
        name: "editor",
        command: "vim",
        focus: false,
      },
      {
        virtualPaneId: "root.1",
        name: "terminal",
        command: "bash",
        focus: true,
      },
    ]
    const paneMap = new Map([
      ["root.0", "%1"],
      ["root.1", "%2"],
    ])

    const result = buildNameToRealIdMap(terminals, paneMap)

    expect(result.get("editor")).toBe("%1")
    expect(result.get("terminal")).toBe("%2")
  })

  it("should handle terminals with no real pane ID mapping", () => {
    const terminals: EmittedTerminal[] = [
      {
        virtualPaneId: "root.0",
        name: "editor",
        command: "vim",
        focus: false,
      },
    ]
    const paneMap = new Map([["root.1", "%2"]])

    const result = buildNameToRealIdMap(terminals, paneMap)

    expect(result.has("editor")).toBe(false)
  })

  it("should handle empty terminals array", () => {
    const terminals: EmittedTerminal[] = []
    const paneMap = new Map([["root.0", "%1"]])

    const result = buildNameToRealIdMap(terminals, paneMap)

    expect(result.size).toBe(0)
  })

  it("should handle multiple terminals with same name (last one wins)", () => {
    const terminals: EmittedTerminal[] = [
      {
        virtualPaneId: "root.0",
        name: "editor",
        command: "vim",
        focus: false,
      },
      {
        virtualPaneId: "root.1",
        name: "editor",
        command: "nvim",
        focus: false,
      },
    ]
    const paneMap = new Map([
      ["root.0", "%1"],
      ["root.1", "%2"],
    ])

    const result = buildNameToRealIdMap(terminals, paneMap)

    // Last one wins
    expect(result.get("editor")).toBe("%2")
    expect(result.size).toBe(1)
  })
})
