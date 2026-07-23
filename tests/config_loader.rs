use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tempfile::TempDir;
use vde_layout::{
    ConfigEnvironment, ConfigLoader, ConfigLoaderOptions, SelectSurfaceMode, SelectUiMode,
    WindowMode,
};

fn env(home: &Path, xdg: Option<&Path>, vde: Option<&Path>) -> ConfigEnvironment {
    ConfigEnvironment {
        home_dir: home.to_path_buf(),
        xdg_config_home: xdg.map(Path::to_path_buf),
        vde_config_path: vde.map(Path::to_path_buf),
    }
}

fn loader(
    current_dir: &Path,
    environment: ConfigEnvironment,
    config_paths: Option<Vec<PathBuf>>,
) -> ConfigLoader {
    ConfigLoader::new(ConfigLoaderOptions {
        config_paths,
        current_dir: Some(current_dir.to_path_buf()),
        environment: Some(environment),
        on_warning: None,
    })
}

fn write_config(path: &Path, presets: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, presets).unwrap();
}

fn simple_config(key: &str, name: &str) -> String {
    format!("presets:\n  {key}:\n    name: {name}\n")
}

#[test]
fn builds_default_search_paths() {
    let temp = TempDir::new().unwrap();
    let loader = loader(temp.path(), env(Path::new("/home/user"), None, None), None);
    assert_eq!(
        loader.get_search_paths(),
        [
            PathBuf::from("/home/user/.config/vde/layout/config.yml"),
            PathBuf::from("/home/user/.config/vde/layout.yml"),
        ]
    );
}

#[test]
fn builds_environment_paths_in_priority_order() {
    let temp = TempDir::new().unwrap();
    let loader = loader(
        temp.path(),
        env(
            Path::new("/home/user"),
            Some(Path::new("/xdg/config")),
            Some(Path::new("/vde/config")),
        ),
        None,
    );
    assert_eq!(
        loader.get_search_paths(),
        [
            PathBuf::from("/vde/config/layout.yml"),
            PathBuf::from("/xdg/config/vde/layout/config.yml"),
            PathBuf::from("/xdg/config/vde/layout.yml"),
        ]
    );
}

#[test]
fn explicit_paths_override_all_discovery() {
    let temp = TempDir::new().unwrap();
    let custom = temp.path().join("custom.yml");
    let loader = loader(
        temp.path(),
        env(temp.path(), Some(temp.path()), Some(temp.path())),
        Some(vec![custom.clone()]),
    );
    assert_eq!(loader.get_search_paths(), [custom]);
}

#[test]
fn prefers_nested_xdg_config_over_legacy() {
    let temp = TempDir::new().unwrap();
    let nested = temp.path().join("vde/layout/config.yml");
    let legacy = temp.path().join("vde/layout.yml");
    write_config(&nested, &simple_config("modern", "modern"));
    write_config(&legacy, &simple_config("legacy", "legacy"));
    let loader = loader(temp.path(), env(temp.path(), Some(temp.path()), None), None);
    let config = loader.load_config().unwrap();
    assert!(config.presets.contains_key("modern"));
    assert!(!config.presets.contains_key("legacy"));
    assert_eq!(loader.find_config_file(), Some(nested));
}

#[test]
fn falls_back_to_legacy_xdg_config() {
    let temp = TempDir::new().unwrap();
    let legacy = temp.path().join("vde/layout.yml");
    write_config(&legacy, &simple_config("legacy", "legacy"));
    let loader = loader(temp.path(), env(temp.path(), Some(temp.path()), None), None);
    assert!(loader.load_config().unwrap().presets.contains_key("legacy"));
    assert_eq!(loader.find_config_file(), Some(legacy));
}

#[test]
fn deduplicates_overlapping_vde_and_xdg_paths() {
    let temp = TempDir::new().unwrap();
    let shared = temp.path().join("vde/layout.yml");
    write_config(&shared, &simple_config("shared", "shared"));
    let loader = loader(
        temp.path(),
        env(
            temp.path(),
            Some(temp.path()),
            Some(&temp.path().join("vde")),
        ),
        None,
    );
    let paths = loader.get_search_paths();
    assert_eq!(paths.iter().filter(|path| **path == shared).count(), 1);
    assert_eq!(loader.load_config().unwrap().presets.len(), 1);
}

#[test]
fn discovers_project_config_by_walking_up() {
    let temp = TempDir::new().unwrap();
    let project = temp.path().join("project");
    let nested_work = project.join("src/deep");
    fs::create_dir_all(&nested_work).unwrap();
    let project_config = project.join(".vde/layout/config.yml");
    write_config(&project_config, &simple_config("local", "local"));
    let loader = loader(
        &nested_work,
        env(temp.path(), Some(&temp.path().join("xdg")), None),
        None,
    );
    assert_eq!(loader.get_search_paths()[0], project_config);
    assert!(loader.load_config().unwrap().presets.contains_key("local"));
}

#[test]
fn prefers_nested_project_config_over_legacy() {
    let temp = TempDir::new().unwrap();
    let project = temp.path().join("project");
    fs::create_dir_all(&project).unwrap();
    let nested = project.join(".vde/layout/config.yml");
    let legacy = project.join(".vde/layout.yml");
    write_config(&nested, &simple_config("modern", "modern"));
    write_config(&legacy, &simple_config("legacy", "legacy"));
    let loader = loader(
        &project,
        env(temp.path(), Some(&temp.path().join("xdg")), None),
        None,
    );
    let config = loader.load_config().unwrap();
    assert!(config.presets.contains_key("modern"));
    assert!(!config.presets.contains_key("legacy"));
}

#[test]
fn merges_global_and_project_presets_with_project_precedence() {
    let temp = TempDir::new().unwrap();
    let project = temp.path().join("project");
    let xdg = temp.path().join("xdg");
    fs::create_dir_all(&project).unwrap();
    write_config(
        &xdg.join("vde/layout.yml"),
        "presets:\n  shared:\n    name: global shared\n  dev:\n    name: global dev\n",
    );
    write_config(
        &project.join(".vde/layout.yml"),
        "presets:\n  dev:\n    name: project dev\n",
    );
    let loader = loader(&project, env(temp.path(), Some(&xdg), None), None);
    let config = loader.load_config().unwrap();
    assert_eq!(
        config
            .presets
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["shared", "dev"]
    );
    assert_eq!(config.presets["dev"].name, "project dev");
    assert_eq!(config.presets["shared"].name, "global shared");
}

#[test]
fn merges_defaults_and_emits_conflict_warnings() {
    let temp = TempDir::new().unwrap();
    let project = temp.path().join("project");
    let xdg = temp.path().join("xdg");
    fs::create_dir_all(&project).unwrap();
    write_config(
        &xdg.join("vde/layout.yml"),
        r#"
defaults:
  windowMode: new-window
  selector:
    ui: auto
    surface: inline
    tmuxPopupOpts: 90%,80%
    fzf:
      extraArgs: [--cycle]
presets:
  dev:
    name: global
    windowMode: new-window
"#,
    );
    write_config(
        &project.join(".vde/layout.yml"),
        r#"
defaults:
  windowMode: current-window
  selector:
    surface: tmux-popup
    fzf:
      extraArgs: [--info=inline]
presets:
  dev:
    name: project
    windowMode: current-window
"#,
    );
    let warnings = Arc::new(Mutex::new(Vec::new()));
    let warnings_for_handler = warnings.clone();
    let loader = ConfigLoader::new(ConfigLoaderOptions {
        config_paths: None,
        current_dir: Some(project),
        environment: Some(env(temp.path(), Some(&xdg), None)),
        on_warning: Some(Arc::new(move |message| {
            warnings_for_handler
                .lock()
                .unwrap()
                .push(message.to_owned());
        })),
    });
    let config = loader.load_config().unwrap();
    let defaults = config.defaults.unwrap();
    assert_eq!(defaults.window_mode, Some(WindowMode::CurrentWindow));
    let selector = defaults.selector.unwrap();
    assert_eq!(selector.ui, Some(SelectUiMode::Auto));
    assert_eq!(selector.surface, Some(SelectSurfaceMode::TmuxPopup));
    assert_eq!(selector.tmux_popup_opts.as_deref(), Some("90%,80%"));
    assert_eq!(selector.fzf.unwrap().extra_args.unwrap(), ["--info=inline"]);
    let warnings = warnings.lock().unwrap();
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("defaults.windowMode conflict"))
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("Preset \"dev\" windowMode conflict"))
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("defaults.selector.surface conflict"))
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("defaults.selector.fzf.extraArgs conflict"))
    );
}

#[test]
fn explicit_loader_uses_first_existing_path() {
    let temp = TempDir::new().unwrap();
    let missing = temp.path().join("missing.yml");
    let second = temp.path().join("second.yml");
    write_config(&second, &simple_config("second", "second"));
    let loader = loader(
        temp.path(),
        env(temp.path(), None, None),
        Some(vec![missing, second.clone()]),
    );
    assert_eq!(loader.find_config_file(), Some(second));
    assert!(loader.load_config().unwrap().presets.contains_key("second"));
}

#[test]
fn missing_explicit_config_returns_search_paths() {
    let temp = TempDir::new().unwrap();
    let missing = temp.path().join("missing.yml");
    let loader = loader(
        temp.path(),
        env(temp.path(), None, None),
        Some(vec![missing.clone()]),
    );
    let error = loader.load_config().unwrap_err();
    assert_eq!(error.message, "Configuration file not found");
    assert_eq!(
        error.details["searchPaths"][0],
        missing.to_string_lossy().as_ref()
    );
}

#[test]
fn load_yaml_serializes_merged_configuration() {
    let temp = TempDir::new().unwrap();
    let config_path = temp.path().join("layout.yml");
    write_config(&config_path, &simple_config("dev", "dev"));
    let loader = loader(
        temp.path(),
        env(temp.path(), None, None),
        Some(vec![config_path]),
    );
    let yaml = loader.load_yaml().unwrap();
    assert!(yaml.contains("presets:"));
    assert!(yaml.contains("dev:"));
}
