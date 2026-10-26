# billy

A lean ebook library manager for EPUB and PDF, built with Tauri v2, React, and Tailwind/shadcn. A Calibre-style library without the bloat.

## What it does

- Stores your books in `~/Billy Library` (Calibre-style layout: `Author/Title (id)/Title - Author.epub` + `cover.jpg`), self-contained and easy to back up
- Imports files or whole folders, extracting title, author, publication year, and cover from EPUB metadata
- Imports from an existing Calibre library using its `metadata.db` (books are copied, Calibre is never touched)
- Search with author, format, and year filters (Cmd+K)
- Book details sidebar with reveal-in-folder

## Development

```bash
npm install
npm run tauri dev
```

Build a release binary:

```bash
npm run tauri build
```

Rust tests:

```bash
cd src-tauri && cargo test
```

## Layout

- `src/` — React frontend (Vite, Tailwind v4, shadcn/ui)
- `src-tauri/` — Rust backend (SQLite via rusqlite, EPUB/PDF metadata extraction)
