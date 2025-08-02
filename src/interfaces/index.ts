import type { Preset, PresetInfo } from "../models/types"

/**
 * Interface for preset management
 */
export interface IPresetManager {
  loadConfig(): Promise<void>
  getPreset(name: string): Preset
  getDefaultPreset(): Preset
  listPresets(): PresetInfo[]
}

/**
 * Interface for configuration loading
 */
export interface IConfigLoader {
  loadYAML(): Promise<string>
}

/**
 * Interface for tmux command execution
 */
export interface ITmuxExecutor {
  verifyTmuxEnvironment(): Promise<void>
  execute(command: string | string[]): Promise<string>
  getCurrentSessionName(): Promise<string>
  isInTmuxSession(): boolean
  getCommandString(args: string[]): string
}

/**
 * Interface for tmux command generation
 */
export interface ITmuxCommandGenerator {
  newWindow(name?: string): string[]
  splitWindow(direction: "horizontal" | "vertical", targetPane?: string, percentage?: number): string[]
  sendKeys(paneId: string, command: string): string[]
  selectPane(paneId: string): string[]
  setPaneTitle(paneId: string, title: string): string[]
  changeDirectory(paneId: string, directory: string): string[]
  setEnvironment(paneId: string, env: Record<string, string>): string[][]
}

/**
 * Interface for layout engine
 */
export interface ILayoutEngine {
  createLayout(preset: Preset): Promise<void>
}

export type { ICommandExecutor } from "./command-executor"
