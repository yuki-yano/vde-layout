use std::process::{Command, Stdio};

use vde_layout::WindowMode;
use vde_layout::core::compile_core_pipeline;
use vde_layout::executor::{ExecuteTmuxPlanOptions, ProcessCommandExecutor, execute_tmux_plan};

#[test]
#[ignore = "requires an installed tmux binary and creates an isolated tmux socket"]
fn applies_a_plan_on_an_isolated_tmux_socket() {
    let socket = format!("vde-layout-rust-test-{}", std::process::id());
    let session = format!("vde-layout-test-{}", std::process::id());
    let cleanup = || {
        let _ = Command::new("tmux")
            .args(["-L", &socket, "kill-server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    };
    cleanup();
    let status = Command::new("tmux")
        .args([
            "-L",
            &socket,
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-s",
            &session,
        ])
        .status()
        .expect("tmux must be installed for the ignored live test");
    assert!(status.success());

    let result = (|| {
        let pipeline = compile_core_pipeline(
            "name: live\nlayout:\n  type: horizontal\n  ratio: [1, 1]\n  panes:\n    - { name: main, focus: true }\n    - { name: logs }\n",
            "tests/tmux_live.yml",
        )?;
        let mut executor = ProcessCommandExecutor::new("tmux")
            .with_leading_args(["-L".to_owned(), socket.clone()]);
        execute_tmux_plan(
            &pipeline.emission,
            &mut executor,
            ExecuteTmuxPlanOptions {
                window_mode: WindowMode::NewWindow,
                window_name: Some("rust-live"),
                tmux_pane: None,
                detected_version: None,
                on_confirm_kill: None,
            },
        )
    })();
    cleanup();

    let result = result.unwrap();
    assert_eq!(result.executed_steps, 2);
    assert_eq!(result.pane_map.len(), 2);
}
