# billy roadmap

Working file for what's built, what's next, and research notes for bigger
features. Check items off as they ship.

## Done

- [x] Library storage in `~/Billy Library`, Calibre-style per-book folders
      (`Author/Title (id)/Title - Author.ext` + `cover.jpg`)
- [x] Import files/folders: EPUB (title, author, year, cover) and PDF
      (title, author)
- [x] Import from Calibre (`metadata.db`, covers, pubdate backfill on rerun)
- [x] Grid + list views, grid density, sort (author/title/recent/year)
- [x] Search modal (Cmd+K): text + author/format/year filters
- [x] Book details sidebar with reveal-in-folder
- [x] Settings pane: theme (system/light/dark), layout, sort, library
- [x] Native-feeling chrome: overlay titlebar, drag region, dark mode

## Phase 1 — Library management

- [ ] Delete books (remove row + files, confirm dialog)
- [ ] Edit book metadata (title, author, year; rename folder/file to match)
- [ ] Open with system reader (opener plugin, one command + permission)

## Phase 2 — Send to e-reader

- [ ] Detect connected e-readers (see research below)
- [ ] Copy selected book(s) to device storage
- [ ] Per-device target paths and format notes (Kobo: epub anywhere; Kindle:
      azw3/mobi via USB, epub only via Send-to-Kindle)
- [ ] Optional: remember which books are on which device (Calibre's
      "On Device" column)

## Phase 3 — Reading

- [ ] In-app EPUB reader (webview-based renderer; foliate-js or epub.js as
      candidates)
- [ ] PDF cover rendering from page 1 (needs a PDF rasterizer; pdfium-rs or
      mupdf — native dependency decision required)

---

## Research: send to e-reader

### How Calibre does it

Calibre's device layer (`src/calibre/devices/`) has two driver families:

- **usbms** — USB mass storage devices. The e-reader mounts as a filesystem
  volume; Calibre scans for known volume names/USB IDs and copies books into
  device-specific folders (e.g. Kindle `documents/`), plus writes metadata
  sidecars/caches so the device can index them.
- **mtp** — Media Transfer Protocol devices. Used for Android-ish devices.
  Since firmware 5.16.3 on the Kindle Scribe (and rolling out across USB-C
  Kindles), newer Kindles present MTP instead of mass storage. Calibre talks
  MTP via libmtp.

### Device landscape (macOS)

| Device class | Connection | For billy |
| --- | --- | --- |
| Kobo, PocketBook, older Kindles | Mounts as a volume (`/Volumes/KOBOeReader`, `/Volumes/Kindle`) | Easy: scan `/Volumes`, match known volume names, copy files |
| Newer USB-C Kindles (Scribe etc.) | MTP, does not mount | Needs an MTP implementation in Rust |
| Android with an e-reader app | MTP | Same MTP path, later |

Note: macOS Finder does not speak MTP natively (Android File Transfer is a
third-party helper app), so billy would need its own MTP stack for these
devices — which is fine in Tauri since we're not going through Finder.

### Rust MTP options

- **`mtp-rs`** — pure-Rust, async MTP/PTP. No C dependencies, claims up to 4x
  faster than libmtp, documented against Android phones and e-book readers.
  Best fit for the Tauri backend if it proves stable. (Caveat: the author
  notes it is heavily AI-assisted code; validate against a real device.)
- **`libmtp-rs`** — safe wrapper over battle-tested C `libmtp` (20+ years
  old). Requires linking the C library (homebrew dep on macOS, complicates
  bundling).
- Recommended: prototype with `mtp-rs`; fall back to `libmtp-rs` only if
  device support is flaky. USB backend on macOS is IOKit/usb — `nusb` (pure
  Rust USB) is what `mtp-rs` builds on.

### Format reality check

- Kobo/PocketBook read EPUB natively — copy works as-is.
- Kindle via USB wants AZW3/MOBI (EPUB over USB is not indexed). Amazon's
  Send-to-Kindle email service does accept EPUB. Without a conversion
  pipeline, "send to Kindle" is out of initial scope; conversion (Calibre's
  ebook-convert or a Rust transcoder) would be its own roadmap item.
- First milestone: Kobo-class devices (plain volume copy), which is where
  USB mass storage makes everything easy.

### Suggested implementation order

1. Volume scanner: list mounted volumes, match against a table of known
   e-reader volume names (extensible in settings), show "Send to <device>"
   when one is connected.
2. Copy + eject (diskutil or unmount via std APIs) with progress events
   through the existing channel pattern.
3. MTP support via `mtp-rs` for USB-C Kindles.
4. "On device" tracking + device management UI.
5. Kindle format conversion (big, separate item).
