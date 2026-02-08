import type { EmittedTerminal } from "../core/emitter"
import { buildNameToRealIdMap, replaceTemplateTokens, TemplateTokenError } from "../utils/template-tokens"

export type TemplateTokenErrorContext = {
  readonly terminal: EmittedTerminal
  readonly error: TemplateTokenError
}

type PrepareTerminalCommandsInput = {
  readonly terminals: ReadonlyArray<EmittedTerminal>
  readonly focusPaneVirtualId: string
  readonly resolveRealPaneId: (virtualPaneId: string) => string
  readonly onTemplateTokenError: (context: TemplateTokenErrorContext) => never
}

export type PreparedTerminalCommand = {
  readonly terminal: EmittedTerminal
  readonly realPaneId: string
  readonly cwdCommand?: string
  readonly envCommands: ReadonlyArray<{
    readonly key: string
    readonly command: string
  }>
  readonly title?: string
  readonly command?: {
    readonly text: string
    readonly delayMs: number
  }
}

export type PreparedTerminalCommands = {
  readonly focusPaneRealId: string
  readonly commands: ReadonlyArray<PreparedTerminalCommand>
}

const SINGLE_QUOTE = "'"
const SHELL_SINGLE_QUOTE_ESCAPE = `'"'"'`
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const shellQuoteLiteral = (value: string): string => {
  return `'${value.split(SINGLE_QUOTE).join(SHELL_SINGLE_QUOTE_ESCAPE)}'`
}

const assertValidEnvKey = (key: string): void => {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`)
  }
}

const normalizeDelay = (delay: unknown): number => {
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? delay : 0
}

const applyEphemeralSuffix = (command: string, terminal: EmittedTerminal): string => {
  if (terminal.ephemeral !== true) {
    return command
  }

  return terminal.closeOnError === true ? `${command}; exit` : `${command}; [ $? -eq 0 ] && exit`
}

export const prepareTerminalCommands = ({
  terminals,
  focusPaneVirtualId,
  resolveRealPaneId,
  onTemplateTokenError,
}: PrepareTerminalCommandsInput): PreparedTerminalCommands => {
  const paneMap = new Map<string, string>()
  for (const terminal of terminals) {
    paneMap.set(terminal.virtualPaneId, resolveRealPaneId(terminal.virtualPaneId))
  }

  const focusPaneRealId = paneMap.get(focusPaneVirtualId) ?? resolveRealPaneId(focusPaneVirtualId)
  const nameToRealIdMap = buildNameToRealIdMap(terminals, paneMap)

  const commands: PreparedTerminalCommand[] = terminals.map((terminal) => {
    const realPaneId = paneMap.get(terminal.virtualPaneId)
    if (realPaneId === undefined) {
      throw new Error(`Unknown pane: ${terminal.virtualPaneId}`)
    }

    const cwdCommand =
      typeof terminal.cwd === "string" && terminal.cwd.length > 0
        ? `cd -- ${shellQuoteLiteral(terminal.cwd)}`
        : undefined

    const envCommands =
      terminal.env === undefined
        ? []
        : Object.entries(terminal.env).map(([key, value]) => {
            assertValidEnvKey(key)
            return {
              key,
              command: `export ${key}=${shellQuoteLiteral(String(value))}`,
            }
          })

    const title = typeof terminal.title === "string" && terminal.title.length > 0 ? terminal.title : undefined

    let command:
      | {
          readonly text: string
          readonly delayMs: number
        }
      | undefined

    if (typeof terminal.command === "string" && terminal.command.length > 0) {
      try {
        const commandUsesFocusToken = terminal.command.includes("{{focus_pane}}")
        const replaced = replaceTemplateTokens({
          command: terminal.command,
          currentPaneRealId: realPaneId,
          focusPaneRealId: commandUsesFocusToken ? focusPaneRealId : "",
          nameToRealIdMap,
        })

        command = {
          text: applyEphemeralSuffix(replaced, terminal),
          delayMs: normalizeDelay(terminal.delay),
        }
      } catch (error) {
        if (error instanceof TemplateTokenError) {
          return onTemplateTokenError({ terminal, error })
        }
        throw error
      }
    }

    return {
      terminal,
      realPaneId,
      cwdCommand,
      envCommands,
      title,
      command,
    }
  })

  return {
    focusPaneRealId,
    commands,
  }
}
