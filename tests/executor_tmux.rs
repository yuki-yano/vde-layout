use std::collections::HashMap;

use indexmap::indexmap;
use vde_layout::WindowMode;
use vde_layout::core::{CoreError, CoreErrorKind, compile_core_pipeline};
use vde_layout::executor::{
    CommandExecutor, ExecuteTmuxPlanOptions, PaneDimensions, apply_tmux_plan,
    build_tmux_dry_run_steps, execute_tmux_plan, resolve_initial_tmux_pane_size,
    resolve_pane_mapping, verify_tmux_environment,
};

#[derive(Debug)]
struct FakeTmux {
    commands: Vec<Vec<String>>,
    panes: Vec<String>,
    sidebars: Vec<String>,
    sizes: HashMap<String, u64>,
    counter: u32,
    dry_run: bool,
    fail_on: Option<String>,
    skip_split_creation: bool,
    pane_size_output: Option<String>,
}

impl FakeTmux {
    fn new() -> Self {
        Self {
            commands: Vec::new(),
            panes: vec!["%0".to_owned()],
            sidebars: Vec::new(),
            sizes: HashMap::from([("%0".to_owned(), 200)]),
            counter: 0,
            dry_run: false,
            fail_on: None,
            skip_split_creation: false,
            pane_size_output: None,
        }
    }

    fn next_pane(&mut self) -> String {
        self.counter += 1;
        format!("%{}", self.counter)
    }
}

impl CommandExecutor for FakeTmux {
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
                "TMUX_COMMAND_FAILED",
                "injected tmux failure",
            ));
        }
        match args.first().map(String::as_str) {
            Some("-V") => Ok("tmux 3.4".to_owned()),
            Some("new-window") => {
                self.counter = 10;
                self.panes = vec!["%10".to_owned()];
                self.sizes = HashMap::from([("%10".to_owned(), 200)]);
                Ok("%10".to_owned())
            }
            Some("list-panes") if joined.contains("@vde_sidebar") => Ok(self
                .panes
                .iter()
                .map(|pane| {
                    format!(
                        "{pane}\t{}",
                        if self.sidebars.contains(pane) {
                            "1"
                        } else {
                            ""
                        }
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")),
            Some("list-panes") => Ok(self.panes.join("\n")),
            Some("display-message")
                if joined.contains("#{pane_width} #{pane_height} #{@vde_sidebar}") =>
            {
                if let Some(output) = self.pane_size_output.as_ref() {
                    return Ok(output.clone());
                }
                let target = argument_after(args, "-t").unwrap_or("%0");
                Ok(format!(
                    "{} 60 {}",
                    self.sizes.get(target).copied().unwrap_or(200),
                    if self.sidebars.iter().any(|pane| pane == target) {
                        "1"
                    } else {
                        ""
                    }
                ))
            }
            Some("display-message") if joined.contains("#{pane_width} #{pane_height}") => {
                if let Some(output) = self.pane_size_output.as_ref() {
                    return Ok(output.clone());
                }
                let target = argument_after(args, "-t").unwrap_or("%0");
                Ok(format!(
                    "{} 60",
                    self.sizes.get(target).copied().unwrap_or(200)
                ))
            }
            Some("display-message")
                if joined.contains("pane_width") || joined.contains("pane_height") =>
            {
                let target = argument_after(args, "-t").unwrap_or("%0");
                Ok(self.sizes.get(target).copied().unwrap_or(200).to_string())
            }
            Some("display-message") if joined.contains("pane_id") => {
                Ok(self.panes.first().cloned().unwrap_or_default())
            }
            Some("display-message") if joined.contains("window_id") => Ok("@5".to_owned()),
            Some("split-window") => {
                if self.skip_split_creation {
                    return Ok(String::new());
                }
                let target = argument_after(args, "-t").unwrap_or("%0").to_owned();
                let old_size = self.sizes.get(&target).copied().unwrap_or(200);
                let created_size = if let Some(cells) = argument_after(args, "-l") {
                    cells
                        .strip_suffix('%')
                        .map(|percent| old_size * percent.parse::<u64>().unwrap_or(50) / 100)
                        .unwrap_or_else(|| cells.parse::<u64>().unwrap_or(old_size / 2))
                } else {
                    old_size / 2
                };
                let new_pane = self.next_pane();
                self.panes.push(new_pane.clone());
                self.sizes
                    .insert(target, old_size.saturating_sub(created_size));
                self.sizes.insert(new_pane.clone(), created_size);
                if args.iter().any(|arg| arg == "-P") {
                    Ok(new_pane)
                } else {
                    Ok(String::new())
                }
            }
            Some("kill-pane") => {
                if let Some(target) = argument_after(args, "-t") {
                    self.panes.retain(|pane| pane != target);
                    self.sizes.remove(target);
                }
                Ok(String::new())
            }
            _ => Ok(String::new()),
        }
    }

    fn is_dry_run(&self) -> bool {
        self.dry_run
    }
}

fn argument_after<'a>(args: &'a [String], needle: &str) -> Option<&'a str> {
    args.iter()
        .position(|arg| arg == needle)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
}

fn emission(document: &str) -> vde_layout::core::PlanEmission {
    compile_core_pipeline(document, "tests/tmux.yml")
        .unwrap()
        .emission
}

#[test]
fn verifies_environment_and_builds_dry_run_from_the_same_emission() {
    let mut fake = FakeTmux::new();
    assert_eq!(
        verify_tmux_environment(&mut fake, true).unwrap().as_deref(),
        Some("3.4")
    );
    assert_eq!(
        verify_tmux_environment(&mut fake, false).unwrap_err().code,
        "NOT_IN_TMUX_SESSION"
    );

    let plan = emission(
        "name: dry\nlayout:\n  type: horizontal\n  ratio: [\"90c\", 2, 1]\n  panes:\n    - { name: fixed }\n    - { name: middle }\n    - { name: right }\n",
    );
    let steps = build_tmux_dry_run_steps(
        &plan,
        Some(PaneDimensions {
            cols: 200,
            rows: 60,
        }),
        Some("3.4"),
    )
    .unwrap();
    assert_eq!(steps.len(), plan.steps.len());
    assert!(steps[0].command.ends_with("-l 110"));
    assert!(steps[1].command.ends_with("-l 37"));
    assert_eq!(steps.last().unwrap().command, "tmux select-pane -t root.0");

    let unresolved = build_tmux_dry_run_steps(&plan, None, None).unwrap();
    assert!(unresolved[0].command.ends_with("-l <dynamic>"));

    let too_small =
        build_tmux_dry_run_steps(&plan, Some(PaneDimensions { cols: 50, rows: 20 }), None).unwrap();
    assert!(too_small[0].command.ends_with("-l <dynamic>"));
}

#[test]
fn resolves_dry_run_initial_size_and_corrects_sidebar_origin() {
    let mut fake = FakeTmux::new();
    fake.pane_size_output = Some("120cols 40rows 0".to_owned());
    assert_eq!(
        resolve_initial_tmux_pane_size(&mut fake, Some("session"), Some("%0")),
        Some(PaneDimensions {
            cols: 120,
            rows: 40,
        })
    );
    assert!(
        !fake
            .commands
            .iter()
            .any(|command| command.first().is_some_and(|arg| arg == "list-panes"))
    );

    let mut fake = FakeTmux::new();
    fake.panes = vec!["%0".to_owned(), "%1".to_owned()];
    fake.sidebars = vec!["%0".to_owned()];
    fake.sizes = HashMap::from([("%0".to_owned(), 10), ("%1".to_owned(), 170)]);
    assert_eq!(
        resolve_initial_tmux_pane_size(&mut fake, Some("session"), Some("%0")),
        Some(PaneDimensions {
            cols: 170,
            rows: 60,
        })
    );
    assert!(fake.commands.iter().any(|command| {
        command
            == &[
                "list-panes",
                "-t",
                "%0",
                "-F",
                "#{pane_id}\t#{@vde_sidebar}",
            ]
    }));

    let mut fake = FakeTmux::new();
    fake.sidebars = vec!["%0".to_owned()];
    assert_eq!(
        resolve_initial_tmux_pane_size(&mut fake, Some("session"), Some("%0")),
        None
    );

    let mut fake = FakeTmux::new();
    assert_eq!(
        resolve_initial_tmux_pane_size(&mut fake, None, Some("%0")),
        None
    );
    assert!(fake.commands.is_empty());
}

#[test]
fn resolves_ancestor_and_descendant_virtual_pane_mappings() {
    let mut panes = indexmap! { "root.1".to_owned() => "%2".to_owned() };
    assert_eq!(
        resolve_pane_mapping(&mut panes, "root.1.0").as_deref(),
        Some("%2")
    );
    assert_eq!(
        resolve_pane_mapping(&mut panes, "root").as_deref(),
        Some("%2")
    );
    assert_eq!(panes.get("root.1.0").map(String::as_str), Some("%2"));
    assert_eq!(panes.get("root").map(String::as_str), Some("%2"));

    let plan = emission(
        "name: nested\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { type: vertical, ratio: [1, 1], panes: [{ name: two }, { name: three, focus: true }] }\n",
    );
    let mut fake = FakeTmux::new();
    let result = execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: None,
            tmux_pane: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.pane_map["root.1.0"], "%11");
    assert_eq!(result.pane_map["root.1.1"], "%12");

    let single_child = emission(
        "name: nested-single\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - type: vertical\n      ratio: [1]\n      panes:\n        - { name: nested, command: echo-nested, focus: true }\n",
    );
    let mut fake = FakeTmux::new();
    let result = execute_tmux_plan(
        &single_child,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: None,
            tmux_pane: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.pane_map["root.1.0"], "%11");
    assert!(
        fake.commands
            .iter()
            .any(|command| { command == &["send-keys", "-t", "%11", "echo-nested", "Enter",] })
    );
}

#[test]
fn applies_new_window_plan_and_terminal_commands() {
    let plan = emission(
        "name: tmux\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: main, command: nvim, cwd: /work, focus: true }\n    - { name: logs, command: htop }\n",
    );
    let mut fake = FakeTmux::new();
    let result = execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: Some("dev"),
            tmux_pane: None,
            detected_version: Some("3.4"),
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.executed_steps, plan.steps.len());
    assert_eq!(result.pane_map["root.0"], "%10");
    assert_eq!(result.pane_map["root.1"], "%11");
    assert!(
        fake.commands
            .iter()
            .any(|command| command == &["new-window", "-P", "-F", "#{pane_id}", "-n", "dev"])
    );
    assert!(
        fake.commands
            .iter()
            .any(|command| command == &["split-window", "-h", "-t", "%10", "-l", "50%"])
    );
    assert!(
        fake.commands
            .iter()
            .any(|command| command.iter().any(|arg| arg == "cd -- '/work'"))
    );
    assert!(
        fake.commands
            .iter()
            .any(|command| command.iter().any(|arg| arg == "nvim"))
    );
}

#[test]
fn backend_result_exposes_focus_name_map_and_window_id() {
    let plan = emission(
        "name: names\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: editor, focus: true }\n    - { name: logs }\n",
    );
    let mut fake = FakeTmux::new();
    let result = apply_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: None,
            tmux_pane: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.focus_pane_id.as_deref(), Some("%10"));
    assert_eq!(result.pane_name_to_real_id["editor"], "%10");
    assert_eq!(result.pane_name_to_real_id["logs"], "%11");
    assert_eq!(result.window_id.as_deref(), Some("@5"));
    assert_eq!(
        fake.commands
            .iter()
            .filter(|command| command.iter().any(|arg| arg == "#{window_id}"))
            .count(),
        1
    );
}

#[test]
fn resolves_dynamic_cell_splits_from_live_pane_sizes() {
    let plan = emission(
        "name: dynamic\nlayout:\n  type: horizontal\n  ratio: [\"90c\", 2, 1]\n  panes:\n    - { name: fixed }\n    - { name: middle }\n    - { name: right }\n",
    );
    let mut fake = FakeTmux::new();
    execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: None,
            tmux_pane: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert!(
        fake.commands
            .iter()
            .any(|command| command.windows(2).any(|pair| pair == ["-l", "110"]))
    );
    assert!(
        fake.commands
            .iter()
            .any(|command| command.windows(2).any(|pair| pair == ["-l", "37"]))
    );
}

#[test]
fn current_window_preserves_sidebar_and_closes_only_other_normal_panes() {
    let plan = emission("name: single\ncommand: fish\n");
    let mut fake = FakeTmux::new();
    fake.panes = vec!["%0".to_owned(), "%1".to_owned(), "%2".to_owned()];
    fake.sidebars = vec!["%0".to_owned()];
    fake.sizes = HashMap::from([
        ("%0".to_owned(), 30),
        ("%1".to_owned(), 170),
        ("%2".to_owned(), 170),
    ]);
    fake.counter = 2;
    let mut confirmed_with = Vec::new();
    let mut confirm = |panes: &[String], _dry: bool| {
        confirmed_with = panes.to_vec();
        true
    };
    let result = execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            window_name: None,
            tmux_pane: Some("%0"),
            detected_version: None,
            on_confirm_kill: Some(&mut confirm),
        },
    )
    .unwrap();
    assert_eq!(confirmed_with, vec!["%2"]);
    assert_eq!(result.pane_map["root"], "%1");
    assert!(fake.panes.contains(&"%0".to_owned()));
    assert!(!fake.panes.contains(&"%2".to_owned()));
    assert!(
        !fake
            .commands
            .iter()
            .any(|command| command.iter().any(|arg| arg == "-a"))
    );
}

#[test]
fn splits_an_origin_beside_a_sidebar_only_window() {
    let plan = emission("name: single\n");
    let mut fake = FakeTmux::new();
    fake.sidebars = vec!["%0".to_owned()];
    let result = execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            window_name: None,
            tmux_pane: Some("%0"),
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap();
    assert_eq!(result.pane_map["root"], "%1");
    assert!(fake.commands.iter().any(|command| command == &["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", "%0"]));
}

#[test]
fn supports_cancellation_and_command_failure_injection() {
    let plan = emission("name: current\n");
    let mut fake = FakeTmux::new();
    fake.panes = vec!["%0".to_owned(), "%1".to_owned()];
    let mut cancel = |_panes: &[String], _dry: bool| false;
    let error = execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::CurrentWindow,
            window_name: None,
            tmux_pane: Some("%0"),
            detected_version: None,
            on_confirm_kill: Some(&mut cancel),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "USER_CANCELLED");

    let plan = emission(
        "name: fail\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two }\n",
    );
    let mut fake = FakeTmux::new();
    fake.fail_on = Some("split-window".to_owned());
    let error = execute_tmux_plan(
        &plan,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: None,
            tmux_pane: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "TMUX_COMMAND_FAILED");
    assert_eq!(error.path.as_deref(), Some("root:split:1"));
    assert!(error.details.contains_key("command"));
}

#[test]
fn rejects_missing_plan_metadata_and_unresolvable_panes_without_panicking() {
    let mut missing_initial = emission("name: missing\n");
    missing_initial.summary.initial_pane_id.clear();
    let mut fake = FakeTmux::new();
    assert_eq!(
        execute_tmux_plan(
            &missing_initial,
            &mut fake,
            ExecuteTmuxPlanOptions {
                window_mode: WindowMode::NewWindow,
                window_name: None,
                tmux_pane: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "INVALID_PLAN"
    );

    let mut missing_target = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two }\n",
    );
    missing_target.steps[0].target_pane_id = None;
    let mut fake = FakeTmux::new();
    assert_eq!(
        execute_tmux_plan(
            &missing_target,
            &mut fake,
            ExecuteTmuxPlanOptions {
                window_mode: WindowMode::NewWindow,
                window_name: None,
                tmux_pane: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "MISSING_TARGET"
    );

    let plan = emission(
        "name: split\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: one }\n    - { name: two }\n",
    );
    let mut fake = FakeTmux::new();
    fake.skip_split_creation = true;
    assert_eq!(
        execute_tmux_plan(
            &plan,
            &mut fake,
            ExecuteTmuxPlanOptions {
                window_mode: WindowMode::NewWindow,
                window_name: None,
                tmux_pane: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "INVALID_PANE"
    );

    let mut missing_terminal = emission("name: terminal\ncommand: echo\n");
    missing_terminal.terminals[0].virtual_pane_id = "unknown".to_owned();
    let mut fake = FakeTmux::new();
    assert_eq!(
        execute_tmux_plan(
            &missing_terminal,
            &mut fake,
            ExecuteTmuxPlanOptions {
                window_mode: WindowMode::NewWindow,
                window_name: None,
                tmux_pane: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "INVALID_PANE"
    );

    let mut invalid_delay = emission("name: delayed\ncommand: echo\n");
    invalid_delay.terminals[0].delay = Some(1e300);
    let mut fake = FakeTmux::new();
    assert_eq!(
        execute_tmux_plan(
            &invalid_delay,
            &mut fake,
            ExecuteTmuxPlanOptions {
                window_mode: WindowMode::NewWindow,
                window_name: None,
                tmux_pane: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
        .unwrap_err()
        .code,
        "INVALID_PLAN"
    );

    let mut overflow_delay = emission("name: delayed\ncommand: echo\n");
    overflow_delay.terminals[0].delay = Some(3_000_000_000.0);
    let mut fake = FakeTmux::new();
    let error = execute_tmux_plan(
        &overflow_delay,
        &mut fake,
        ExecuteTmuxPlanOptions {
            window_mode: WindowMode::NewWindow,
            window_name: None,
            tmux_pane: None,
            detected_version: None,
            on_confirm_kill: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "INVALID_PLAN");
    assert_eq!(error.details["maximumDelayMs"], 2_147_483_647.0);

    let mut dry_run_overflow = emission("name: delayed\ncommand: echo\n");
    dry_run_overflow.terminals[0].delay = Some(3_000_000_000.0);
    assert_eq!(
        build_tmux_dry_run_steps(&dry_run_overflow, None, None)
            .unwrap_err()
            .code,
        "INVALID_PLAN"
    );
}
