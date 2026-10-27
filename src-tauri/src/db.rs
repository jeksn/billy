use rusqlite::{params, Connection};

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct NewBook {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub file_path: String,
    pub cover_path: Option<String>,
    pub year: Option<i64>,
    pub file_size: u64,
}

#[derive(Debug, Clone)]
pub struct BookRow {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    #[allow(dead_code)]
    pub file_path: String,
    pub cover_path: Option<String>,
    pub year: Option<i64>,
    pub file_size: u64,
    pub imported_at: String,
}

pub fn migrate(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS books (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            author      TEXT,
            format      TEXT NOT NULL,
            file_path   TEXT NOT NULL,
            cover_path  TEXT,
            year        INTEGER,
            file_size   INTEGER NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
        CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
        CREATE TABLE IF NOT EXISTS progress (
            book_id TEXT PRIMARY KEY,
            cfi     TEXT,
            percent INTEGER NOT NULL DEFAULT 0,
            at      INTEGER NOT NULL DEFAULT 0
        );",
    )?;
    // Migration for libraries created before the year column existed.
    let mut stmt = conn.prepare("PRAGMA table_info(books)")?;
    let has_year = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .flatten()
        .any(|name| name == "year");
    if !has_year {
        conn.execute("ALTER TABLE books ADD COLUMN year INTEGER", [])?;
    }
    Ok(())
}

pub fn insert_book(conn: &Connection, book: &NewBook) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO books (id, title, author, format, file_path, cover_path, year, file_size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            book.id,
            book.title,
            book.author,
            book.format,
            book.file_path,
            book.cover_path,
            book.year,
            book.file_size as i64,
        ],
    )?;
    Ok(())
}

/// Returns the id of an existing book with the same title/author/format, if any.
pub fn find_duplicate(
    conn: &Connection,
    title: &str,
    author: Option<&str>,
    format: &str,
) -> Result<Option<String>, AppError> {
    let id = conn
        .query_row(
            "SELECT id FROM books
             WHERE lower(title) = lower(?1)
               AND coalesce(lower(author), '') = coalesce(lower(?2), '')
               AND lower(format) = lower(?3)",
            params![title, author, format],
            |row| row.get::<_, String>(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(id)
}

pub fn update_book_year(
    conn: &Connection,
    id: &str,
    year: i64,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET year = ?2 WHERE id = ?1",
        params![id, year],
    )?;
    Ok(())
}

pub fn update_book_paths(
    conn: &Connection,
    id: &str,
    file_path: &str,
    cover_path: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET file_path = ?2, cover_path = ?3 WHERE id = ?1",
        params![id, file_path, cover_path],
    )?;
    Ok(())
}

pub fn list_books(conn: &Connection) -> Result<Vec<BookRow>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, author, format, file_path, cover_path, year, file_size, imported_at
         FROM books ORDER BY lower(title) COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BookRow {
            id: row.get(0)?,
            title: row.get(1)?,
            author: row.get(2)?,
            format: row.get(3)?,
            file_path: row.get(4)?,
            cover_path: row.get(5)?,
            year: row.get(6)?,
            file_size: row.get::<_, i64>(7)? as u64,
            imported_at: row.get(8)?,
        })
    })?;
    let mut books = Vec::new();
    for row in rows {
        books.push(row?);
    }
    Ok(books)
}

pub fn count_books(conn: &Connection) -> Result<u32, AppError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
    Ok(count as u32)
}

pub fn get_book(conn: &Connection, id: &str) -> Result<Option<BookRow>, AppError> {
    let row = conn
        .query_row(
            "SELECT id, title, author, format, file_path, cover_path, year, file_size, imported_at
             FROM books WHERE id = ?1",
            params![id],
            |row| {
                Ok(BookRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author: row.get(2)?,
                    format: row.get(3)?,
                    file_path: row.get(4)?,
                    cover_path: row.get(5)?,
                    year: row.get(6)?,
                    file_size: row.get::<_, i64>(7)? as u64,
                    imported_at: row.get(8)?,
                })
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(row)
}

pub fn update_book_metadata(
    conn: &Connection,
    id: &str,
    title: &str,
    author: Option<&str>,
    year: Option<i64>,
    file_path: &str,
    cover_path: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE books SET title = ?2, author = ?3, year = ?4, file_path = ?5, cover_path = ?6
         WHERE id = ?1",
        params![id, title, author, year, file_path, cover_path],
    )?;
    Ok(())
}

pub fn delete_book(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ProgressRow {
    pub book_id: String,
    pub cfi: Option<String>,
    pub percent: i64,
    pub at: i64,
}

pub fn upsert_progress(
    conn: &Connection,
    book_id: &str,
    cfi: Option<&str>,
    percent: i64,
    at: i64,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO progress (book_id, cfi, percent, at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(book_id) DO UPDATE SET cfi = ?2, percent = ?3, at = ?4",
        params![book_id, cfi, percent, at],
    )?;
    Ok(())
}

pub fn get_progress(conn: &Connection) -> Result<Vec<ProgressRow>, AppError> {
    let mut stmt =
        conn.prepare("SELECT book_id, cfi, percent, at FROM progress")?;
    let rows = stmt.query_map([], |row| {
        Ok(ProgressRow {
            book_id: row.get(0)?,
            cfi: row.get(1)?,
            percent: row.get(2)?,
            at: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get_progress_for(
    conn: &Connection,
    book_id: &str,
) -> Result<Option<ProgressRow>, AppError> {
    let row = conn
        .query_row(
            "SELECT book_id, cfi, percent, at FROM progress WHERE book_id = ?1",
            params![book_id],
            |row| {
                Ok(ProgressRow {
                    book_id: row.get(0)?,
                    cfi: row.get(1)?,
                    percent: row.get(2)?,
                    at: row.get(3)?,
                })
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(row)
}

pub fn delete_progress(conn: &Connection, book_id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM progress WHERE book_id = ?1", params![book_id])?;
    Ok(())
}
