# vde-layout

vde-layout is a CLI that reproduces tmux pane layouts from YAML presets. Define the panes you need once, then bring them back with a single command.

## Key Capabilities
- Keep reusable presets for development, monitoring, reviews, and more.
- Build nested horizontal/vertical splits with ratio-based sizing.
- Launch commands in each pane with custom working directories, environment variables, delays, and titles.
- Preview every tmux step in dry-run mode before you apply a preset.
- Switch between configuration files by flag or environment variables.

## Installation
```bash
npm install -g vde-layout
# or
pnpm add -g vde-layout
# or
bun add -g vde-layout
```

## Quick Start
1. Create a YAML file at `~/.config/vde/layout.yml` (or any supported location; see “Configuration Search Order”).
2. Paste a preset definition:
   ```yaml
   presets:
     web-dev:
       name: Web Development
       description: Editor, server, and logs
       layout:
         type: horizontal
         ratio: [3, 2]
         panes:
           - name: editor
             command: nvim
             focus: true
           - type: vertical
             ratio: [7, 3]
             panes:
               - name: server
                 command: npm run dev
                 cwd: ~/projects/app
                 env:
                   NODE_ENV: development
               - name: logs
                 command: tail -f logs/app.log
                 title: Logs
                 delay: 500
     monitor:
       name: Monitor
       command: htop
   ```
3. Start tmux and run:
   ```bash
   vde-layout web-dev
   ```

## CLI Commands
- `vde-layout [preset]` – Apply the named preset. When omitted, vde-layout uses the `default` preset; if none exists it lists available presets and exits.
- `vde-layout list` – Show available presets with descriptions.
- `vde-layout dev --dry-run` – Display the tmux steps without executing them.
- `vde-layout dev --verbose` – Print informational logs, including resolved presets and plan details.
- `vde-layout dev --current-window` – Reuse the current tmux window after confirming that other panes can be closed.
- `vde-layout dev --new-window` – Force creation of a new tmux window even when presets or defaults request reuse.
- `vde-layout --config /path/to/layout.yml` – Load presets from a specific file.
- `vde-layout --help` – Show usage.
- `vde-layout --version` / `vde-layout -v` – Print package version (`-V` is kept for compatibility).

> **Note:** Applying a preset (without `--dry-run`) must be done inside an active tmux session.

## Configuration Search Order
When no `--config` flag is provided, vde-layout searches for configuration files in the following order:
1. `$VDE_CONFIG_PATH/layout.yml` (if `VDE_CONFIG_PATH` is set).
2. `$XDG_CONFIG_HOME/vde/layout.yml` or `~/.config/vde/layout.yml` when `XDG_CONFIG_HOME` is unset.
3. `<project-root>/.vde/layout.yml` (discovered by walking up from the current directory).

All existing files are merged, with project-specific definitions taking precedence over shared ones.

## Preset Structure
Each preset is an object under the `presets` key:
```yaml
presets:
  preset-key:
    name: "Display Name"        # required
    description: "Summary"      # optional
    windowMode: new-window       # optional; "new-window" (default) or "current-window"
    layout:                     # optional; omit for single command presets
      # see Layout Structure
    command: "htop"             # optional; used when layout is omitted
```

### Layout Structure
```yaml
layout:
  type: horizontal | vertical   # required
  ratio: [3, 2, ...]            # required; positive numbers, auto-normalized
  panes:                        # required
    - name: "left"              # required for terminal panes
      command: "npm run start"  # optional
      cwd: "~/project"          # optional
      env:                      # optional
        API_BASE_URL: http://localhost:3000
      focus: true               # optional; only one pane should be true
      delay: 500                # optional; wait (ms) before running command
      title: "Server"           # optional; tmux pane title
    - type: vertical            # nested split
      ratio: [1, 1]
      panes:
        - name: "tests"
        - name: "shell"
```

### Ratio Normalization
Ratios can be any set of positive integers. vde-layout normalizes them to percentages:
- `[1, 1]` → `[50, 50]`
- `[2, 3]` → `[40, 60]`
- `[1, 2, 1]` → `[25, 50, 25]`

### Single Command Presets
If you omit `layout`, the preset runs a single command in one pane (or opens the default shell when `command` is omitted):
```yaml
presets:
  shell:
    name: Default Shell
  build:
    name: Build Script
    command: npm run build
```

### Window Mode Selection
- `defaults.windowMode` sets the default behavior for presets that omit `windowMode`. Allowed values are `new-window` (default) and `current-window`.
- Each preset may override the default by specifying its own `windowMode`.
- CLI flags (`--current-window` / `--new-window`) take highest precedence and override both presets and defaults.
- When `current-window` mode is used during an actual run, vde-layout prompts for confirmation before closing panes other than the pane running the command. Dry-run mode prints the intended closures without prompting.


## Runtime Behavior
- Dry-run mode prints every tmux command and preserves the execution order you would see in a real run.
- Applying a preset creates (or reuses) a tmux window, splits panes according to the plan, sets environment variables, changes directories, and runs commands sequentially.
- If an error occurs (for example, a tmux command fails or the configuration is invalid), vde-layout returns a structured error with the failing step and guidance.

## Environment Variables
- `VDE_CONFIG_PATH` – Override the base directory for configuration files.
- `XDG_CONFIG_HOME` – XDG base directory root; defaults to `~/.config` when unset.
- `VDE_DEBUG=true` – Enable debug-level logs (includes stack traces).
- `VDE_VERBOSE=true` – Enable info-level logs without full debug output.
- `TMUX` – Automatically set by tmux. vde-layout checks this to ensure execution happens inside a session.

## Requirements
- Node.js 22 or higher
- tmux 2.0 or higher

## Contributing
Please submit bug reports and feature requests through [GitHub Issues](https://github.com/yuki-yano/vde-layout/issues).

## License
MIT
