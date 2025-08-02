import type { ILayoutEngine } from "../../interfaces"
import type { Preset } from "../../models/types"

export class MockLayoutEngine implements ILayoutEngine {
  private createdLayouts: Preset[] = []

  async createLayout(preset: Preset): Promise<void> {
    this.createdLayouts.push(preset)
  }

  // Test helper methods
  getCreatedLayouts(): Preset[] {
    return this.createdLayouts
  }

  clearCreatedLayouts(): void {
    this.createdLayouts = []
  }
}
