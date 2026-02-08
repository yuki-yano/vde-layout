import { describe, expect, it } from "vitest"

import type { EmittedTerminal } from "../core/emitter"
import type { TemplateTokenError } from "../utils/template-tokens"
import { prepareTerminalCommands } from "./terminal-command-preparation"

const createResolvePaneId = (paneMap: Readonly<Record<string, string>>) => {
  return (virtualPaneId: string): string => {
    const realPaneId = paneMap[virtualPaneId]
    if (typeof realPaneId !== "string" || realPaneId.length === 0) {
      throw new Error(`Unknown pane: ${virtualPaneId}`)
    }
    return realPaneId
  }
}

describe("prepareTerminalCommands", () => {
  it("prepares cwd/env/title/command with token replacement", () => {
    const terminals: ReadonlyArray<EmittedTerminal> = [
      {
        virtualPaneId: "root.0",
        cwd: '/workspace/"project"',
        env: { NODE_ENV: "test", QUOTED: 'a"b' },
        command: "nvim",
        focus: true,
        name: "main",
        title: "Main Pane",
      },
      {
        virtualPaneId: "root.1",
        cwd: undefined,
        env: undefined,
        command: "echo {{pane_id:main}} {{this_pane}} {{focus_pane}}",
        focus: false,
        name: "aux",
      },
    ]

    const prepared = prepareTerminalCommands({
      terminals,
      focusPaneVirtualId: "root.0",
      resolveRealPaneId: createResolvePaneId({
        "root.0": "%0",
        "root.1": "%1",
      }),
      onTemplateTokenError: ({ error }): never => {
        throw error
      },
    })

    expect(prepared.focusPaneRealId).toBe("%0")
    expect(prepared.commands).toHaveLength(2)

    expect(prepared.commands[0]).toEqual({
      terminal: terminals[0],
      realPaneId: "%0",
      cwdCommand: 'cd "/workspace/\\"project\\""',
      envCommands: [
        { key: "NODE_ENV", command: 'export NODE_ENV="test"' },
        { key: "QUOTED", command: 'export QUOTED="a\\"b"' },
      ],
      title: "Main Pane",
      command: { text: "nvim", delayMs: 0 },
    })
    expect(prepared.commands[1]?.command?.text).toBe("echo %0 %1 %0")
  })

  it("applies ephemeral behavior and delay values", () => {
    const terminals: ReadonlyArray<EmittedTerminal> = [
      {
        virtualPaneId: "root.0",
        cwd: undefined,
        env: undefined,
        command: "npm test",
        focus: true,
        name: "runner",
        ephemeral: true,
        closeOnError: false,
        delay: 250,
      },
      {
        virtualPaneId: "root.1",
        cwd: undefined,
        env: undefined,
        command: "npm run build",
        focus: false,
        name: "builder",
        ephemeral: true,
        closeOnError: true,
        delay: -10,
      },
    ]

    const prepared = prepareTerminalCommands({
      terminals,
      focusPaneVirtualId: "root.0",
      resolveRealPaneId: createResolvePaneId({
        "root.0": "%0",
        "root.1": "%1",
      }),
      onTemplateTokenError: ({ error }): never => {
        throw error
      },
    })

    expect(prepared.commands[0]?.command).toEqual({
      text: "npm test; [ $? -eq 0 ] && exit",
      delayMs: 250,
    })
    expect(prepared.commands[1]?.command).toEqual({
      text: "npm run build; exit",
      delayMs: 0,
    })
  })

  it("validates focus pane even when focus token is not used", () => {
    const terminals: ReadonlyArray<EmittedTerminal> = [
      {
        virtualPaneId: "root.0",
        cwd: undefined,
        env: undefined,
        command: "echo hello",
        focus: true,
        name: "main",
      },
    ]

    expect(() =>
      prepareTerminalCommands({
        terminals,
        focusPaneVirtualId: "root.missing",
        resolveRealPaneId: createResolvePaneId({
          "root.0": "%0",
        }),
        onTemplateTokenError: ({ error }): never => {
          throw error
        },
      }),
    ).toThrow("Unknown pane: root.missing")
  })

  it("delegates template token errors to the provided mapper", () => {
    const terminals: ReadonlyArray<EmittedTerminal> = [
      {
        virtualPaneId: "root.0",
        cwd: undefined,
        env: undefined,
        command: "echo {{pane_id:missing}}",
        focus: true,
        name: "main",
      },
    ]

    expect(() =>
      prepareTerminalCommands({
        terminals,
        focusPaneVirtualId: "root.0",
        resolveRealPaneId: createResolvePaneId({
          "root.0": "%0",
        }),
        onTemplateTokenError: ({ terminal, error }): never => {
          const typedError = error as TemplateTokenError
          throw new Error(`${terminal.virtualPaneId}:${typedError.tokenType}`)
        },
      }),
    ).toThrow("root.0:pane_id")
  })
})
