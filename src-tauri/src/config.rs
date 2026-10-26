use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct Config {
    pub library_path: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("config.json"))
}

/// Default library location, mirroring Calibre's ~/Calibre Library convention.
pub fn default_library_path(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let home = app.path().home_dir()?;
    Ok(home.join("Billy Library"))
}

pub fn load(app: &AppHandle) -> Result<Config, AppError> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(Config {
            library_path: None,
        });
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn save(app: &AppHandle, config: &Config) -> Result<(), AppError> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(config)?;
    fs::write(path, raw)?;
    Ok(())
}
