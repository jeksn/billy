mod calibre;
mod config;
mod db;
mod devices;
mod error;
mod formats;
mod kepub;
mod library;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use error::AppError;
use library::{Book, ImportEvent, Library};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSummary {
    pub library_path: Option<String>,
    pub book_count: u32,
    /// Path to ~/Calibre Library, if one exists (used for first-run migration).
    pub calibre_library_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEntry {
    pub book_id: String,
    pub cfi: Option<String>,
    pub percent: i64,
    pub at: i64,
}

fn detect_calibre_library(app: &AppHandle) -> Option<String> {
    let home = app.path().home_dir().ok()?;
    let dir = home.join("Calibre Library");
    if dir.join("metadata.db").is_file() {
        Some(dir.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Current unix time in milliseconds.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Default)]
struct SharedState {
    library: Mutex<Option<Library>>,
}

impl SharedState {
    fn with_library<T>(
        &self,
        f: impl FnOnce(&Library) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let guard = self.library.lock().unwrap();
        let lib = guard
            .as_ref()
            .ok_or_else(|| AppError::msg("no library selected yet"))?;
        f(lib)
    }
}

/// Run blocking work on the async runtime's thread pool so IPC handlers never
/// block the UI.
async fn run_blocking<T, F>(app: AppHandle, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(AppHandle) -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(app))
        .await
        .map_err(|e| AppError::msg(format!("background task failed: {e}")))?
}

#[tauri::command]
async fn get_app_state(app: AppHandle) -> Result<AppStateSummary, AppError> {
    run_blocking(app, |app| {
        let state = app.state::<SharedState>();
        let guard = state.library.lock().unwrap();
        match guard.as_ref() {
            Some(lib) => Ok(AppStateSummary {
                library_path: Some(lib.root.to_string_lossy().into_owned()),
                book_count: lib.count()?,
                calibre_library_path: detect_calibre_library(&app),
            }),
            None => Ok(AppStateSummary {
                library_path: None,
                book_count: 0,
                calibre_library_path: detect_calibre_library(&app),
            }),
        }
    })
    .await
}

#[tauri::command]
async fn set_library(app: AppHandle, path: String) -> Result<AppStateSummary, AppError> {
    run_blocking(app, move |app| {
        let root = PathBuf::from(&path);
        if !root.is_dir() {
            return Err(AppError::msg("the selected path is not a folder"));
        }
        let lib = Library::open(root.clone())?;
        let summary = AppStateSummary {
            library_path: Some(path.clone()),
            book_count: lib.count()?,
            calibre_library_path: detect_calibre_library(&app),
        };

        let _ = app.asset_protocol_scope().allow_directory(root, true);
        config::save(&app, &config::Config {
            library_path: Some(path),
        })?;

        let state = app.state::<SharedState>();
        *state.library.lock().unwrap() = Some(lib);
        Ok(summary)
    })
    .await
}

#[tauri::command]
async fn get_books(app: AppHandle) -> Result<Vec<Book>, AppError> {
    run_blocking(app, |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| lib.list_books())
    })
    .await
}

#[tauri::command]
async fn import_files(
    app: AppHandle,
    paths: Vec<String>,
    on_event: Channel<ImportEvent>,
) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            lib.import_files(paths, &on_event);
            Ok(())
        })
    })
    .await
}

#[tauri::command]
async fn import_folder(
    app: AppHandle,
    path: String,
    on_event: Channel<ImportEvent>,
) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let root = PathBuf::from(&path);
        if !root.is_dir() {
            return Err(AppError::msg("the selected path is not a folder"));
        }
        let paths = library::collect_supported_files(&root);
        if paths.is_empty() {
            return Err(AppError::msg(
                "no EPUB or PDF files found in that folder",
            ));
        }
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            lib.import_files(paths, &on_event);
            Ok(())
        })
    })
    .await
}

#[tauri::command]
async fn import_from_calibre(
    app: AppHandle,
    path: String,
    on_event: Channel<ImportEvent>,
) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let calibre_root = PathBuf::from(&path);
        let metadata_db = calibre_root.join("metadata.db");
        if !metadata_db.is_file() {
            return Err(AppError::msg(format!(
                "that folder does not look like a Calibre library (no metadata.db): {path}"
            )));
        }
        let books = calibre::read_books(&metadata_db)?;
        if books.is_empty() {
            return Err(AppError::msg(
                "no EPUB or PDF books found in that Calibre library",
            ));
        }
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            lib.import_calibre(&calibre_root, books, &on_event);
            Ok(())
        })
    })
    .await
}

/// Open the saved library on startup, or fall back to `~/Billy Library`
/// (created on first run) when no path has been configured yet.
fn open_initial_library(app: &AppHandle) -> Result<(), AppError> {
    let mut cfg = config::load(app)?;
    let path = match cfg.library_path.clone() {
        Some(path) => path,
        None => {
            let path = config::default_library_path(app)?;
            let path = path.to_string_lossy().into_owned();
            cfg.library_path = Some(path.clone());
            config::save(app, &cfg)?;
            path
        }
    };

    let root = PathBuf::from(&path);
    if !root.exists() {
        std::fs::create_dir_all(&root)?;
    }

    let lib = Library::open(root.clone())?;
    let _ = app.asset_protocol_scope().allow_directory(root, true);
    let state = app.state::<SharedState>();
    *state.library.lock().unwrap() = Some(lib);
    Ok(())
}

/// Open a book with the system's default application. Uses the opener plugin's
/// Rust API directly: the path comes from our own database, not the webview,
/// so the plugin's JS-command path scope does not apply.
#[tauri::command]
async fn open_book(app: AppHandle, path: String) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    run_blocking(app, move |app| {
        app.opener().open_path(path, None::<&str>)?;
        Ok(())
    })
    .await
}

/// Read a book file inside the library as raw bytes for the frontend reader.
/// The path is canonicalized and checked against the library root.
#[tauri::command]
async fn read_book(
    app: AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            let root = lib.root.canonicalize()?;
            let file = PathBuf::from(&path)
                .canonicalize()
                .map_err(|_| AppError::msg("book file not found"))?;
            if !file.starts_with(&root) {
                return Err(AppError::msg("path is outside the library"));
            }
            let bytes = std::fs::read(&file)?;
            Ok(tauri::ipc::Response::new(bytes))
        })
    })
    .await
}

#[tauri::command]
async fn get_progress(app: AppHandle) -> Result<Vec<ProgressEntry>, AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            Ok(lib
                .get_progress()?
                .into_iter()
                .map(|row| ProgressEntry {
                    book_id: row.book_id,
                    cfi: row.cfi,
                    percent: row.percent,
                    at: row.at,
                })
                .collect())
        })
    })
    .await
}

#[tauri::command]
async fn save_progress(
    app: AppHandle,
    book_id: String,
    cfi: Option<String>,
    percent: i64,
    at: i64,
) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| lib.save_progress(&book_id, cfi.as_deref(), percent, at))
    })
    .await
}

#[tauri::command]
async fn clear_progress(app: AppHandle, book_id: String) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| lib.clear_progress(&book_id))
    })
    .await
}

#[tauri::command]
async fn get_devices() -> Result<Vec<devices::Device>, AppError> {
    // A single directory listing; no need for the blocking pool.
    devices::detect()
}

/// Normalized base names of the ebook files on a connected device.
#[tauri::command]
async fn list_device_books(device_path: String) -> Result<Vec<String>, AppError> {
    let volume = PathBuf::from(&device_path);
    if !devices::is_mounted_volume(&volume) {
        return Err(AppError::msg("device is no longer connected"));
    }
    devices::list_book_names(&volume)
}

/// Copy a book file onto an e-reader volume.
#[tauri::command]
async fn send_to_device(
    app: AppHandle,
    book_id: String,
    device_path: String,
    kepub: bool,
) -> Result<String, AppError> {
    run_blocking(app, move |app| {
        let volume = PathBuf::from(&device_path);
        if !devices::is_mounted_volume(&volume) {
            return Err(AppError::msg("that device is no longer connected"));
        }
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            let device = devices::detect()?
                .into_iter()
                .find(|d| d.path == device_path)
                .ok_or_else(|| AppError::msg("device is no longer recognized"))?;
            let target = lib.send_to_device(&book_id, &volume, &device.kind, kepub)?;
            Ok(target.to_string_lossy().into_owned())
        })
    })
    .await
}

#[tauri::command]
async fn save_cover(
    app: AppHandle,
    book_id: String,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| lib.save_cover(&book_id, &bytes))
    })
    .await
}

#[tauri::command]
async fn delete_book(app: AppHandle, id: String) -> Result<(), AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| lib.delete_book(&id))
    })
    .await
}

#[tauri::command]
async fn update_book_metadata(
    app: AppHandle,
    id: String,
    title: String,
    author: Option<String>,
    year: Option<i64>,
) -> Result<Book, AppError> {
    run_blocking(app, move |app| {
        let state = app.state::<SharedState>();
        state.with_library(|lib| {
            lib.update_metadata(&id, &title, author.as_deref(), year)
        })
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SharedState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let result = open_initial_library(&handle);
            if let Err(error) = result {
                eprintln!("billy: failed to open library: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            set_library,
            get_books,
            import_files,
            import_folder,
            import_from_calibre,
            delete_book,
            update_book_metadata,
            open_book,
            read_book,
            get_progress,
            save_progress,
            clear_progress,
            save_cover,
            get_devices,
            send_to_device,
            list_device_books
        ])
        .run(tauri::generate_context!())
        .expect("error while running billy");
}
