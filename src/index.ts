#!/usr/bin/env node
import { createCli } from "./cli/index.ts"

/**
 * Main entry point
 * Launches the CLI application
 */
const main = async (): Promise<void> => {
  const cli = createCli()
  try {
    // Pass arguments excluding the first two elements (node, script path) from process.argv
    await cli.run(process.argv.slice(2))
  } catch (error) {
    // Format and display error message appropriately
    if (error instanceof Error) {
      console.error("Error:", error.message)

      // Also display stack trace in debug mode
      if (process.env.VDE_DEBUG === "true") {
        console.error(error.stack)
      }
    } else {
      console.error("An unexpected error occurred:", String(error))
    }

    process.exit(1)
  }
}

// Execute immediately
void main()
