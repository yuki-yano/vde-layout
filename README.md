# vde-layout

[日本語](README.ja.md)

`vde-layout` turns YAML presets into repeatable terminal workspaces for tmux,
WezTerm, and Herdr.

Describe the panes, commands, working directories, and split sizes once. Then
open the same workspace with either `vde-layout` or its short alias, `vl`.

## Install

### Cargo

```bash
cargo install vde-layout --locked
```

Building from source requires Rust 1.88 or newer.

### Prebuilt binaries

Download the archive for your platform from
[GitHub Releases](https://github.com/yuki-yano/vde-layout/releases). Each
archive contains both `vde-layout` and `vl`, with a SHA-256 checksum published
beside it.

Release archives are built for:

- Linux x86_64
- Linux aarch64
- macOS x86_64
- macOS Apple Silicon

## Quick start

Create `~/.config/vde/layout/config.yml`:

```yaml
presets:
  dev:
    name: Development
    description: Editor, application server, and logs
    layout:
      type: horizontal
      ratio: [2, 1]
      panes:
        - name: editor
          command: nvim
          focus: true
        - type: vertical
          ratio: [2, 1]
          panes:
            - name: server
              command: npm run dev
            - name: logs
              command: tail -f logs/app.log
```

Start your terminal backend, then apply the preset:

```bash
vde-layout dev
```

Use `vl` when you prefer the shorter command:

```bash
vl dev
```

Preview the commands without changing your terminal:

```bash
vde-layout dev --dry-run
```

## Choose a terminal backend

tmux is the default. Select a different backend in the preset or on the command
line:

```yaml
presets:
  dev:
    name: Development
    backend: herdr
```

```bash
vde-layout dev --backend wezterm
```

| Backend | Runtime requirement | New-window behavior |
| --- | --- | --- |
| tmux | tmux 2.0+ and an active session | Creates a tmux window |
| WezTerm | `wezterm` CLI version `20220624-141144-bd1b7c5d` or newer | Creates a tab in the active window, or a new window when none exists |
| Herdr | `herdr` 0.7.4+ and a running server | Creates a tab in the current workspace |

Herdr limits both sides of a split to 10%–90%. `vde-layout` reports an error
when a preset exceeds that range instead of relying on Herdr to clamp it.

## Command overview

```text
vde-layout [OPTIONS] [PRESET]
vde-layout list
```

Common commands and options:

```bash
# List configured presets
vde-layout list

# Apply the default preset, or the first preset when no "default" key exists
vde-layout

# Open an interactive fzf selector
vde-layout --select

# Reuse the current window or tab
vde-layout dev --current-window

# Always create a new window or tab
vde-layout dev --new-window

# Use a specific configuration file
vde-layout dev --config ./team-layouts.yml

# Show resolved presets and execution details
vde-layout dev --verbose

# Show structured debug details
VDE_DEBUG=true vde-layout dev
```

Run `vde-layout --help` for the complete option list. `vl` accepts the same
options and has the same output and exit codes.

## Reuse the current window safely

`--current-window` closes other panes in the target tmux window, WezTerm tab,
or Herdr tab before applying the preset. An interactive run asks for
confirmation first.

tmux panes marked with the user option `@vde_sidebar=1` are protected. They
remain open, and the new layout is built in the non-sidebar area.

Use `--dry-run` before applying a new or shared preset:

```bash
vde-layout dev --current-window --dry-run
```

## Configuration

### Presets

Every preset lives under `presets` and requires a display name:

```yaml
presets:
  api:
    name: API development
    description: Editor and API server
    backend: tmux
    windowMode: new-window
    layout:
      type: horizontal
      ratio: [3, 2]
      panes:
        - name: editor
          command: nvim
          cwd: /path/to/api
          focus: true
        - name: server
          command: cargo run
          cwd: /path/to/api
          env:
            RUST_LOG: debug
          title: API
          delay: 500
```

Preset fields:

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Display name |
| `description` | no | Text shown by `list` and the selector |
| `backend` | no | `tmux`, `wezterm`, or `herdr`; defaults to tmux |
| `windowMode` | no | `new-window` or `current-window` |
| `layout` | no | Nested pane layout |
| `command` | no | Command for a single-pane preset without `layout` |
| `hooks.afterApply` | no | Host command run after a successful apply |

When both `layout` and `command` are omitted, the preset opens one pane with its
default shell.

### Layouts and panes

Split nodes use `horizontal` for left/right panes and `vertical` for top/bottom
panes. They may be nested to any depth:

```yaml
layout:
  type: horizontal
  ratio: ["90c", 2]
  panes:
    - name: editor
      command: nvim
    - type: vertical
      ratio: [1, 1]
      panes:
        - name: tests
          command: cargo test
        - name: shell
```

Terminal pane fields:

| Field | Description |
| --- | --- |
| `name` | Required pane name |
| `command` | Command submitted to the pane |
| `cwd` | Working directory selected before the command |
| `env` | Environment variables exported before the command |
| `delay` | Milliseconds to wait before submitting the command |
| `title` | Pane title or label |
| `focus` | Give this pane final focus; only one pane may set it |
| `ephemeral` | Close the pane after its command succeeds |
| `closeOnError` | Also close an ephemeral pane when its command fails |

### Ratios and fixed cells

Numeric ratio entries are weights:

```yaml
ratio: [2, 1]
```

Fixed-cell entries use a positive integer followed by `c`:

```yaml
ratio: ["90c", 2, 1]
```

Fixed cells are reserved first, then the remaining space is distributed by
weight. Each ratio must:

- contain the same number of entries as `panes`
- contain at least one numeric weight
- use only positive weights and positive integer cell counts

If the terminal is too small to satisfy a fixed-cell layout, the apply fails
without silently changing the requested size.

### Defaults

Configuration-wide defaults may define window and selector behavior:

```yaml
defaults:
  windowMode: new-window
  selector:
    ui: auto
    surface: auto
    tmuxPopupOpts: "80%,70%"
    fzf:
      extraArgs:
        - --cycle
        - --info=inline
```

Command-line flags take precedence over preset values, and preset values take
precedence over defaults.

## Find and combine configuration files

Without `--config`, `vde-layout` searches these scopes:

1. Project configuration, walking upward from the current directory:
   `.vde/layout/config.yml`, then `.vde/layout.yml`
2. `$VDE_CONFIG_PATH/layout.yml`, when `VDE_CONFIG_PATH` is set
3. `$XDG_CONFIG_HOME/vde/layout/config.yml`, or
   `~/.config/vde/layout/config.yml`
4. The legacy XDG path `$XDG_CONFIG_HOME/vde/layout.yml`, or
   `~/.config/vde/layout.yml`

Shared configuration is loaded first and project configuration last. Later
scopes override presets and defaults with the same keys.

## Select a preset interactively

Install `fzf`, then run:

```bash
vde-layout --select
```

The selector shows preset names, descriptions, and a YAML preview. Useful
options include:

```bash
vde-layout --select --select-surface inline
vde-layout --select --select-surface tmux-popup
vde-layout --select --select-tmux-popup-opts "80%,70%"
vde-layout --select --fzf-arg=--cycle --fzf-arg=--info=inline
```

The tmux popup surface requires tmux 3.3 or newer.

## Coordinate commands with template tokens

Pane commands can refer to IDs assigned while the layout is being built:

| Token | Value |
| --- | --- |
| `{{this_pane}}` | ID of the pane receiving the command |
| `{{focus_pane}}` | ID of the pane that receives final focus |
| `{{pane_id:name}}` | ID of the named pane |

Example:

```yaml
panes:
  - name: editor
    command: nvim
    focus: true
  - name: reporter
    command: 'echo "editor={{pane_id:editor}} focus={{focus_pane}}"'
```

Unknown pane names are errors. `{{window_id}}` is available only to
`hooks.afterApply`.

## Run a command after applying a preset

`hooks.afterApply` runs once on the host after the backend finishes:

```yaml
presets:
  dev:
    name: Development
    command: nvim
    hooks:
      afterApply: 'notify-send "ready in {{window_id}}"'
```

The hook:

- runs through `sh -c` in the directory where `vde-layout` was invoked
- supports `{{this_pane}}`, `{{focus_pane}}`, `{{pane_id:name}}`, and
  `{{window_id}}`
- is printed but not executed during `--dry-run`
- times out after 30 seconds
- logs a warning without changing a successful apply into a failure

## Environment variables

| Variable | Purpose |
| --- | --- |
| `VDE_CONFIG_PATH` | Additional shared configuration directory |
| `XDG_CONFIG_HOME` | Base directory for XDG configuration |
| `VDE_VERBOSE=true` | Enable informational logs |
| `VDE_DEBUG=true` | Enable debug logs and structured error details |
| `TMUX` | Used to validate an active tmux session |
| `TMUX_PANE` | Current tmux pane used by current-window mode |
| `WEZTERM_PANE` | Current WezTerm pane used by current-window mode |
| `HERDR_PANE_ID` | Preferred pane for Herdr current-window mode |
| `HERDR_WORKSPACE_ID` | Target workspace for a new Herdr tab |

Herdr sets its variables automatically for commands launched in managed panes.

## Troubleshooting

### Preview before applying

`--dry-run` does not require the selected backend binary and does not create,
close, or resize panes:

```bash
vde-layout dev --backend herdr --dry-run
```

### A backend cannot be found

Check that the backend CLI is on `PATH`:

```bash
tmux -V
wezterm --version
herdr --version
```

For WezTerm and Herdr, start the application or server before a non-dry run.

### A fixed-cell layout fails

Increase the terminal size, reduce fixed-cell values, or replace fixed cells
with numeric weights. Run with `VDE_DEBUG=true` to see the pane size used during
resolution.

## Development

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
cargo test --test tmux_live -- --ignored --nocapture
cargo publish --locked --dry-run
```

The tmux live test uses an isolated socket and does not modify the active tmux
session.

Bug reports and feature requests are welcome in
[GitHub Issues](https://github.com/yuki-yano/vde-layout/issues).

## License

MIT
