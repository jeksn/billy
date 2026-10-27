use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::formats;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    /// Absolute path to the cover image, served to the frontend via the asset protocol.
    pub cover: Option<String>,
    /// Absolute path to the book file itself.
    pub path: String,
    pub year: Option<i64>,
    pub file_size: u64,
    pub imported_at: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum ImportEvent {
    Progress {
        current: u32,
        total: u32,
        file: String,
    },
    Imported {
        book: Book,
    },
    Skipped {
        file: String,
        reason: String,
    },
    Failed {
        file: String,
        error: String,
    },
    Done {
        imported: u32,
        skipped: u32,
        failed: u32,
    },
}

pub enum ImportOneError {
    Skipped(String),
    Failed(String),
}

pub struct Library {
    pub root: PathBuf,
    conn: Connection,
}

const SUPPORTED: [&str; 2] = ["epub", "pdf"];
const UNKNOWN_AUTHOR: &str = "Unknown Author";

impl Library {
    pub fn open(root: PathBuf) -> Result<Self, AppError> {
        if !root.is_dir() {
            return Err(AppError::msg("the library path is not a folder"));
        }
        let conn = Connection::open(root.join("billy.db"))?;
        db::migrate(&conn)?;
        let library = Library { root, conn };
        library.migrate_legacy_layout()?;
        Ok(library)
    }

    pub fn count(&self) -> Result<u32, AppError> {
        db::count_books(&self.conn)
    }

    /// Delete a book: remove its file, cover, and (now-empty) folder, then
    /// the database row. Missing files are tolerated so a delete always
    /// removes the row.
    pub fn delete_book(&self, id: &str) -> Result<(), AppError> {
        let row = db::get_book(&self.conn, id)?
            .ok_or_else(|| AppError::msg("book not found"))?;

        let file = self.root.join(&row.file_path);
        if file.exists() {
            fs::remove_file(&file)?;
        }

        let old_dir = file.parent().map(|p| p.to_path_buf());
        if let Some(cover) = row.cover_path.as_deref() {
            let cover_path = self.root.join(cover);
            if cover_path.exists() {
                fs::remove_file(&cover_path)?;
            }
        }
        if let Some(dir) = old_dir {
            // Only removes the folder if this book was its last file.
            let _ = fs::remove_dir(dir);
        }

        db::delete_book(&self.conn, id)?;
        db::delete_progress(&self.conn, id)?;
        Ok(())
    }

    pub fn get_progress(&self) -> Result<Vec<db::ProgressRow>, AppError> {
        db::get_progress(&self.conn)
    }

    pub fn save_progress(
        &self,
        book_id: &str,
        cfi: Option<&str>,
        percent: i64,
        at: i64,
    ) -> Result<(), AppError> {
        db::upsert_progress(&self.conn, book_id, cfi, percent, at)
    }

    pub fn clear_progress(&self, book_id: &str) -> Result<(), AppError> {
        db::delete_progress(&self.conn, book_id)
    }

    /// Update title/author/year, moving the book's folder and file to match
    /// the new metadata.
    pub fn update_metadata(
        &self,
        id: &str,
        title: &str,
        author: Option<&str>,
        year: Option<i64>,
    ) -> Result<Book, AppError> {
        let row = db::get_book(&self.conn, id)?
            .ok_or_else(|| AppError::msg("book not found"))?;
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::msg("title cannot be empty"));
        }
        let author = author.map(str::trim).filter(|a| !a.is_empty());

        let old_dir_rel = row
            .file_path
            .rsplit_once('/')
            .map(|(dir, _)| dir.to_string())
            .unwrap_or_default();
        let new_dir_rel = book_dir_rel(id, title, author);
        let new_file_rel =
            format!("{}/{}", new_dir_rel, file_name_rel(title, author, &row.format));

        let mut file_rel = row.file_path.clone();
        let mut cover_rel = row.cover_path.clone();

        if new_file_rel != row.file_path {
            fs::create_dir_all(self.root.join(&new_dir_rel))?;
            fs::rename(
                self.root.join(&row.file_path),
                self.root.join(&new_file_rel),
            )?;
            if let Some(cover) = row.cover_path.as_deref() {
                let cover_ext = cover.rsplit('.').next().unwrap_or("jpg");
                let new_cover = format!("{new_dir_rel}/cover.{cover_ext}");
                let old_cover = self.root.join(cover);
                if old_cover.exists() {
                    fs::rename(&old_cover, self.root.join(&new_cover))?;
                }
                cover_rel = Some(new_cover);
            }
            if old_dir_rel != new_dir_rel {
                let _ = fs::remove_dir(self.root.join(&old_dir_rel));
            }
            file_rel = new_file_rel;
        }

        db::update_book_metadata(
            &self.conn,
            id,
            title,
            author,
            year,
            &file_rel,
            cover_rel.as_deref(),
        )?;

        let updated = db::get_book(&self.conn, id)?
            .ok_or_else(|| AppError::msg("book disappeared during update"))?;
        Ok(self.row_to_book(updated))
    }

    pub fn list_books(&self) -> Result<Vec<Book>, AppError> {
        Ok(db::list_books(&self.conn)?
            .into_iter()
            .map(|row| self.row_to_book(row))
            .collect())
    }

    fn row_to_book(&self, row: db::BookRow) -> Book {
        Book {
            id: row.id,
            title: row.title,
            author: row.author,
            format: row.format,
            cover: row
                .cover_path
                .map(|p| self.root.join(p).to_string_lossy().into_owned()),
            path: self
                .root
                .join(&row.file_path)
                .to_string_lossy()
                .into_owned(),
            year: row.year,
            file_size: row.file_size,
            imported_at: row.imported_at,
        }
    }

    pub fn import_files(&self, paths: Vec<PathBuf>, on_event: &Channel<ImportEvent>) {
        let total = paths.len() as u32;
        let mut imported = 0;
        let mut skipped = 0;
        let mut failed = 0;

        for (i, path) in paths.iter().enumerate() {
            let file = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned());
            let _ = on_event.send(ImportEvent::Progress {
                current: i as u32 + 1,
                total,
                file: file.clone(),
            });

            match self.import_one(path) {
                Ok(book) => {
                    imported += 1;
                    let _ = on_event.send(ImportEvent::Imported { book });
                }
                Err(ImportOneError::Skipped(reason)) => {
                    skipped += 1;
                    let _ = on_event.send(ImportEvent::Skipped { file, reason });
                }
                Err(ImportOneError::Failed(error)) => {
                    failed += 1;
                    let _ = on_event.send(ImportEvent::Failed { file, error });
                }
            }
        }

        let _ = on_event.send(ImportEvent::Done {
            imported,
            skipped,
            failed,
        });
    }

    fn import_one(&self, path: &Path) -> Result<Book, ImportOneError> {
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .ok_or_else(|| ImportOneError::Skipped("file has no extension".into()))?;

        if !SUPPORTED.contains(&ext.as_str()) {
            return Err(ImportOneError::Skipped(format!(
                "unsupported format: {ext}"
            )));
        }

        let meta = formats::extract(path, &ext)
            .map_err(|e| ImportOneError::Failed(e.to_string()))?;

        let title = meta
            .title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| {
                path.file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Untitled".into())
            });
        let author = meta
            .author
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty());

        let cover = meta
            .cover
            .as_deref()
            .zip(meta.cover_ext.as_deref());
        self.store_book(
            path,
            &title,
            author.as_deref(),
            &ext,
            cover,
            meta.year,
            false,
        )
    }

    /// Shared import path: duplicate check, copy into the library layout,
    /// cover write, DB insert. Used by file imports and the Calibre importer.
    ///
    /// When the book already exists, `year` is backfilled onto the existing
    /// row if it is missing one, then the import is reported as skipped.
    fn store_book(
        &self,
        source: &Path,
        title: &str,
        author: Option<&str>,
        format: &str,
        cover: Option<(&[u8], &str)>,
        year: Option<i64>,
        completed: bool,
    ) -> Result<Book, ImportOneError> {
        let failed = |e: std::io::Error| ImportOneError::Failed(e.to_string());

        if let Some(duplicate_id) = db::find_duplicate(&self.conn, title, author, format)
            .map_err(|e| ImportOneError::Failed(e.to_string()))?
        {
            if let Some(year) = year {
                db::update_book_year(&self.conn, &duplicate_id, year)
                    .map_err(|e| ImportOneError::Failed(e.to_string()))?;
            }
            // Backfill completed status onto an existing book that has none.
            if completed {
                let existing = db::get_progress_for(&self.conn, &duplicate_id)
                    .map_err(|e| ImportOneError::Failed(e.to_string()))?;
                if existing.is_none() {
                    db::upsert_progress(
                        &self.conn,
                        &duplicate_id,
                        None,
                        100,
                        crate::now_ms(),
                    )
                    .map_err(|e| ImportOneError::Failed(e.to_string()))?;
                }
            }
            return Err(ImportOneError::Skipped(
                "already in the library".into(),
            ));
        }

        let id = Uuid::new_v4().to_string();
        let file_size = fs::metadata(source).map(|m| m.len()).map_err(failed)?;

        let dir_rel = book_dir_rel(&id, title, author);
        let file_rel = format!("{}/{}", dir_rel, file_name_rel(title, author, format));
        fs::create_dir_all(self.root.join(&dir_rel)).map_err(failed)?;

        fs::copy(source, self.root.join(&file_rel)).map_err(failed)?;

        let cover_path = cover.and_then(|(bytes, ext)| {
            let rel = format!("{dir_rel}/cover.{ext}");
            fs::write(self.root.join(&rel), bytes).is_ok().then_some(rel)
        });

        let new_book = db::NewBook {
            id: id.clone(),
            title: title.to_string(),
            author: author.map(String::from),
            format: format.to_string(),
            file_path: file_rel,
            cover_path,
            year,
            file_size,
        };
        db::insert_book(&self.conn, &new_book)
            .map_err(|e| ImportOneError::Failed(e.to_string()))?;
        if completed {
            db::upsert_progress(&self.conn, &id, None, 100, crate::now_ms())
                .map_err(|e| ImportOneError::Failed(e.to_string()))?;
        }

        Ok(Book {
            id,
            title: title.to_string(),
            author: author.map(String::from),
            format: format.to_string(),
            cover: None,
            path: self
                .root
                .join(&new_book.file_path)
                .to_string_lossy()
                .into_owned(),
            year,
            file_size,
            imported_at: String::new(),
        })
    }

    pub fn import_calibre(
        &self,
        calibre_root: &Path,
        books: Vec<crate::calibre::CalibreBook>,
        on_event: &Channel<ImportEvent>,
    ) {
        let total = books.len() as u32;
        let mut imported = 0;
        let mut skipped = 0;
        let mut failed = 0;

        for (i, book) in books.iter().enumerate() {
            let label = format!("{} ({})", book.title, book.format);
            let _ = on_event.send(ImportEvent::Progress {
                current: i as u32 + 1,
                total,
                file: label.clone(),
            });

            match self.import_calibre_one(calibre_root, book) {
                Ok(book) => {
                    imported += 1;
                    let _ = on_event.send(ImportEvent::Imported { book });
                }
                Err(ImportOneError::Skipped(reason)) => {
                    skipped += 1;
                    let _ = on_event.send(ImportEvent::Skipped {
                        file: label,
                        reason,
                    });
                }
                Err(ImportOneError::Failed(error)) => {
                    failed += 1;
                    let _ = on_event.send(ImportEvent::Failed {
                        file: label,
                        error,
                    });
                }
            }
        }

        let _ = on_event.send(ImportEvent::Done {
            imported,
            skipped,
            failed,
        });
    }

    fn import_calibre_one(
        &self,
        calibre_root: &Path,
        entry: &crate::calibre::CalibreBook,
    ) -> Result<Book, ImportOneError> {
        let source = calibre_root
            .join(&entry.dir)
            .join(format!("{}.{}", entry.file_stem, entry.format));
        if !source.exists() {
            return Err(ImportOneError::Failed(
                "book file missing in the Calibre library".into(),
            ));
        }

        let author = entry
            .author
            .as_deref()
            .map(str::trim)
            .filter(|a| !a.is_empty());

        let cover = calibre_cover(calibre_root, entry, &source);
        let cover_ref = cover
            .as_ref()
            .map(|(bytes, ext)| (bytes.as_slice(), ext.as_str()));

        self.store_book(
            &source,
            &entry.title,
            author,
            &entry.format,
            cover_ref,
            entry.year,
            entry.completed,
        )
    }

    /// Move books from the old flat layout (`books/<id>.<ext>` +
    /// `covers/<id>.<ext>`) into the per-book folder layout. Runs on every
    /// open; rows already migrated are skipped because their paths no longer
    /// start with `books/` or `covers/`.
    fn migrate_legacy_layout(&self) -> Result<(), AppError> {
        let rows = db::list_books(&self.conn)?;
        for row in rows {
            let legacy_book = row.file_path.starts_with("books/");
            let legacy_cover = row
                .cover_path
                .as_deref()
                .is_some_and(|p| p.starts_with("covers/"));
            if !legacy_book && !legacy_cover {
                continue;
            }

            let dir_rel = book_dir_rel(&row.id, &row.title, row.author.as_deref());
            fs::create_dir_all(self.root.join(&dir_rel))?;

            let mut new_file_path = row.file_path.clone();
            if legacy_book {
                let src = self.root.join(&row.file_path);
                if src.exists() {
                    let ext = row
                        .file_path
                        .rsplit('.')
                        .next()
                        .unwrap_or(&row.format)
                        .to_string();
                    let dest_rel =
                        format!("{}/{}", dir_rel, file_name_rel(&row.title, row.author.as_deref(), &ext));
                    fs::rename(&src, self.root.join(&dest_rel))?;
                    new_file_path = dest_rel;
                }
            }

            let mut new_cover_path = row.cover_path.clone();
            if let (true, Some(cover_rel)) = (legacy_cover, row.cover_path.as_deref()) {
                let src = self.root.join(cover_rel);
                if src.exists() {
                    let cover_ext = cover_rel.rsplit('.').next().unwrap_or("jpg");
                    let dest_rel = format!("{}/cover.{cover_ext}", dir_rel);
                    fs::rename(&src, self.root.join(&dest_rel))?;
                    new_cover_path = Some(dest_rel);
                }
            }

            db::update_book_paths(
                &self.conn,
                &row.id,
                &new_file_path,
                new_cover_path.as_deref(),
            )?;
        }
        // Remove the now-empty legacy folders; only succeeds when empty.
        let _ = fs::remove_dir(self.root.join("books"));
        let _ = fs::remove_dir(self.root.join("covers"));
        Ok(())
    }
}

/// Cover for a Calibre book: prefer Calibre's own `cover.jpg`; fall back to
/// extracting the cover from the EPUB itself.
fn calibre_cover(
    calibre_root: &Path,
    entry: &crate::calibre::CalibreBook,
    source: &Path,
) -> Option<(Vec<u8>, String)> {
    if entry.has_cover {
        let cover = calibre_root.join(&entry.dir).join("cover.jpg");
        if let Ok(bytes) = fs::read(cover) {
            return Some((bytes, "jpg".to_string()));
        }
    }
    if entry.format == "epub" {
        if let Ok(meta) = formats::extract(source, "epub") {
            if let (Some(bytes), Some(ext)) = (meta.cover, meta.cover_ext) {
                return Some((bytes, ext));
            }
        }
    }
    None
}

/// Calibre-style relative folder for one book: `Author/Title (short-id)`.
fn book_dir_rel(id: &str, title: &str, author: Option<&str>) -> String {
    let author = match author {
        Some(a) => sanitize_component(a),
        None => UNKNOWN_AUTHOR.to_string(),
    };
    let short_id: String = id.chars().take(8).collect();
    format!("{}/{} ({})", author, sanitize_component(title), short_id)
}

/// Calibre-style file name: `Title - Author.ext` (or `Title.ext`).
fn file_name_rel(title: &str, author: Option<&str>, ext: &str) -> String {
    let title = sanitize_component(title);
    match author {
        Some(a) => format!("{} - {}.{}", title, sanitize_component(a), ext),
        None => format!("{title}.{ext}"),
    }
}

/// Make a string safe to use as a single filesystem path component on all
/// desktop platforms: strip separators and reserved characters, collapse
/// whitespace, trim trailing dots/spaces, cap the length.
fn sanitize_component(input: &str) -> String {
    let mut out: String = input
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            other => other,
        })
        .collect();
    out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    out = out.trim().trim_end_matches('.').to_string();
    if out.is_empty() {
        out = "Untitled".into();
    }
    if out.chars().count() > 100 {
        out = out.chars().take(100).collect();
    }
    out
}

/// Recursively collect EPUB and PDF files inside `dir`.
pub fn collect_supported_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(collect_supported_files(&path));
        } else if let Some(ext) = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
        {
            if SUPPORTED.contains(&ext.as_str()) {
                out.push(path);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn book_serializes_with_camel_case_keys() {
        let book = Book {
            id: "id".into(),
            title: "Title".into(),
            author: Some("Author".into()),
            format: "epub".into(),
            cover: Some("/covers/x.jpg".into()),
            path: "/library/Author/Title (id)/Title - Author.epub".into(),
            year: Some(1999),
            file_size: 42,
            imported_at: "2026-10-26".into(),
        };
        let json = serde_json::to_value(&book).unwrap();
        assert!(json.get("fileSize").is_some(), "expected fileSize, got: {json}");
        assert!(json.get("importedAt").is_some(), "expected importedAt, got: {json}");
        assert!(json.get("file_size").is_none());
    }

    #[test]
    fn book_paths_are_calibre_style() {
        let dir = book_dir_rel(
            "39075f15-5c48-49b5-9f1c-6e252288c1f2",
            "The Great Test",
            Some("Ada Lovelace"),
        );
        assert_eq!(dir, "Ada Lovelace/The Great Test (39075f15)");

        let name = file_name_rel("The Great Test", Some("Ada Lovelace"), "epub");
        assert_eq!(name, "The Great Test - Ada Lovelace.epub");

        let name_no_author = file_name_rel("The Great Test", None, "pdf");
        assert_eq!(name_no_author, "The Great Test.pdf");

        let dir_no_author = book_dir_rel("abcdef12-0000", "Dune", None);
        assert_eq!(dir_no_author, "Unknown Author/Dune (abcdef12)");
    }

    #[test]
    fn sanitize_strips_unsafe_characters() {
        assert_eq!(sanitize_component("A/B: C*? \"<>|D.."), "A B C D");
        assert_eq!(sanitize_component("   "), "Untitled");
        let long = "x".repeat(300);
        assert_eq!(sanitize_component(&long).chars().count(), 100);
    }
}
