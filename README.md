# vde-layout

vde-layout is a CLI that reproduces terminal layouts (tmux or WezTerm) from YAML presets. Define the panes you need once, then bring them back with a single command.

## Key Capabilities
- Keep reusable presets for development, monitoring, reviews, and more.
- Build nested horizontal/vertical splits with ratio-based sizing.
- Launch commands in each pane with custom working directories, environment variables, delays, and titles.
- Preview every tmux step in dry-run mode before you apply a preset.
- Target tmux or WezTerm backends with the same preset definitions.
- Switch between configuration files by flag or environment variables.

## Installation
```bash
npm install -g vde-layout
# or
pnpm add -g vde-layout
```

## Development
```bash
pnpm install
pnpm run build
pnpm run format:check
pnpm run typecheck
pnpm run lint
pnpm run test
# run all checks in sequence
pnpm run ci
```

## Quick Start
1. Create a YAML file at `~/.config/vde/layout/config.yml` (legacy `~/.config/vde/layout.yml` is also supported; see "Configuration Search Order").
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
- `vde-layout [preset]` - Apply the named preset. When omitted, vde-layout uses the `default` preset; if none exists it lists available presets and exits.
- `vde-layout list` - Show available presets with descriptions.
- `vde-layout --select` - Open an interactive preset selector (auto mode; currently uses `fzf`).
- `vde-layout --select --select-ui fzf` - Force the selector backend (`auto` or `fzf`).
- `vde-layout --select --select-surface tmux-popup` - Render selector in a tmux popup (`fzf --tmux`).
- `vde-layout --select --select-tmux-popup-opts "80%,70%"` - Pass popup sizing/placement to `fzf --tmux=<opts>`.
- `vde-layout --select --fzf-arg "--cycle" --fzf-arg "--info=inline"` - Pass additional argument(s) to `fzf` (repeatable).
- `vde-layout dev --dry-run` - Display the tmux steps without executing them.
- `vde-layout dev --verbose` - Print informational logs, including resolved presets and plan details.
- `vde-layout dev --backend wezterm` - Use the WezTerm backend (defaults to `tmux` when omitted).
- `vde-layout dev --current-window` - Reuse the current tmux window (or active WezTerm tab) after confirming that other panes can be closed.
- `vde-layout dev --new-window` - Force creation of a new tmux window or WezTerm tab even when presets or defaults request reuse.
- `vde-layout --config /path/to/config.yml` - Load presets from a specific file.
- `vde-layout --help` - Show usage.
- `vde-layout --version` / `vde-layout -v` - Print package version.

> **Note:** Applying a preset (without `--dry-run`) must be done inside an active tmux session when using the tmux backend. For the WezTerm backend, ensure a WezTerm window is running and focused so the CLI can discover it.
>
> **Selector UI note:** `--select` requires an interactive terminal and `fzf` on `$PATH`. `--select-surface tmux-popup` requires running inside tmux (`fzf --tmux`, tmux 3.3+ recommended).

## Terminal Backends
vde-layout resolves backends in the following order: CLI flag (`--backend`), preset configuration, then defaults to `tmux`.

- **tmux (default)** - Requires an active tmux session for non-dry runs. `--current-window` closes other panes in the selected window after confirmation; `--new-window` always creates a new tmux window.
- **WezTerm** - Requires the `wezterm` CLI to be available (nightly channel recommended). Start WezTerm beforehand so at least one window exists.  
  - `--current-window` targets the active tab and confirms before closing other panes.  
  - `--new-window` spawns a new tab in the active window when one is available, otherwise creates a fresh window.

## Configuration Search Order
When no `--config` flag is provided, vde-layout checks candidate files in this order for `findConfigFile()`:
1. Project scope discovered by walking up from the current directory; for each directory, vde-layout checks `.vde/layout/config.yml` first, then `.vde/layout.yml`.
2. `$VDE_CONFIG_PATH/layout.yml` (if `VDE_CONFIG_PATH` is set).
3. `$XDG_CONFIG_HOME/vde/layout/config.yml` (or `~/.config/vde/layout/config.yml` when `XDG_CONFIG_HOME` is unset).
4. `$XDG_CONFIG_HOME/vde/layout.yml` fallback (or `~/.config/vde/layout.yml`).

For `loadConfig()`, vde-layout merges shared scopes first and project scope last:
1. `$VDE_CONFIG_PATH/layout.yml`
2. XDG scope (`.../vde/layout/config.yml` or fallback `.../vde/layout.yml`; first existing file only)
3. Project scope (`<project-root>/.vde/layout/config.yml` or fallback `<project-root>/.vde/layout.yml`, discovered by walking up from the current directory)

## Preset Structure
Each preset is an object under the `presets` key:
```yaml
presets:
  preset-key:
    name: "Display Name"        # required
    description: "Summary"      # optional
    backend: wezterm            # optional; "tmux" (default) or "wezterm"
    windowMode: new-window       # optional; "new-window" (default) or "current-window"
    layout:                     # optional; omit for single command presets
      # see Layout Structure
    command: "htop"             # optional; used when layout is omitted
```

### Defaults Structure
Global/project defaults can be defined under `defaults`:
```yaml
defaults:
  windowMode: new-window
  selector:
    ui: auto                 # auto | fzf
    surface: auto            # auto | inline | tmux-popup
    tmuxPopupOpts: "80%,70%" # passed to fzf as --tmux=<value>
    fzf:
      extraArgs:             # additional arguments passed to fzf
        - --cycle
        - --info=inline
```

### Layout Structure
```yaml
layout:
  type: horizontal | vertical   # required
  ratio: [3, 2]                 # required; positive numbers, auto-normalized
  panes:                        # required
    - name: "left"              # required for terminal panes
      command: "npm run start"  # optional
      cwd: "~/project"          # optional
      env:                      # optional
        API_BASE_URL: http://localhost:3000
      focus: true               # optional; only one pane should be true
      delay: 500                # optional; wait (ms) before running command
      title: "Server"           # optional; tmux pane title
      ephemeral: true           # optional; close pane after command completes
      closeOnError: false       # optional; if ephemeral, close on error (default: false)
    - type: vertical            # nested split
      ratio: [1, 1]
      panes:
        - name: "tests"
        - name: "shell"
```

### Template Tokens
You can reference dynamically-assigned pane IDs within pane commands using template tokens. These tokens are resolved after the layout finishes splitting panes but before commands execute:

- **`{{this_pane}}`** - References the current pane receiving the command
- **`{{focus_pane}}`** - References the pane that will receive focus
- **`{{pane_id:<name>}}`** - References a specific pane by its name

Example:
```yaml
presets:
  cross-pane-demo:
    name: Cross Pane Coordination
    layout:
      type: vertical
      ratio: [2, 1]
      panes:
        - name: editor
          command: 'echo "Editor pane ID: {{this_pane}}"'
          focus: true
        - name: terminal
          command: 'echo "I can reference the editor pane: {{pane_id:editor}}"'
```

**Common use cases:**
- Send commands to other panes: `tmux send-keys -t {{pane_id:editor}} "npm test" Enter`
- Display pane information for debugging: `echo "Current: {{this_pane}}, Focus: {{focus_pane}}"`
- Coordinate tasks across multiple panes within your preset configuration

### Ephemeral Panes
Ephemeral panes automatically close after their command completes. This is useful for one-time tasks like builds, tests, or initialization scripts.

```yaml
panes:
  - name: build
    command: npm run build
    ephemeral: true  # Pane closes when command finishes
```

**Error handling:**
- By default, ephemeral panes remain open if the command fails, allowing you to inspect errors
- Set `closeOnError: true` to close the pane regardless of success or failure

```yaml
panes:
  - name: quick-test
    command: npm test
    ephemeral: true
    closeOnError: false  # Default: stays open on error

  - name: build-and-exit
    command: npm run build
    ephemeral: true
    closeOnError: true  # Closes even if build fails
```

**Combining with template tokens:**
```yaml
panes:
  - name: editor
    command: nvim
  - name: test-runner
    command: 'tmux send-keys -t {{pane_id:editor}} ":!npm test" Enter'
    ephemeral: true  # Run once and close
```

### Ratio Normalization
Ratios can be any set of positive integers. vde-layout normalizes them to percentages:
- `[1, 1]` -> `[50, 50]`
- `[2, 3]` -> `[40, 60]`
- `[1, 2, 1]` -> `[25, 50, 25]`

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
- `VDE_CONFIG_PATH` - Override the base directory for configuration files.
- `XDG_CONFIG_HOME` - XDG base directory root; defaults to `~/.config` when unset.
- `VDE_DEBUG=true` - Enable debug-level logs (includes stack traces).
- `VDE_VERBOSE=true` - Enable info-level logs without full debug output.
- `TMUX` - Automatically set by tmux. vde-layout checks this to ensure execution happens inside a session.

## Requirements
- Node.js 22 or higher
- tmux 2.0 or higher (required for the tmux backend)
- WezTerm nightly build with `wezterm` on `$PATH` (required for the WezTerm backend)

## Contributing
Please submit bug reports and feature requests through [GitHub Issues](https://github.com/yuki-yano/vde-layout/issues).

## License
MIT
