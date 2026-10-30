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

/// Walk a mounted e-reader volume and collect normalized base names of the
/// ebook files on it (lowercased, extension and `.kepub` suffix stripped),
/// so the library can mark which books are already on the device. Handles
/// both flat files and Calibre's author-folder layout.
pub fn list_book_names(volume: &Path) -> Result<Vec<String>, AppError> {
    let mut out = Vec::new();
    walk_volume(volume, &mut out);
    Ok(out)
}

fn walk_volume(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Hidden dirs (.kobo, .adobe) and macOS AppleDouble files.
        if name.starts_with('.') || name.starts_with("._") {
            continue
        }
        if path.is_dir() {
            walk_volume(&path, out);
            continue
        }
        let Some(ext) = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
        else {
            continue
        };
        if !matches!(
            ext.as_str(),
            "epub" | "pdf" | "mobi" | "azw3" | "kepub" | "azw"
        ) {
            continue
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = stem.strip_suffix(".kepub").unwrap_or(stem.as_str());
        out.push(stem.trim().to_lowercase());
    }
}
