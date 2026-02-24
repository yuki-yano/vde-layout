export type PaneDimensions = {
  readonly cols: number
  readonly rows: number
}

export const updatePaneSizes = ({
  paneSizes,
  targetPaneId,
  createdPaneId,
  orientation,
  targetCells,
  createdCells,
}: {
  readonly paneSizes: Map<string, PaneDimensions>
  readonly targetPaneId: string
  readonly createdPaneId: string
  readonly orientation: "horizontal" | "vertical"
  readonly targetCells: number
  readonly createdCells: number
}): void => {
  const base = paneSizes.get(targetPaneId)
  if (base === undefined) {
    return
  }

  if (orientation === "horizontal") {
    paneSizes.set(targetPaneId, { cols: targetCells, rows: base.rows })
    paneSizes.set(createdPaneId, { cols: createdCells, rows: base.rows })
    return
  }

  paneSizes.set(targetPaneId, { cols: base.cols, rows: targetCells })
  paneSizes.set(createdPaneId, { cols: base.cols, rows: createdCells })
}
