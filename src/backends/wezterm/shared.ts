import type { RunWeztermErrorContext, WeztermListResult } from "./cli"

export type PaneMap = Map<string, string>

export type ExecuteWeztermCommand = (
  args: ReadonlyArray<string>,
  errorContext: RunWeztermErrorContext,
) => Promise<string>

export type ListWeztermWindows = () => Promise<WeztermListResult>

export type LogPaneMapping = (virtualId: string, realId: string) => void
