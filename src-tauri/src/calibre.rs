use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use crate::error::AppError;

/// One format-row from a Calibre library's metadata.db.
#[derive(Debug, Clone)]
pub struct CalibreBook {
    pub title: String,
    pub author: Option<String>,
    /// Relative folder inside the Calibre library, e.g. "Ada Lovelace/The Great Test (123)".
    pub dir: String,
    /// Lowercased format: "epub" or "pdf".
    pub format: String,
    /// File name without extension (Calibre's `data.name`).
    pub file_stem: String,
    pub has_cover: bool,
    pub year: Option<i64>,
}

/// Read all EPUB/PDF entries from a Calibre `metadata.db`, read-only.
pub fn read_books(metadata_db: &Path) -> Result<Vec<CalibreBook>, AppError> {
    let conn = Connection::open_with_flags(metadata_db, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut stmt = conn.prepare(
        "SELECT b.title,
                (SELECT group_concat(a.name, ' & ')
                   FROM books_authors_link AS bal
                   JOIN authors AS a ON a.id = bal.author
                  WHERE bal.book = b.id) AS authors,
                b.path,
                b.has_cover,
                lower(d.format),
                d.name,
                b.pubdate
         FROM books AS b
         JOIN data AS d ON d.book = b.id
         WHERE lower(d.format) IN ('epub', 'pdf')
         ORDER BY b.id, d.format",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CalibreBook {
            title: row.get(0)?,
            author: row.get::<_, Option<String>>(1)?,
            dir: row.get(2)?,
            has_cover: row.get::<_, Option<i64>>(3)?.unwrap_or(0) != 0,
            format: row.get(4)?,
            file_stem: row.get(5)?,
            year: row
                .get::<_, Option<String>>(6)?
                .as_deref()
                .and_then(crate::formats::parse_year),
        })
    })?;
    let mut books = Vec::new();
    for row in rows {
        books.push(row?);
    }
    Ok(books)
}
