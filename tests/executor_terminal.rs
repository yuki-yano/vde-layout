use indexmap::indexmap;
use vde_layout::core::EmittedTerminal;
use vde_layout::executor::{prepare_terminal_commands, shell_quote_literal};

fn terminal() -> EmittedTerminal {
    EmittedTerminal {
        virtual_pane_id: "root.0".to_owned(),
        command: Some("echo {{this_pane}} {{focus_pane}} {{pane_id:logs}}".to_owned()),
        cwd: Some("/tmp/it's here".to_owned()),
        env: Some(indexmap! { "APP_MODE".to_owned() => "it's dev".to_owned() }),
        delay: Some(125.5),
        title: Some("Main".to_owned()),
        focus: true,
        name: "main".to_owned(),
        ephemeral: Some(true),
        close_on_error: None,
    }
}

#[test]
fn quotes_and_prepares_terminal_commands() {
    let terminals = vec![
        terminal(),
        EmittedTerminal {
            virtual_pane_id: "root.1".to_owned(),
            command: None,
            cwd: None,
            env: None,
            delay: None,
            title: None,
            focus: false,
            name: "logs".to_owned(),
            ephemeral: None,
            close_on_error: None,
        },
    ];
    let panes = indexmap! {
        "root.0".to_owned() => "%1".to_owned(),
        "root.1".to_owned() => "%2".to_owned(),
    };
    let prepared = prepare_terminal_commands(&terminals, "root.0", &panes).unwrap();
    assert_eq!(prepared.focus_pane_real_id, "%1");
    let main = &prepared.commands[0];
    assert_eq!(
        main.cwd_command.as_deref(),
        Some("cd -- '/tmp/it'\"'\"'s here'")
    );
    assert_eq!(
        main.env_commands[0].command,
        "export APP_MODE='it'\"'\"'s dev'"
    );
    assert_eq!(
        main.command.as_ref().unwrap().text,
        "echo %1 %1 %2; [ $? -eq 0 ] && exit"
    );
    assert_eq!(main.command.as_ref().unwrap().delay_ms, 125.5);
    assert_eq!(main.title.as_deref(), Some("Main"));
    assert_eq!(shell_quote_literal("plain"), "'plain'");
}

#[test]
fn supports_close_on_error_and_rejects_bad_inputs() {
    let mut pane = terminal();
    pane.close_on_error = Some(true);
    pane.env = Some(indexmap! { "BAD-KEY".to_owned() => "x".to_owned() });
    let panes = indexmap! { "root.0".to_owned() => "%1".to_owned() };
    assert_eq!(
        prepare_terminal_commands(&[pane.clone()], "root.0", &panes)
            .unwrap_err()
            .code,
        "INVALID_PANE"
    );
    pane.env = None;
    pane.command = Some("echo ok".to_owned());
    let prepared = prepare_terminal_commands(&[pane], "root.0", &panes).unwrap();
    assert_eq!(
        prepared.commands[0].command.as_ref().unwrap().text,
        "echo ok; exit"
    );

    assert_eq!(
        prepare_terminal_commands(&[], "missing", &panes)
            .unwrap_err()
            .code,
        "INVALID_PANE"
    );
}

#[test]
fn maps_template_failures_to_typed_execution_errors() {
    let mut pane = terminal();
    pane.command = Some("echo {{window_id}}".to_owned());
    let panes = indexmap! { "root.0".to_owned() => "%1".to_owned() };
    let error = prepare_terminal_commands(&[pane], "root.0", &panes).unwrap_err();
    assert_eq!(error.code, "TEMPLATE_TOKEN_ERROR");
    assert_eq!(error.details["tokenType"], "window_id");
}
