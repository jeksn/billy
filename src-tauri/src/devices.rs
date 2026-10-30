use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// Volume name as shown in Finder.
    pub name: String,
    /// Absolute mount path, e.g. /Volumes/KOBOeReader.
    pub path: String,
    /// Device family: "kobo", "kindle", or "generic".
    pub kind: String,
    /// Human-friendly label for menus.
    pub label: String,
}

/// Scan mounted volumes and identify e-readers.
pub fn detect() -> Result<Vec<Device>, AppError> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir("/Volumes")?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "Macintosh HD" {
            continue
        }
        let lower = name.to_lowercase();

        let (kind, label) = if path.join(".kobo").is_dir() || lower.contains("kobo") {
            ("kobo", "Kobo".to_string())
        } else if path.join("system").is_dir() && path.join("documents").is_dir() {
            ("kindle", "Kindle".to_string())
        } else if lower.contains("kindle") {
            ("kindle", "Kindle".to_string())
        } else if lower.contains("pocketbook") || lower.contains("nook") {
            ("generic", name.clone())
        } else {
            // Not an e-reader we recognize.
            continue
        };

        out.push(Device {
            name,
            path: path.to_string_lossy().into_owned(),
            kind: kind.to_string(),
            label,
        });
    }
    Ok(out)
}

/// Where books go on a given device family. Kobo indexes epubs from the
/// root of its storage; Kindle requires its documents folder.
pub fn target_dir(volume: &Path, kind: &str) -> PathBuf {
    match kind {
        "kindle" => volume.join("documents"),
        _ => volume.to_path_buf(),
    }
}

/// Validate that a path is a mount point under /Volumes.
pub fn is_mounted_volume(path: &Path) -> bool {
    path.starts_with("/Volumes") && path.is_dir()
}
