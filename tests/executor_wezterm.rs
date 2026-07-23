use std::collections::VecDeque;

use serde_json::{Value, json};
use vde_layout::WindowMode;
use vde_layout::core::{CoreError, CoreErrorKind, compile_core_pipeline};
use vde_layout::executor::{
    CommandExecutor, ExecuteWeztermPlanOptions, PaneDimensions, WeztermDryRunOptions,
    build_wezterm_dry_run_steps, execute_wezterm_plan, resolve_initial_wezterm_pane_size,
    verify_wezterm_environment,
};

#[derive(Debug)]
struct FakeWezterm {
    commands: Vec<Vec<String>>,
    list_outputs: VecDeque<Result<String, CoreError>>,
    spawn_outputs: VecDeque<String>,
    version_output: Result<String, CoreError>,
    fail_on: Option<String>,
    dry_run: bool,
}

impl FakeWezterm {
    fn new() -> Self {
        Self {
            commands: Vec::new(),
            list_outputs: VecDeque::new(),
            spawn_outputs: VecDeque::new(),
            version_output: Ok("wezterm 20240908-123456-DEADBEEF".to_owned()),
            fail_on: None,
            dry_run: false,
        }
    }

    fn lists(mut self, outputs: impl IntoIterator<Item = Value>) -> Self {
        self.list_outputs
            .extend(outputs.into_iter().map(|value| Ok(value.to_string())));
        self
    }

    fn spawns(mut self, outputs: impl IntoIterator<Item = &'static str>) -> Self {
        self.spawn_outputs
            .extend(outputs.into_iter().map(str::to_owned));
        self
    }
}

impl CommandExecutor for FakeWezterm {
    fn execute(&mut self, args: &[String]) -> Result<String, CoreError> {
        self.commands.push(args.to_vec());
        let joined = args.join(" ");
        if self
            .fail_on
            .as_ref()
            .is_some_and(|needle| joined.contains(needle))
        {
            return Err(CoreError::new(
                CoreErrorKind::Execution,
                "INJECTED",
                "injected wezterm failure",
            )
            .with_details(
                json!({ "stderr": "boom", "exitCode": 2 })
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
            ));
        }
        match args {
            [version] if version == "--version" => self.version_output.clone(),
            [cli, list, format, json]
                if cli == "cli" && list == "list" && format == "--format" && json == "json" =>
            {
                self.list_outputs
                    .pop_front()
                    .unwrap_or_else(|| Ok("[]".to_owned()))
            }
            [cli, spawn, ..] if cli == "cli" && spawn == "spawn" => Ok(self
                .spawn_outputs
                .pop_front()
                .unwrap_or_else(|| "42\n".to_owned())),
            _ => Ok(String::new()),
        }
    }

    fn is_dry_run(&self) -> bool {
        self.dry_run
    }
}

fn emission(document: &str) -> vde_layout::core::PlanEmission {
    compile_core_pipeline(document, "tests/wezterm.yml")
        .unwrap()
        .emission
}

fn array_list(entries: Value) -> Value {
    entries
}

fn command_exists(fake: &FakeWezterm, expected: &[&str]) -> bool {
    fake.commands.iter().any(|command| {
        command
            .iter()
            .map(String::as_str)
            .eq(expected.iter().copied())
    })
}

#[test]
fn verifies_versions_and_maps_environment_failures() {
    let mut fake = FakeWezterm::new();
    assert_eq!(
        verify_wezterm_environment(&mut fake, false)
            .unwrap()
            .as_deref(),
        Some("20240908-123456-deadbeef")
    );

    let mut dry = FakeWezterm::new();
    assert_eq!(verify_wezterm_environment(&mut dry, true).unwrap(), None);
    assert!(dry.commands.is_empty());

    let mut old = FakeWezterm::new();
    old.version_output = Ok("wezterm 20210101-000000-deadbeef".to_owned());
    assert_eq!(
        verify_wezterm_environment(&mut old, false)
            .unwrap_err()
            .code,
        "UNSUPPORTED_WEZTERM_VERSION"
    );

    let mut unknown = FakeWezterm::new();
    unknown.version_output = Ok("wezterm unknown".to_owned());
    assert_eq!(
        verify_wezterm_environment(&mut unknown, false)
            .unwrap_err()
            .message,
        "Unable to determine wezterm version"
    );

    let mut missing = FakeWezterm::new();
    missing.version_output =
        Err(
            CoreError::new(CoreErrorKind::Execution, "COMMAND_FAILED", "missing").with_details(
                json!({ "ioErrorKind": "NotFound" })
                    .as_object()
                    .cloned()
                    .unwrap_or_default(),
            ),
        );
    let error = verify_wezterm_environment(&mut missing, false).unwrap_err();
    assert_eq!(error.code, "BACKEND_NOT_FOUND");
    assert_eq!(error.details["backend"], "wezterm");
}

#[test]
fn resolves_initial_pane_size_from_list_output() {
    let list = array_list(json!([
        {
            "window_id": "w1",
            "tab_id": "t1",
            "pane_id": "10",
            "is_active": true,
            "size": { "cols": 120, "rows": 40 },
        },
    ]));
    let mut fake = FakeWezterm::new().lists([list]);
    assert_eq!(
        resolve_initial_wezterm_pane_size(&mut fake, Some("10")),
        Some(PaneDimensions {
            cols: 120,
            rows: 40,
        })
    );
    let mut none = FakeWezterm::new();
    assert_eq!(resolve_initial_wezterm_pane_size(&mut none, None), None);
    assert!(none.commands.is_empty());
}

#[test]
fn builds_percent_dynamic_and_terminal_dry_run_steps() {
    let percent = emission(
        "name: percent\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two, focus: true }\n",
    );
    let steps = build_wezterm_dry_run_steps(&percent, &Default::default()).unwrap();
    assert_eq!(
        steps[0].command,
        "wezterm cli split-pane --right --percent 50 --pane-id root.0"
    );
    assert_eq!(
        steps[1].command,
        "wezterm cli activate-pane --pane-id root.1"
    );

    let dynamic = emission(
        "name: dynamic\nlayout:\n  type: horizontal\n  ratio: [\"80c\", 1]\n  panes:\n    - { name: fixed }\n    - { name: rest }\n",
    );
    let resolved = build_wezterm_dry_run_steps(
        &dynamic,
        &WeztermDryRunOptions {
            initial_pane_id: Some(dynamic.summary.initial_pane_id.clone()),
            initial_pane_size: Some(PaneDimensions {
                cols: 200,
                rows: 60,
            }),
            detected_version: None,
        },
    )
    .unwrap();
    assert!(resolved[0].summary.ends_with("[dynamic-cells]"));
    assert!(resolved[0].command.contains("--cells 120"));
    let placeholder = build_wezterm_dry_run_steps(
        &dynamic,
        &WeztermDryRunOptions {
            initial_pane_id: Some(dynamic.summary.initial_pane_id.clone()),
            initial_pane_size: Some(PaneDimensions { cols: 40, rows: 20 }),
            detected_version: None,
        },
    )
    .unwrap();
    assert!(placeholder[0].command.contains("--cells <dynamic>"));

    let terminal = emission(
        "name: terminal\nlayout:\n  name: runner\n  cwd: /tmp/work\n  env: { NODE_ENV: test }\n  command: npm test\n",
    );
    let terminal_steps = build_wezterm_dry_run_steps(&terminal, &Default::default()).unwrap();
    assert!(
        terminal_steps
            .iter()
            .any(|step| { step.command.contains("send-text") && step.command.contains("cd --") })
    );
    assert!(
        terminal_steps
            .iter()
            .any(|step| step.command.contains("export NODE_ENV="))
    );
    assert!(
        terminal_steps
            .iter()
            .any(|step| step.command.ends_with("'npm test'"))
    );
}

#[test]
fn dry_run_reports_missing_metadata_and_template_tokens() {
    let mut plan = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two }\n",
    );
    plan.steps[0].target_pane_id = None;
    assert_eq!(
        build_wezterm_dry_run_steps(&plan, &Default::default())
            .unwrap_err()
            .code,
        "MISSING_TARGET"
    );

    let mut token = emission("name: token\ncommand: echo\n");
    token.terminals[0].command = Some("echo {{pane_id:missing}}".to_owned());
    let error = build_wezterm_dry_run_steps(&token, &Default::default()).unwrap_err();
    assert_eq!(error.code, "TEMPLATE_TOKEN_ERROR");
    assert_eq!(error.details["tokenType"], "pane_id");
}

#[test]
fn spawns_in_preferred_workspace_and_uses_terminal_cwd() {
    let initial = array_list(json!([
        { "window_id": "main", "tab_id": "m", "pane_id": "1", "workspace": "main", "is_active": true },
        { "window_id": "dev", "tab_id": "d", "pane_id": "20", "workspace": "dev", "is_active": true },
    ]));
    let registered = array_list(json!([
        { "window_id": "main", "tab_id": "m", "pane_id": "1", "workspace": "main", "is_active": true },
        { "window_id": "dev", "tab_id": "d", "pane_id": "20", "workspace": "dev" },
        { "window_id": "dev", "tab_id": "d2", "pane_id": "42", "workspace": "dev", "is_active": true },
    ]));
    let mut fake = FakeWezterm::new()
        .lists([initial, registered])
        .spawns(["42 dev\n"]);
    let plan = emission("name: app\nlayout:\n  name: app\n  cwd: /project/app\n");
    let result = execute_wezterm_plan(
        &plan,
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: Some("/fallback"),
            pane_id: Some("20"),
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.focus_pane_id.as_deref(), Some("42"));
    assert_eq!(result.window_id, "dev");
    assert!(command_exists(
        &fake,
        &[
            "cli",
            "spawn",
            "--window-id",
            "dev",
            "--cwd",
            "/project/app"
        ]
    ));
}

#[test]
fn spawns_new_window_when_no_window_exists_and_retries_registration() {
    let empty = json!([]);
    let absent = array_list(json!([
        { "window_id": "other", "tab_id": "t", "pane_id": "1", "is_active": true },
    ]));
    let registered = array_list(json!([
        { "window_id": "new", "tab_id": "t", "pane_id": "21", "is_active": true },
    ]));
    let mut fake = FakeWezterm::new()
        .lists([empty, absent, registered])
        .spawns(["21\n"]);
    let result = execute_wezterm_plan(
        &emission("name: empty\n"),
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: Some("/workspace"),
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.window_id, "new");
    assert!(command_exists(
        &fake,
        &["cli", "spawn", "--new-window", "--cwd", "/workspace"]
    ));
    assert_eq!(
        fake.commands
            .iter()
            .filter(|command| command.get(1).is_some_and(|arg| arg == "list"))
            .count(),
        3
    );
}

#[test]
fn current_window_prefers_requested_pane_and_closes_siblings() {
    let current = array_list(json!([
        { "window_id": "main", "tab_id": "m", "pane_id": "A", "is_active": true },
        { "window_id": "main", "tab_id": "m", "pane_id": "B" },
        { "window_id": "dev", "tab_id": "d", "pane_id": "D" },
        { "window_id": "dev", "tab_id": "d", "pane_id": "E" },
    ]));
    let mut fake = FakeWezterm::new().lists([current]);
    let mut confirmed = Vec::new();
    let mut confirm = |panes: &[String], _dry: bool| {
        confirmed = panes.to_vec();
        true
    };
    let result = execute_wezterm_plan(
        &emission("name: current\n"),
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            cwd: None,
            pane_id: Some("D"),
            detected_version: None,
            on_confirm_kill: Some(&mut confirm),
        },
    )
    .unwrap();
    assert_eq!(confirmed, vec!["E"]);
    assert_eq!(result.focus_pane_id.as_deref(), Some("D"));
    assert!(command_exists(
        &fake,
        &["cli", "kill-pane", "--pane-id", "E"]
    ));
    assert!(
        !fake
            .commands
            .iter()
            .any(|command| command.iter().any(|arg| arg == "B")
                && command.iter().any(|arg| arg == "kill-pane"))
    );
}

#[test]
fn current_window_cancellation_and_empty_window_are_typed_errors() {
    let current = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "A", "is_active": true },
        { "window_id": "w", "tab_id": "t", "pane_id": "B" },
    ]));
    let mut fake = FakeWezterm::new().lists([current]);
    let mut cancel = |_panes: &[String], _dry: bool| false;
    assert_eq!(
        execute_wezterm_plan(
            &emission("name: cancel\n"),
            &mut fake,
            ExecuteWeztermPlanOptions {
                window_mode: WindowMode::CurrentWindow,
                cwd: None,
                pane_id: None,
                detected_version: None,
                on_confirm_kill: Some(&mut cancel),
            },
        )
        .unwrap_err()
        .code,
        "USER_CANCELLED"
    );
    assert!(
        !fake
            .commands
            .iter()
            .any(|command| command.iter().any(|arg| arg == "kill-pane"))
    );

    let mut empty = FakeWezterm::new().lists([json!([])]);
    assert_eq!(
        execute_wezterm_plan(
            &emission("name: empty\n"),
            &mut empty,
            ExecuteWeztermPlanOptions {
                window_mode: WindowMode::CurrentWindow,
                cwd: None,
                pane_id: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .message,
        "No active wezterm window detected"
    );
}

#[test]
fn current_window_reports_missing_tabs_and_panes() {
    let mut no_tabs = FakeWezterm::new().lists([json!({
        "windows": [{ "window_id": "w1", "is_active": true, "tabs": [] }],
    })]);
    let error = execute_wezterm_plan(
        &emission("name: no-tabs\n"),
        &mut no_tabs,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.message, "No active wezterm tab detected");
    assert_eq!(error.path.as_deref(), Some("w1"));

    let mut no_panes = FakeWezterm::new().lists([json!({
        "windows": [{
            "window_id": "w1",
            "is_active": true,
            "tabs": [{ "tab_id": "t1", "is_active": true, "panes": [] }],
        }],
    })]);
    let error = execute_wezterm_plan(
        &emission("name: no-panes\n"),
        &mut no_panes,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.message, "No active wezterm pane detected");
    assert_eq!(error.path.as_deref(), Some("t1"));
}

#[test]
fn registration_falls_back_from_stale_window_hint_to_global_search() {
    let initial = array_list(json!([
        { "window_id": "w1", "tab_id": "t", "pane_id": "1", "is_active": true },
    ]));
    let relocated = array_list(json!([
        { "window_id": "w2", "tab_id": "t", "pane_id": "42", "is_active": true },
    ]));
    let mut fake = FakeWezterm::new()
        .lists([initial, relocated])
        .spawns(["42 w1\n"]);
    let result = execute_wezterm_plan(
        &emission("name: relocated\n"),
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.window_id, "w2");
    assert_eq!(result.focus_pane_id.as_deref(), Some("42"));
}

#[test]
fn applies_dynamic_split_focus_and_registers_new_pane() {
    let initial = array_list(json!([
        { "window_id": "w1", "tab_id": "t", "pane_id": "10", "is_active": true },
    ]));
    let spawned = array_list(json!([
        { "window_id": "w1", "tab_id": "t", "pane_id": "10" },
        { "window_id": "w1", "tab_id": "t2", "pane_id": "100", "is_active": true, "size": { "cols": 200, "rows": 60 } },
    ]));
    let after = array_list(json!([
        { "window_id": "w1", "tab_id": "t2", "pane_id": "100", "size": { "cols": 80, "rows": 60 } },
        { "window_id": "w1", "tab_id": "t2", "pane_id": "101", "is_active": true, "size": { "cols": 120, "rows": 60 } },
    ]));
    let mut fake = FakeWezterm::new()
        .lists([initial, spawned.clone(), spawned, after])
        .spawns(["100 w1\n"]);
    let plan = emission(
        "name: dynamic\nlayout:\n  type: horizontal\n  ratio: [\"80c\", 1]\n  panes:\n    - { name: fixed, focus: true }\n    - { name: rest }\n",
    );
    let result = execute_wezterm_plan(
        &plan,
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: Some("20240908-123456-deadbeef"),
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert!(command_exists(
        &fake,
        &[
            "cli",
            "split-pane",
            "--right",
            "--cells",
            "120",
            "--pane-id",
            "100",
        ]
    ));
    assert!(command_exists(
        &fake,
        &["cli", "activate-pane", "--pane-id", "100"]
    ));
    assert_eq!(result.pane_map["root.1"], "101");
    assert_eq!(result.executed_steps, plan.steps.len());
}

#[test]
fn resolves_single_child_terminal_ids_through_split_ancestors() {
    let initial = array_list(json!([
        { "window_id": "w1", "tab_id": "t", "pane_id": "10", "is_active": true },
    ]));
    let spawned = array_list(json!([
        { "window_id": "w1", "tab_id": "t", "pane_id": "10" },
        { "window_id": "w1", "tab_id": "t2", "pane_id": "100", "is_active": true },
    ]));
    let after = array_list(json!([
        { "window_id": "w1", "tab_id": "t2", "pane_id": "100" },
        { "window_id": "w1", "tab_id": "t2", "pane_id": "101", "is_active": true },
    ]));
    let mut fake = FakeWezterm::new()
        .lists([initial, spawned.clone(), spawned, after])
        .spawns(["100 w1\n"]);
    let plan = emission(
        "name: nested-single\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: left }\n    - type: vertical\n      ratio: [1]\n      panes:\n        - { name: nested, command: echo-nested, focus: true }\n",
    );

    let result = execute_wezterm_plan(
        &plan,
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();

    assert_eq!(result.pane_map["root.1.0"], "101");
    assert_eq!(result.pane_name_to_real_id["nested"], "101");
    assert!(command_exists(
        &fake,
        &[
            "cli",
            "send-text",
            "--pane-id",
            "101",
            "--no-paste",
            "--",
            "echo-nested\r",
        ]
    ));
}

#[test]
fn sends_terminal_setup_and_commands_with_carriage_returns() {
    let initial = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "1", "is_active": true },
    ]));
    let spawned = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "1" },
        { "window_id": "w", "tab_id": "t2", "pane_id": "200", "is_active": true },
    ]));
    let mut fake = FakeWezterm::new()
        .lists([initial, spawned])
        .spawns(["200 w\n"]);
    let result = execute_wezterm_plan(
        &emission(
            "name: app\nlayout:\n  name: app\n  cwd: /workspace/project\n  env: { NODE_ENV: production }\n  command: npm start\n  title: ignored-by-wezterm\n",
        ),
        &mut fake,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.focus_pane_id.as_deref(), Some("200"));
    assert!(fake.commands.iter().any(|command| {
        command
            .last()
            .is_some_and(|arg| arg == "cd -- '/workspace/project'\r")
    }));
    assert!(fake.commands.iter().any(|command| {
        command
            .last()
            .is_some_and(|arg| arg == "export NODE_ENV='production'\r")
    }));
    assert!(
        fake.commands
            .iter()
            .any(|command| command.last().is_some_and(|arg| arg == "npm start\r"))
    );
    assert!(
        !fake
            .commands
            .iter()
            .any(|command| command.iter().any(|arg| arg == "ignored-by-wezterm"))
    );
}

#[test]
fn wraps_cli_failures_and_rejects_unresolvable_split_and_delay() {
    let initial = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "1", "is_active": true },
    ]));
    let spawned = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "1" },
        { "window_id": "w", "tab_id": "t2", "pane_id": "100", "is_active": true },
    ]));
    let mut failing = FakeWezterm::new()
        .lists([initial.clone(), spawned.clone(), spawned.clone()])
        .spawns(["100 w\n"]);
    failing.fail_on = Some("split-pane".to_owned());
    let plan = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two }\n",
    );
    let error = execute_wezterm_plan(
        &plan,
        &mut failing,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "TERMINAL_COMMAND_FAILED");
    assert_eq!(error.details["backend"], "wezterm");
    assert_eq!(error.path.as_deref(), Some("root:split:1"));

    let mut no_delta = FakeWezterm::new()
        .lists([initial, spawned.clone(), spawned.clone(), spawned])
        .spawns(["100 w\n"]);
    assert_eq!(
        execute_wezterm_plan(
            &plan,
            &mut no_delta,
            ExecuteWeztermPlanOptions {
                window_mode: WindowMode::NewWindow,
                cwd: None,
                pane_id: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .message,
        "Unable to determine newly created wezterm pane"
    );

    let initial = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "1", "is_active": true },
    ]));
    let spawned = array_list(json!([
        { "window_id": "w", "tab_id": "t2", "pane_id": "200", "is_active": true },
    ]));
    let mut delayed = FakeWezterm::new()
        .lists([initial, spawned])
        .spawns(["200 w\n"]);
    let mut delayed_plan = emission("name: delay\ncommand: echo\n");
    delayed_plan.terminals[0].delay = Some(3_000_000_000.0);
    assert_eq!(
        execute_wezterm_plan(
            &delayed_plan,
            &mut delayed,
            ExecuteWeztermPlanOptions {
                window_mode: WindowMode::NewWindow,
                cwd: None,
                pane_id: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "INVALID_PLAN"
    );
}

#[test]
fn rejects_missing_step_targets_and_runtime_template_tokens() {
    let initial = array_list(json!([
        { "window_id": "w", "tab_id": "t", "pane_id": "1", "is_active": true },
    ]));
    let spawned = array_list(json!([
        { "window_id": "w", "tab_id": "t2", "pane_id": "100", "is_active": true },
    ]));
    let mut missing_target_plan = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two }\n",
    );
    missing_target_plan.steps[0].target_pane_id = None;
    let mut missing_target = FakeWezterm::new()
        .lists([initial.clone(), spawned.clone()])
        .spawns(["100 w\n"]);
    let error = execute_wezterm_plan(
        &missing_target_plan,
        &mut missing_target,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "INVALID_PANE");
    assert_eq!(error.path.as_deref(), Some("root:split:1"));

    let mut token_plan = emission("name: token\ncommand: echo\n");
    token_plan.terminals[0].command = Some("echo {{pane_id:missing}}".to_owned());
    let mut token = FakeWezterm::new()
        .lists([initial, spawned])
        .spawns(["100 w\n"]);
    let error = execute_wezterm_plan(
        &token_plan,
        &mut token,
        ExecuteWeztermPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: None,
            pane_id: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "TEMPLATE_TOKEN_ERROR");
    assert_eq!(error.details["tokenType"], "pane_id");
}

#[test]
fn rejects_missing_initial_metadata_and_empty_spawn_output() {
    let mut missing = emission("name: missing\n");
    missing.summary.initial_pane_id.clear();
    let mut fake = FakeWezterm::new();
    assert_eq!(
        execute_wezterm_plan(
            &missing,
            &mut fake,
            ExecuteWeztermPlanOptions {
                window_mode: WindowMode::NewWindow,
                cwd: None,
                pane_id: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "INVALID_PLAN"
    );

    let mut empty_spawn = FakeWezterm::new().lists([json!([])]).spawns(["  \n"]);
    assert_eq!(
        execute_wezterm_plan(
            &emission("name: spawn\n"),
            &mut empty_spawn,
            ExecuteWeztermPlanOptions {
                window_mode: WindowMode::NewWindow,
                cwd: None,
                pane_id: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .message,
        "wezterm spawn did not return a pane id"
    );
}
