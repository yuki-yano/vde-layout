# Rust test parity audit

## Scope

The migration baseline is commit `5249bb7` (v1.1.3): 39 TypeScript test files and 444 passing tests. The table maps every baseline file to Rust automated tests or an explicit repository-level check. The three TypeScript golden-parity tests added during migration are not part of the 444-test baseline; their fixtures remain covered by `tests/core_parity.rs`.

## Baseline correspondence

| # | TypeScript baseline test | Rust evidence | Covered behavior |
|---:|---|---|---|
| 1 | `src/backends/tmux/executor.test.ts` | `tests/executor_tmux.rs`, `tests/tmux_live.rs` | tmux command execution, failures, live socket |
| 2 | `src/backends/wezterm/cli.test.ts` | `tests/executor_wezterm.rs` | version detection and CLI error mapping |
| 3 | `src/backends/wezterm/list-parser.test.ts` | `tests/wezterm_list.rs` | array/object list parsing and normalization |
| 4 | `src/cli/after-apply-hook.test.ts` | `tests/cli_support.rs`, hook module timeout unit test | token resolution, cwd, warning-only failures, process timeout |
| 5 | `src/cli/command-helpers.test.ts` | `tests/cli.rs`, `tests/cli_support.rs` | dry-run rendering, preview payload, CLI option normalization |
| 6 | `src/cli/error-handling.test.ts` | `tests/cli.rs`, `tests/error.rs` | structured errors, guidance, debug details, exit codes |
| 7 | `src/cli/index.test.ts` | `tests/cli.rs` | parsing, list/apply/select routing, both binaries |
| 8 | `src/cli/package-version.test.ts` | `tests/cli.rs` | `--version` and `-v` from Cargo package version |
| 9 | `src/cli/plan-parity.test.ts` | `tests/core_parity.rs`, `tests/cli.rs` | plan structure and dry-run/application pipeline parity |
| 10 | `src/cli/preset-execution.test.ts` | `tests/cli.rs`, `tests/executor_tmux.rs`, `tests/executor_wezterm.rs` | backend application, ordering, window naming, hooks |
| 11 | `src/cli/preset-selector.test.ts` | `tests/cli_support.rs`, selector module fake-fzf unit test | rows, preview, reserved args, process selection |
| 12 | `src/cli/runtime-and-list.test.ts` | `tests/cli.rs` | list output, default runtime behavior, verbose output |
| 13 | `src/cli/select-args.test.ts` | `tests/cli.rs`, `tests/cli_support.rs` | `--select[=fzf]`, selector options, `--` handling |
| 14 | `src/cli/user-prompt.test.ts` | `tests/executor_tmux.rs`, `tests/executor_wezterm.rs`, `tests/cli.rs` | confirmation callback, cancellation 130, non-interactive rejection |
| 15 | `src/cli/wezterm.test.ts` | `tests/cli.rs`, `tests/executor_wezterm.rs` | backend selection, dry-run and execution errors |
| 16 | `src/cli/window-mode.test.ts` | `tests/cli.rs`, backend executor tests | CLI/preset/default window mode and current-window behavior |
| 17 | `src/config/loader.test.ts` | `tests/config_loader.rs` | discovery order, scope merge, warnings, explicit path |
| 18 | `src/config/validator.test.ts` | `tests/config_model.rs` | schema validation, YAML edge cases, paths |
| 19 | `src/core/compile.test.ts` | `tests/core_compile.rs` | compiled model, stable errors, numeric edge cases |
| 20 | `src/core/emitter.test.ts` | `tests/core_emitter.rs` | emitted steps, metadata, canonical hash |
| 21 | `src/core/pipeline.test.ts` | `tests/core_pipeline.rs` | compile-plan-emit pipeline and error propagation |
| 22 | `src/core/planner.test.ts` | `tests/core_planner.rs` | pane IDs, focus, ratios, single terminals |
| 23 | `src/e2e.test.ts` | `tests/cli.rs`, `tests/tmux_live.rs` | installed CLI boundary and real tmux smoke |
| 24 | `src/eslint-boundaries.test.ts` | `cargo clippy --all-targets --all-features -- -D warnings`, module visibility review | Rust module boundary and static analysis replacement |
| 25 | `src/executor/backend-resolver.test.ts` | `tests/cli.rs` | CLI-over-preset backend precedence and tmux default |
| 26 | `src/executor/mock-executor.test.ts` | `tests/executor_tmux.rs`, `tests/executor_wezterm.rs` | recordable fake executors and injected failures |
| 27 | `src/executor/plan-runner.test.ts` | `tests/executor_tmux.rs` | plan step ordering, pane mapping, cancellation |
| 28 | `src/executor/real-executor.test.ts` | `tests/cli.rs`, `tests/tmux_live.rs` | real process execution and command failures |
| 29 | `src/executor/sidebar-detection.test.ts` | `tests/executor_tmux.rs` | sidebar classification, protection, split origin |
| 30 | `src/executor/split-step.test.ts` | `tests/executor_split.rs` | percent/fixed-cell sizing and failure details |
| 31 | `src/executor/terminal-command-preparation.test.ts` | `tests/executor_terminal.rs` | cwd/env/delay/title/ephemeral command preparation |
| 32 | `src/executor/tmux-backend.test.ts` | `tests/executor_tmux.rs`, `tests/tmux_live.rs` | tmux backend integration and live smoke |
| 33 | `src/executor/wezterm-backend.test.ts` | `tests/executor_wezterm.rs` | WezTerm apply/current-window/retry/dry-run integration |
| 34 | `src/index.test.ts` | `tests/cli.rs`, `tests/core_pipeline.rs` | public entrypoint and end-to-end pipeline |
| 35 | `src/layout/preset.test.ts` | `tests/preset_manager.rs`, `tests/core_planner.rs` | preset access, default selection, recursive layout |
| 36 | `src/models/schema.test.ts` | `tests/config_model.rs` | complete configuration and pane model schema |
| 37 | `src/utils/errors.test.ts` | `tests/error.rs`, `tests/cli.rs` | typed metadata, formatting, actionable guidance |
| 38 | `src/utils/logger.test.ts` | `tests/cli.rs`, `tests/cli_support.rs` | verbose/debug environment and hook warnings |
| 39 | `src/utils/template-tokens.test.ts` | `tests/executor_template.rs`, `tests/cli_support.rs` | pane/focus/window tokens and unresolved tokens |

## Repository-level checks

- `cargo fmt --all -- --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-targets --all-features`
- `cargo test --test tmux_live -- --ignored --nocapture`
- `cargo build --locked --release --bins`
- `cargo install --locked --path . --root <temporary-directory>` followed by `vde-layout` / `vl` help, version, and dry-run comparison
- `rg --files -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs'` must return no files
