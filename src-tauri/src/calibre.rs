use std::collections::HashSet;
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
    /// Set by a boolean custom column with a read-ish name (e.g. #read).
    pub completed: bool,
}

/// Read all EPUB/PDF entries from a Calibre `metadata.db`, read-only.
pub fn read_books(metadata_db: &Path) -> Result<Vec<CalibreBook>, AppError> {
    let conn = Connection::open_with_flags(metadata_db, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let completed_ids = read_completed_book_ids(&conn)?;
    let mut stmt = conn.prepare(
        "SELECT b.id,
                b.title,
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
        let calibre_id: i64 = row.get(0)?;
        Ok(CalibreBook {
            title: row.get(1)?,
            author: row.get::<_, Option<String>>(2)?,
            dir: row.get(3)?,
            has_cover: row.get::<_, Option<i64>>(4)?.unwrap_or(0) != 0,
            format: row.get(5)?,
            file_stem: row.get(6)?,
            year: row
                .get::<_, Option<String>>(7)?
                .as_deref()
                .and_then(crate::formats::parse_year),
            completed: completed_ids.contains(&calibre_id),
        })
    })?;
    let mut books = Vec::new();
    for row in rows {
        books.push(row?);
    }
    Ok(books)
}

/// Find a boolean custom column with a read-ish label (e.g. "read",
/// "finished", "done", "completed") and return the ids of books marked true.
/// Returns an empty set when no such column exists.
fn read_completed_book_ids(conn: &Connection) -> Result<HashSet<i64>, AppError> {
    let read_column = find_read_column(conn);
    let Some(column) = read_column else {
        return Ok(HashSet::new());
    };
    let sql = format!(
        "SELECT l.book FROM books_custom_column_{column}_link AS l \
         JOIN custom_column_{column} AS c ON c.id = l.value \
         WHERE c.value = 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
    let mut set = HashSet::new();
    for row in rows {
        set.insert(row?);
    }
    Ok(set)
}

fn find_read_column(conn: &Connection) -> Option<i64> {
    let mut stmt = conn
        .prepare("SELECT id, label, name, datatype FROM custom_columns")
        .ok()?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .ok()?;
    for row in rows.flatten() {
        let (id, label, name, datatype) = row;
        if datatype != "bool" {
            continue;
        }
        let haystack = format!("{label} {name}").to_lowercase();
        if ["read", "finished", "done", "completed"]
            .iter()
            .any(|needle| haystack.contains(needle))
        {
            return Some(id);
        }
    }
    None
}
