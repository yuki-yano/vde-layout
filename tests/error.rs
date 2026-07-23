use serde_json::json;
use vde_layout::error::{empty_details, object_details};
use vde_layout::{ErrorCode, ErrorKind, VdeError, format_error};

#[test]
fn creates_typed_errors_with_metadata() {
    let error = VdeError::config(
        ErrorCode::ConfigNotFound,
        "Config file not found",
        object_details(json!({ "searchPaths": ["/one", "/two"] })),
    );
    assert_eq!(error.kind, ErrorKind::Config);
    assert_eq!(error.code.to_string(), "CONFIG_NOT_FOUND");
    assert_eq!(error.details["searchPaths"][1], "/two");

    let validation = VdeError::validation(
        ErrorCode::InvalidPreset,
        "Invalid preset",
        object_details(json!({ "errors": ["ratio mismatch"] })),
    );
    assert_eq!(validation.kind, ErrorKind::Validation);
}

#[test]
fn formats_config_search_path_guidance() {
    let error = VdeError::config(
        ErrorCode::ConfigNotFound,
        "Configuration file not found",
        object_details(json!({ "searchPaths": ["/home/user/layout.yml"] })),
    );
    let formatted = format_error(&error);
    assert!(formatted.contains("Searched in the following locations:"));
    assert!(formatted.contains("/home/user/layout.yml"));
    assert!(formatted.contains("To create a configuration file, run:"));
}

#[test]
fn formats_nested_command_stderr_and_preset_details() {
    let error = VdeError::new(
        ErrorKind::Tmux,
        ErrorCode::TmuxCommandFailed,
        "tmux command failed",
        object_details(json!({
            "command": "tmux split-window -h",
            "stderr": "can't find session",
            "preset": "dev",
            "errors": ["bad pane"]
        })),
    );
    let formatted = format_error(&error);
    assert!(formatted.contains("Command: \"tmux split-window -h\""));
    assert!(formatted.contains("stderr: can't find session"));
    assert!(formatted.contains("preset: dev"));
    assert!(formatted.contains("bad pane"));
}

#[test]
fn formats_tmux_environment_guidance() {
    let not_in_session = VdeError::new(
        ErrorKind::Tmux,
        ErrorCode::NotInTmuxSession,
        "not in session",
        empty_details(),
    );
    let missing = VdeError::new(
        ErrorKind::Environment,
        ErrorCode::TmuxNotInstalled,
        "tmux missing",
        empty_details(),
    );
    assert!(format_error(&not_in_session).contains("must be run inside a tmux session"));
    assert!(format_error(&missing).contains("Install tmux using your package manager"));
}

#[test]
fn formats_backend_and_wezterm_guidance() {
    let backend = VdeError::new(
        ErrorKind::Environment,
        ErrorCode::BackendNotFound,
        "backend not found",
        object_details(json!({ "backend": "wezterm" })),
    );
    let formatted = format_error(&backend);
    assert!(formatted.contains("Missing binary: wezterm"));
    assert!(formatted.contains("Install wezterm using your package manager"));

    let unsupported = VdeError::new(
        ErrorKind::Environment,
        ErrorCode::UnsupportedWeztermVersion,
        "wezterm version",
        object_details(json!({
            "detectedVersion": "20240203-110809",
            "requiredVersion": "20240203-110000"
        })),
    );
    let formatted = format_error(&unsupported);
    assert!(formatted.contains("Detected version: 20240203-110809"));
    assert!(formatted.contains("Required version: 20240203-110000 or higher"));
}

#[test]
fn formats_herdr_guidance() {
    let backend = VdeError::new(
        ErrorKind::Environment,
        ErrorCode::BackendNotFound,
        "backend not found",
        object_details(json!({ "backend": "herdr" })),
    );
    assert!(format_error(&backend).contains("herdr is required but not installed"));

    let unsupported = VdeError::new(
        ErrorKind::Environment,
        ErrorCode::UnsupportedHerdrVersion,
        "herdr version",
        object_details(json!({
            "detectedVersion": "0.7.3",
            "requiredVersion": "0.7.4"
        })),
    );
    let formatted = format_error(&unsupported);
    assert!(formatted.contains("Detected version: 0.7.3"));
    assert!(formatted.contains("Required version: 0.7.4 or higher"));
}

#[test]
fn formats_split_resolution_details() {
    let error = VdeError::new(
        ErrorKind::Environment,
        ErrorCode::SplitSizeResolutionFailed,
        "split size failed",
        object_details(json!({
            "paneId": "100",
            "paneCells": 80,
            "detectedVersion": "20240203",
            "requiredVersion": "20220624"
        })),
    );
    let formatted = format_error(&error);
    for expected in [
        "Pane ID: 100",
        "Pane cells: 80",
        "Detected version: 20240203",
        "Required version: 20220624",
    ] {
        assert!(formatted.contains(expected));
    }
}
