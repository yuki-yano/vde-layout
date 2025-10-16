export type ConfirmPaneClosureContext = {
  readonly panesToClose: ReadonlyArray<string>
  readonly dryRun: boolean
}

export type ConfirmPaneClosure = (context: ConfirmPaneClosureContext) => Promise<boolean>
