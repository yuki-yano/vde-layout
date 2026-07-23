use serde_json::json;
use vde_layout::executor::parse_wezterm_list_result;

#[test]
fn parses_array_output_and_groups_windows_tabs_and_sizes() {
    let parsed = parse_wezterm_list_result(
        &json!([
            {
                "window_id": 1,
                "tab_id": 2,
                "pane_id": 10,
                "workspace": "dev",
                "is_active": true,
                "size": { "cols": 120.0, "rows": 40 },
            },
            { "window_id": 1, "tab_id": 2, "pane_id": 11, "is_active": false },
            { "window_id": 1, "tab_id": 3, "pane_id": 12 },
            { "window_id": 2, "pane_id": 20, "workspace": "later" },
            { "window_id": 2, "tab_id": 4, "pane_id": 21, "workspace": "ops", "is_active": true },
            { "window_id": null, "pane_id": 99 },
        ])
        .to_string(),
    )
    .unwrap();
    assert_eq!(parsed.windows.len(), 2);
    let first = &parsed.windows[0];
    assert_eq!(first.window_id, "1");
    assert!(first.is_active);
    assert_eq!(first.workspace.as_deref(), Some("dev"));
    assert_eq!(first.tabs.len(), 2);
    assert_eq!(first.tabs[0].panes[0].size.unwrap().cols, Some(120));
    assert_eq!(first.tabs[0].panes[0].size.unwrap().rows, Some(40));
    assert_eq!(
        first.tabs[0].panes[0].raw_pane_record["sourceFormat"],
        "wezterm-array"
    );
    assert_eq!(parsed.windows[1].tabs[0].tab_id, "2");
    assert_eq!(parsed.windows[1].workspace.as_deref(), Some("later"));
}

#[test]
fn parses_object_output_and_filters_invalid_records() {
    let parsed = parse_wezterm_list_result(
        &json!({
            "windows": [
                {
                    "window_id": "w1",
                    "is_active": true,
                    "workspace": "dev",
                    "tabs": [
                        {
                            "tab_id": "tab-1",
                            "is_active": true,
                            "panes": [
                                { "pane_id": "10", "is_active": true, "size": { "cols": -1, "rows": 30 } },
                                { "pane_id": null },
                            ],
                        },
                        { "tab_id": null, "panes": [] },
                    ],
                },
                { "window_id": null, "tabs": [] },
            ],
        })
        .to_string(),
    )
    .unwrap();
    assert_eq!(parsed.windows.len(), 1);
    assert_eq!(parsed.windows[0].tabs.len(), 1);
    let pane = &parsed.windows[0].tabs[0].panes[0];
    assert_eq!(pane.pane_id, "10");
    assert_eq!(pane.size.unwrap().cols, None);
    assert_eq!(pane.size.unwrap().rows, Some(30));
    assert_eq!(pane.raw_pane_record["sourceFormat"], "wezterm-object");
}

#[test]
fn rejects_non_json_and_non_collection_roots() {
    assert!(parse_wezterm_list_result("not-json").is_none());
    assert!(parse_wezterm_list_result("null").is_none());
    assert!(parse_wezterm_list_result("true").is_none());
    assert_eq!(parse_wezterm_list_result("{}").unwrap().windows.len(), 0);
}
