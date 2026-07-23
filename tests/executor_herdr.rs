use std::collections::VecDeque;

use serde_json::{Value, json};
use vde_layout::WindowMode;
use vde_layout::core::{CoreError, CoreErrorKind, compile_core_pipeline};
use vde_layout::executor::{
    CommandExecutor, ExecuteHerdrPlanOptions, build_herdr_dry_run_steps, execute_herdr_plan,
    verify_herdr_environment,
};

#[derive(Debug)]
struct FakeHerdr {
    commands: Vec<Vec<String>>,
    version_output: Result<String, CoreError>,
    tab_outputs: VecDeque<String>,
    current_outputs: VecDeque<String>,
    list_outputs: VecDeque<String>,
    layout_outputs: VecDeque<String>,
    split_outputs: VecDeque<String>,
    dry_run: bool,
}

impl FakeHerdr {
    fn new() -> Self {
        Self {
            commands: Vec::new(),
            version_output: Ok("herdr 0.7.4".to_owned()),
            tab_outputs: VecDeque::new(),
            current_outputs: VecDeque::new(),
            list_outputs: VecDeque::new(),
            layout_outputs: VecDeque::new(),
            split_outputs: VecDeque::new(),
            dry_run: false,
        }
    }

    fn tabs(mut self, values: impl IntoIterator<Item = Value>) -> Self {
        self.tab_outputs
            .extend(values.into_iter().map(|value| value.to_string()));
        self
    }

    fn currents(mut self, values: impl IntoIterator<Item = Value>) -> Self {
        self.current_outputs
            .extend(values.into_iter().map(|value| value.to_string()));
        self
    }

    fn lists(mut self, values: impl IntoIterator<Item = Value>) -> Self {
        self.list_outputs
            .extend(values.into_iter().map(|value| value.to_string()));
        self
    }

    fn layouts(mut self, values: impl IntoIterator<Item = Value>) -> Self {
        self.layout_outputs
            .extend(values.into_iter().map(|value| value.to_string()));
        self
    }

    fn splits(mut self, values: impl IntoIterator<Item = Value>) -> Self {
        self.split_outputs
            .extend(values.into_iter().map(|value| value.to_string()));
        self
    }
}

impl CommandExecutor for FakeHerdr {
    fn execute(&mut self, args: &[String]) -> Result<String, CoreError> {
        self.commands.push(args.to_vec());
        match args {
            [version] if version == "--version" => self.version_output.clone(),
            [tab, create, ..] if tab == "tab" && create == "create" => self
                .tab_outputs
                .pop_front()
                .ok_or_else(|| missing_output("tab create")),
            [pane, current, ..] if pane == "pane" && current == "current" => self
                .current_outputs
                .pop_front()
                .ok_or_else(|| missing_output("pane current")),
            [pane, list, ..] if pane == "pane" && list == "list" => self
                .list_outputs
                .pop_front()
                .ok_or_else(|| missing_output("pane list")),
            [pane, layout, ..] if pane == "pane" && layout == "layout" => self
                .layout_outputs
                .pop_front()
                .ok_or_else(|| missing_output("pane layout")),
            [pane, split, ..] if pane == "pane" && split == "split" => self
                .split_outputs
                .pop_front()
                .ok_or_else(|| missing_output("pane split")),
            _ => Ok(json!({ "result": { "type": "ok" } }).to_string()),
        }
    }

    fn is_dry_run(&self) -> bool {
        self.dry_run
    }
}

fn missing_output(command: &str) -> CoreError {
    CoreError::new(
        CoreErrorKind::Execution,
        "MISSING_FAKE_OUTPUT",
        format!("missing fake output for {command}"),
    )
}

fn emission(document: &str) -> vde_layout::core::PlanEmission {
    compile_core_pipeline(document, "tests/herdr.yml")
        .unwrap()
        .emission
}

fn pane(pane_id: &str, tab_id: &str, focused: bool) -> Value {
    json!({
        "pane_id": pane_id,
        "terminal_id": format!("terminal-{pane_id}"),
        "workspace_id": "workspace-1",
        "tab_id": tab_id,
        "focused": focused,
    })
}

fn tab_created(pane_id: &str, tab_id: &str) -> Value {
    json!({
        "result": {
            "type": "tab_created",
            "tab": { "tab_id": tab_id },
            "root_pane": pane(pane_id, tab_id, true),
        }
    })
}

fn pane_result(value: Value) -> Value {
    json!({ "result": { "type": "pane_info", "pane": value } })
}

fn command_exists(fake: &FakeHerdr, expected: &[&str]) -> bool {
    fake.commands.iter().any(|command| {
        command
            .iter()
            .map(String::as_str)
            .eq(expected.iter().copied())
    })
}

#[test]
fn verifies_minimum_version_and_missing_binary() {
    let mut valid = FakeHerdr::new();
    assert_eq!(
        verify_herdr_environment(&mut valid, false)
            .unwrap()
            .as_deref(),
        Some("0.7.4")
    );

    let mut old = FakeHerdr::new();
    old.version_output = Ok("herdr 0.7.3".to_owned());
    assert_eq!(
        verify_herdr_environment(&mut old, false).unwrap_err().code,
        "UNSUPPORTED_HERDR_VERSION"
    );

    let mut missing = FakeHerdr::new();
    missing.version_output = Err(CoreError::new(CoreErrorKind::Execution, "IO", "missing")
        .with_details(
            json!({ "ioErrorKind": "NotFound" })
                .as_object()
                .cloned()
                .unwrap(),
        ));
    assert_eq!(
        verify_herdr_environment(&mut missing, false)
            .unwrap_err()
            .code,
        "BACKEND_NOT_FOUND"
    );
}

#[test]
fn dry_run_renders_splits_titles_and_commands() {
    let plan = emission(
        "name: app\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: editor, title: Editor }\n    - { name: server, command: npm start, focus: true }\n",
    );
    let steps = build_herdr_dry_run_steps(&plan).unwrap();
    assert_eq!(
        steps[0].command,
        "herdr pane split root.0 --direction right --ratio 0.5 --focus"
    );
    assert!(
        steps
            .iter()
            .any(|step| step.command == "herdr pane rename root.0 Editor")
    );
    assert!(
        steps
            .iter()
            .any(|step| step.command.ends_with("'npm start'"))
    );
}

#[test]
fn dry_run_rejects_ratios_herdr_would_clamp() {
    let plan = emission(
        "name: app\nlayout:\n  type: horizontal\n  ratio: [1, 19]\n  panes:\n    - { name: left }\n    - { name: right }\n",
    );
    let error = build_herdr_dry_run_steps(&plan).unwrap_err();
    assert_eq!(error.code, "SPLIT_SIZE_RESOLUTION_FAILED");
    assert_eq!(
        error.message,
        "Herdr requires both sides of a split to occupy at least 10%"
    );
}

#[test]
fn focuses_an_ancestor_branch_that_contains_the_final_focus_pane() {
    let plan = emission(
        "name: nested\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: left }\n    - type: vertical\n      ratio: [1, 1]\n      panes:\n        - { name: nested, focus: true }\n        - { name: other }\n",
    );
    let steps = build_herdr_dry_run_steps(&plan).unwrap();
    assert!(steps[0].command.ends_with("--focus"));
    assert!(steps[1].command.ends_with("--no-focus"));
}

#[test]
fn creates_tab_and_applies_terminal_setup() {
    let mut fake = FakeHerdr::new().tabs([tab_created("pane-1", "tab-2")]);
    let plan = emission(
        "name: app\nlayout:\n  name: editor\n  cwd: /repo/editor\n  env: { MODE: dev }\n  title: Editor\n  command: nvim\n",
    );
    let result = execute_herdr_plan(
        &plan,
        &mut fake,
        ExecuteHerdrPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: Some("/fallback"),
            pane_id: None,
            workspace_id: Some("workspace-1"),
            window_name: Some("Development"),
            on_confirm_kill: None,
        },
    )
    .unwrap();

    assert_eq!(result.window_id, "tab-2");
    assert_eq!(result.focus_pane_id.as_deref(), Some("pane-1"));
    assert!(command_exists(
        &fake,
        &[
            "tab",
            "create",
            "--workspace",
            "workspace-1",
            "--cwd",
            "/repo/editor",
            "--label",
            "Development",
            "--focus",
        ]
    ));
    assert!(command_exists(
        &fake,
        &["pane", "rename", "pane-1", "Editor"]
    ));
    assert!(command_exists(
        &fake,
        &["pane", "run", "pane-1", "export MODE='dev'"]
    ));
    assert!(command_exists(&fake, &["pane", "run", "pane-1", "nvim"]));
}

#[test]
fn reuses_current_tab_and_closes_only_its_siblings() {
    let current = pane("pane-1", "tab-1", true);
    let mut fake = FakeHerdr::new()
        .currents([json!({ "result": { "type": "pane_current", "pane": current } })])
        .lists([json!({
            "result": {
                "type": "pane_list",
                "panes": [
                    pane("pane-1", "tab-1", true),
                    pane("pane-2", "tab-1", false),
                    pane("pane-3", "tab-2", false),
                ]
            }
        })]);
    let mut confirmed = Vec::new();
    let mut confirm = |panes: &[String], _dry_run: bool| {
        confirmed = panes.to_vec();
        true
    };
    let result = execute_herdr_plan(
        &emission("name: current\n"),
        &mut fake,
        ExecuteHerdrPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            cwd: None,
            pane_id: Some("pane-1"),
            workspace_id: None,
            window_name: None,
            on_confirm_kill: Some(&mut confirm),
        },
    )
    .unwrap();

    assert_eq!(confirmed, ["pane-2"]);
    assert_eq!(result.window_id, "tab-1");
    assert!(command_exists(&fake, &["pane", "close", "pane-2"]));
    assert!(!command_exists(&fake, &["pane", "close", "pane-3"]));
}

#[test]
fn splits_with_reversed_percent_ratio_and_focuses_during_creation() {
    let mut fake = FakeHerdr::new()
        .tabs([tab_created("pane-1", "tab-1")])
        .splits([pane_result(pane("pane-2", "tab-1", true))]);
    let plan = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: left }\n    - { name: right, focus: true }\n",
    );
    let result = execute_herdr_plan(
        &plan,
        &mut fake,
        ExecuteHerdrPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: Some("/repo"),
            pane_id: None,
            workspace_id: None,
            window_name: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();

    assert_eq!(result.focus_pane_id.as_deref(), Some("pane-2"));
    assert!(command_exists(
        &fake,
        &[
            "pane",
            "split",
            "pane-1",
            "--direction",
            "right",
            "--ratio",
            "0.5",
            "--focus",
        ]
    ));
}

#[test]
fn resolves_single_child_terminal_ids_through_split_ancestors() {
    let mut fake = FakeHerdr::new()
        .tabs([tab_created("pane-1", "tab-1")])
        .splits([pane_result(pane("pane-2", "tab-1", true))]);
    let plan = emission(
        "name: nested-single\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: left }\n    - type: vertical\n      ratio: [1]\n      panes:\n        - { name: nested, command: echo-nested, focus: true }\n",
    );

    let result = execute_herdr_plan(
        &plan,
        &mut fake,
        ExecuteHerdrPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: Some("/repo"),
            pane_id: None,
            workspace_id: None,
            window_name: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();

    assert_eq!(result.pane_map["root.1.0"], "pane-2");
    assert_eq!(result.pane_name_to_real_id["nested"], "pane-2");
    assert!(command_exists(
        &fake,
        &["pane", "run", "pane-2", "echo-nested"]
    ));
}

#[test]
fn resolves_fixed_cells_from_herdr_layout_dimensions() {
    let mut fake = FakeHerdr::new()
        .tabs([tab_created("pane-1", "tab-1")])
        .layouts([json!({
            "result": {
                "type": "pane_layout",
                "layout": {
                    "workspace_id": "workspace-1",
                    "tab_id": "tab-1",
                    "panes": [{ "pane_id": "pane-1", "rect": { "width": 100, "height": 40 } }]
                }
            }
        })])
        .splits([pane_result(pane("pane-2", "tab-1", false))]);
    let plan = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [\"30c\", 1]\n  panes:\n    - { name: fixed }\n    - { name: rest }\n",
    );
    execute_herdr_plan(
        &plan,
        &mut fake,
        ExecuteHerdrPlanOptions {
            window_mode: WindowMode::NewWindow,
            cwd: Some("/repo"),
            pane_id: None,
            workspace_id: None,
            window_name: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();

    assert!(command_exists(
        &fake,
        &[
            "pane",
            "split",
            "pane-1",
            "--direction",
            "right",
            "--ratio",
            "0.3",
            "--no-focus",
        ]
    ));
}
