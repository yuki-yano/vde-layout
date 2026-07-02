import { execa } from "execa"
import { replaceTemplateTokens, TemplateTokenError } from "../utils/template-tokens"
import type { Logger } from "../utils/logger"

export type RunHostCommand = (command: string, options: { readonly cwd: string }) => Promise<void>

export type AfterApplyHookContext = {
  readonly cwd: string
  readonly focusPaneId?: string
  readonly paneNameToRealId?: ReadonlyMap<string, string>
}

type RunAfterApplyHookInput = {
  readonly hookCommand: string | undefined
  readonly context: AfterApplyHookContext
  readonly logger: Logger
  readonly runHostCommand?: RunHostCommand
}

// Matches the {{this_pane}}/{{focus_pane}} tokens that this module resolves to
// context.focusPaneId (see the comment below on why they share one value).
const FOCUS_PANE_TOKEN_PATTERN = /\{\{(?:this_pane|focus_pane)\}\}/

/**
 * Runs the `hooks.afterApply` preset command once, after a preset has been applied
 * successfully. Failures (token resolution or command execution) are logged as
 * warnings and never rejected/thrown, so they cannot affect the CLI's exit code -
 * the preset apply itself has already succeeded by the time this runs.
 */
export const runAfterApplyHook = async ({
  hookCommand,
  context,
  logger,
  runHostCommand = createDefaultRunHostCommand(),
}: RunAfterApplyHookInput): Promise<void> => {
  if (typeof hookCommand !== "string" || hookCommand.length === 0) {
    return
  }

  // {{this_pane}}/{{focus_pane}} resolve to context.focusPaneId (see the comment
  // below), but replaceTemplateTokens substitutes them verbatim even when given an
  // empty string - it only validates {{pane_id:<name>}} lookups. Treat a missing
  // focus pane id as an unresolved token here too, rather than silently running the
  // command with an empty pane id spliced in.
  if (context.focusPaneId === undefined && FOCUS_PANE_TOKEN_PATTERN.test(hookCommand)) {
    logger.warn(
      "hooks.afterApply skipped: failed to resolve template tokens ({{this_pane}}/{{focus_pane}} require a focus pane id, but none was available)",
    )
    return
  }

  let resolvedCommand: string
  try {
    resolvedCommand = replaceTemplateTokens({
      command: hookCommand,
      // A host-level hook is not "sent" to any particular tmux/wezterm pane the way
      // a terminal pane command is, so there is no distinct "current pane" for it.
      // The pane that ends up focused after the layout was applied is the closest
      // analogue, so {{this_pane}} and {{focus_pane}} intentionally resolve to the
      // same value here.
      currentPaneRealId: context.focusPaneId ?? "",
      focusPaneRealId: context.focusPaneId ?? "",
      nameToRealIdMap: context.paneNameToRealId ?? new Map<string, string>(),
    })
  } catch (error) {
    const reason = error instanceof TemplateTokenError ? error.message : String(error)
    logger.warn(`hooks.afterApply skipped: failed to resolve template tokens (${reason})`)
    return
  }

  // Mirrors real-executor.ts's "Executing: <command>" log; logger.info is already
  // gated on --verbose/VDE_VERBOSE by the shared logger implementation.
  logger.info(`Executing: ${resolvedCommand}`)

  try {
    await runHostCommand(resolvedCommand, { cwd: context.cwd })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn(`hooks.afterApply failed: ${reason}`)
  }
}

/**
 * Executes the resolved hook command through the host shell (equivalent to
 * `sh -c <command>`), rather than splitting it into argv the way tmux commands
 * are executed. hooks.afterApply commands are user-authored, free-form shell
 * text (e.g. "vde-tmux-sidebar open {{pane_id:sidebar}} | logger") that may rely
 * on pipes, redirection, or shell expansion, so argv-style execution would break
 * common use cases.
 */
export const createDefaultRunHostCommand = (): RunHostCommand => {
  return async (command, { cwd }) => {
    await execa(command, { shell: true, cwd })
  }
}
