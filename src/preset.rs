use std::path::PathBuf;

use serde_json::json;

use crate::config::{ConfigLoader, ConfigLoaderOptions};
use crate::error::{ErrorCode, VdeError, empty_details, object_details};
use crate::model::{Config, ConfigDefaults, Preset, PresetInfo};

pub struct PresetManager {
    loader_options: ConfigLoaderOptions,
    cached_config: Option<Config>,
}

impl PresetManager {
    pub fn new(options: ConfigLoaderOptions) -> Self {
        Self {
            loader_options: options,
            cached_config: None,
        }
    }

    pub fn set_config_path(&mut self, file_path: impl Into<PathBuf>) {
        self.loader_options.config_paths = Some(vec![file_path.into()]);
        self.cached_config = None;
    }

    pub fn load_config(&mut self) -> Result<(), VdeError> {
        self.cached_config = Some(ConfigLoader::new(self.loader_options.clone()).load_config()?);
        Ok(())
    }

    pub fn get_preset(&self, name: &str) -> Result<&Preset, VdeError> {
        let config = self.ensure_config()?;
        config.presets.get(name).ok_or_else(|| {
            VdeError::config(
                ErrorCode::PresetNotFound,
                format!("Preset \"{name}\" not found"),
                object_details(json!({
                    "availablePresets": config.presets.keys().collect::<Vec<_>>(),
                })),
            )
        })
    }

    pub fn list_presets(&self) -> Vec<PresetInfo> {
        let Some(config) = &self.cached_config else {
            return Vec::new();
        };
        config
            .presets
            .iter()
            .map(|(key, preset)| PresetInfo {
                key: key.clone(),
                name: preset.name.clone(),
                description: preset.description.clone(),
            })
            .collect()
    }

    pub fn get_default_preset(&self) -> Result<&Preset, VdeError> {
        let config = self.ensure_config()?;
        if let Some(preset) = config.presets.get("default") {
            return Ok(preset);
        }
        config
            .presets
            .first()
            .map(|(_, preset)| preset)
            .ok_or_else(|| {
                VdeError::config(
                    ErrorCode::PresetNotFound,
                    "No presets defined",
                    empty_details(),
                )
            })
    }

    pub fn get_defaults(&self) -> Result<Option<&ConfigDefaults>, VdeError> {
        Ok(self.ensure_config()?.defaults.as_ref())
    }

    fn ensure_config(&self) -> Result<&Config, VdeError> {
        self.cached_config.as_ref().ok_or_else(|| {
            VdeError::config(
                ErrorCode::ConfigNotFound,
                "Configuration not loaded",
                empty_details(),
            )
        })
    }
}

impl Default for PresetManager {
    fn default() -> Self {
        Self::new(ConfigLoaderOptions::default())
    }
}
