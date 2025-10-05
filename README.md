# vde-layout

A CLI tool for easily reproducing tmux pane layouts

## Overview

vde-layout is a tool that allows you to define tmux pane layouts in YAML configuration files and reproduce them with a single command. You can manage multiple layouts as presets for different purposes such as development environments, monitoring, and test execution.

## Features

- Define layouts in YAML format
- Reproduce layouts with a single command
- Manage presets for different use cases
- Flexible pane settings (commands, working directories, environment variables, etc.)
- Freely combine horizontal and vertical splits

## Architecture

vde-layout follows a functional-core/imperative-shell approach:

- Functional Core compiles presets into immutable layout plans and deterministic tmux command sequences.
- CLI adapters reuse the same plan for dry-run and real execution, ensuring matching plan hashes.
- Plan Runner validates tmux prerequisites, applies each plan step, and reports structured diagnostics when a step fails.

This separation allows the Functional Core to remain pure and fully testable while the boundary layer coordinates I/O with tmux.

## Development Notes

- Import Functional Core modules via the `@/core` alias (`tsconfig.json` exposes `@/core/*`). The legacy `src/functional-core` path is a thin re-export kept for compatibility.
- Boundary adapters (`src/cli`, `src/executor`, `src/tmux`) are implemented as factory functions; avoid introducing new classes in these layers.
- Run `npm run typecheck` and `npm test` before sending changes. Vitest is configured with the same path aliases as the TypeScript compiler.

## Installation

```bash
npm install -g vde-layout
```

or

```bash
pnpm add -g vde-layout
```

or

```bash
bun add -g vde-layout
```

## Usage

### Creating a Configuration File

Create a configuration file at `~/.config/vde/layout.yml`:

```yaml
presets:
  # Development environment layout
  dev:
    name: Development Environment
    description: 3-pane configuration with editor, server, and log monitoring
    layout:
      type: horizontal
      ratio: [3, 2]  # 60:40 ratio (automatically normalized)
      panes:
        - name: editor
          command: nvim
          focus: true
        - type: vertical
          ratio: [7, 3]  # 70:30 ratio
          panes:
            - name: server
              command: npm run dev
            - name: logs
              command: tail -f logs/app.log

  # Simple 2-pane layout
  simple:
    name: Simple Layout
    description: 2-pane configuration with editor and terminal
    layout:
      type: vertical
      ratio: [7, 3]  # 70:30 ratio
      panes:
        - name: editor
          command: vim
        - name: terminal
          # Omitting command launches the default shell

  # Single pane preset (without layout)
  monitor:
    name: System Monitor
    description: System monitoring tool
    command: htop
```

### Commands

#### List Presets

```bash
vde-layout list
```

#### Execute a Preset

```bash
# Execute a specific preset
vde-layout dev

# Execute the default preset
vde-layout
```

#### Options

```bash
# dry-run mode (doesn't actually execute)
vde-layout dev --dry-run

# Show verbose logs
vde-layout dev --verbose

# Show help
vde-layout --help
```

## Configuration File Structure

### Presets

Each preset is defined as an object with the following fields:

```yaml
presets:
  preset-name:
    name: "Preset Name"         # Required
    description: "Description"  # Optional
    layout:                     # Optional (single pane when omitted)
      # Layout definition
    command: "Command"          # Optional (only when layout is absent)
```

### Layout Definition

Layouts define horizontal or vertical splits:

```yaml
layout:
  type: horizontal              # horizontal or vertical
  ratio: [3, 2]                # Split ratio (automatically normalized)
  panes:                       # Array of panes
    - name: "Pane Name"        # Required (for pane identification)
      command: "Command"       # Optional (default shell when omitted)
      cwd: "~/project"         # Working directory (optional)
      env:                     # Environment variables (optional)
        NODE_ENV: development
      focus: true              # Focus setting (optional)
    # Or nested layout
    - type: vertical
      ratio: [1, 1]
      panes:
        - name: "Child Pane 1"
        - name: "Child Pane 2"
```

### Automatic Ratio Normalization

You can specify any positive numbers for ratio, which are automatically normalized to 100%:

- `[1, 1]` → `[50, 50]` (50% each)
- `[2, 3]` → `[40, 60]` (40%, 60%)
- `[1, 2, 1]` → `[25, 50, 25]` (25%, 50%, 25%)

### Single Pane Presets

When layout is omitted, it operates as a single pane:

```yaml
presets:
  simple-command:
    name: "Single Command"
    command: "htop"            # Execute a single command

  default-shell:
    name: "Default Shell"
    # Omitting command also launches the default shell
```

### Environment Variables

The configuration file location can be changed using environment variables:

- `XDG_CONFIG_HOME`: Follows the XDG Base Directory specification
- `VDE_CONFIG_PATH`: Directly specify the configuration file directory

## Requirements

- Node.js 22 or higher
- tmux 2.0 or higher
- Must be executed within a tmux session

## License

MIT

## Contributing

Please submit bug reports and feature requests to [GitHub Issues](https://github.com/yuki-yano/vde-layout/issues).
