use indexmap::indexmap;
use vde_layout::core::EmittedTerminal;
use vde_layout::executor::{build_name_to_real_id_map, replace_template_tokens};

fn terminal(id: &str, name: &str) -> EmittedTerminal {
    EmittedTerminal {
        virtual_pane_id: id.to_owned(),
        command: None,
        cwd: None,
        env: None,
        delay: None,
        title: None,
        focus: false,
        name: name.to_owned(),
        ephemeral: None,
        close_on_error: None,
    }
}

#[test]
fn replaces_all_supported_tokens_in_one_pass() {
    let names = indexmap! { "editor".to_owned() => "%1".to_owned() };
    let result = replace_template_tokens(
        "echo {{this_pane}} {{focus_pane}} {{pane_id: editor }} {{window_id}}",
        "%2",
        "%1",
        &names,
        Some("@5"),
    )
    .unwrap();
    assert_eq!(result, "echo %2 %1 %1 @5");
}

#[test]
fn reports_missing_panes_and_window_ids() {
    let names = indexmap! {
        "editor".to_owned() => "%1".to_owned(),
        "logs".to_owned() => "%2".to_owned(),
    };
    let error =
        replace_template_tokens("{{pane_id:missing}}", "%1", "%1", &names, None).unwrap_err();
    assert_eq!(error.token_type, "pane_id");
    assert_eq!(error.available_panes.unwrap(), vec!["editor", "logs"]);

    let error = replace_template_tokens("{{window_id}}", "%1", "%1", &names, None).unwrap_err();
    assert_eq!(error.token_type, "window_id");
}

#[test]
fn leaves_malformed_and_nested_replacement_text_untouched() {
    let names = indexmap! { "name".to_owned() => "{{this_pane}}".to_owned() };
    let result = replace_template_tokens(
        "{{pane_id:name}} {{pane_id:}} {{unknown}}",
        "%1",
        "%1",
        &names,
        None,
    )
    .unwrap();
    assert_eq!(result, "{{this_pane}} {{pane_id:}} {{unknown}}");
}

#[test]
fn name_map_uses_last_duplicate_and_skips_unresolved_panes() {
    let terminals = vec![
        terminal("root.0", "dup"),
        terminal("root.1", "dup"),
        terminal("root.2", "missing"),
    ];
    let panes = indexmap! {
        "root.0".to_owned() => "%1".to_owned(),
        "root.1".to_owned() => "%2".to_owned(),
    };
    let names = build_name_to_real_id_map(&terminals, &panes);
    assert_eq!(names.get("dup").map(String::as_str), Some("%2"));
    assert!(!names.contains_key("missing"));
}
