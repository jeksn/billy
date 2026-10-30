use std::fs::File;
use std::io::Write;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;
use zip::ZipWriter;
use zip::CompressionMethod;

use crate::error::AppError;

/// Convert an EPUB into a KEPUB at `target`.
///
/// A KEPUB is a regular EPUB with two differences: the file name carries
/// the `.kepub.epub` suffix, and every text node of the content documents
/// is wrapped in a numbered "Kobo span". Those spans are what enable the
/// Kobo's reading statistics, in-book progress, and faster pagination.
pub fn convert_epub(source: &Path, target: &Path) -> Result<(), AppError> {
    let file = File::open(source)?;
    let mut archive = ZipArchive::new(file)?;
    let out = File::create(target)?;
    let mut writer = ZipWriter::new(out);

    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated);

    // The mimetype entry must come first and be stored uncompressed,
    // same rule as EPUB itself.
    if archive.by_name("mimetype").is_ok() {
        writer.start_file("mimetype", stored)?;
        let mut entry = archive.by_name("mimetype")?;
        std::io::copy(&mut entry, &mut writer)?;
    }

    let names: Vec<String> = archive
        .file_names()
        .filter_map(|n| n.ok().map(|s| s.into_owned()))
        .collect();
    let mut chapter = 0usize;

    for name in names {
        if name == "mimetype" {
            continue
        }
        let is_content = is_content_document(&name);
        writer.start_file(&name, deflated)?;
        let mut entry = archive.by_name(&name)?;

        if is_content {
            let mut content = String::new();
            std::io::Read::read_to_string(&mut entry, &mut content)?;
            chapter += 1;
            let transformed = add_kobo_spans(&content, chapter)?;
            writer.write_all(transformed.as_bytes())?;
        } else {
            std::io::copy(&mut entry, &mut writer)?;
        }
    }

    writer.finish()?;
    Ok(())
}

fn is_content_document(name: &str) -> bool {
    if name.starts_with("META-INF/") || name.ends_with(".opf") || name.ends_with(".ncx") {
        return false
    }
    let lower = name.to_lowercase();
    lower.ends_with(".xhtml") || lower.ends_with(".html") || lower.ends_with(".htm")
}

/// Inject numbered Kobo spans around every non-whitespace text node.
/// Text inside `title`, `script`, and `style` elements is left alone.
fn add_kobo_spans(input: &str, chapter: usize) -> Result<String, AppError> {
    let mut reader = Reader::from_str(input);
    let mut out = String::with_capacity(input.len() + 512);
    let mut span_id = 0usize;
    let mut skip_depth = 0usize;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                out.push('<');
                out.push_str(e.as_ref());
                out.push('>');
                if skip_depth > 0 {
                    skip_depth += 1;
                } else if is_skip_tag(e.name().as_ref()) {
                    skip_depth = 1;
                }
            }
            Ok(Event::End(e)) => {
                out.push_str("</");
                out.push_str(e.as_ref());
                out.push('>');
                if skip_depth > 0 {
                    skip_depth -= 1;
                }
            }
            Ok(Event::Empty(e)) => {
                out.push('<');
                out.push_str(e.as_ref());
                out.push_str("/>");
            }
            Ok(Event::Text(t)) => {
                let raw = t.as_ref();
                if skip_depth > 0 || raw.trim().is_empty() {
                    out.push_str(raw);
                } else {
                    span_id += 1;
                    out.push_str(&format!("<span id=\"kobo.{chapter}.{span_id}\">"));
                    out.push_str(raw);
                    out.push_str("</span>");
                }
            }
            Ok(Event::GeneralRef(g)) => {
                // A character or general entity reference (`&amp;`, `&#8212;`):
                // `as_ref()` is the name between `&` and `;`.
                out.push('&');
                out.push_str(g.as_ref());
                out.push(';');
            }
            Ok(Event::CData(c)) => {
                out.push_str("<![CDATA[");
                out.push_str(c.as_ref());
                out.push_str("]]>");
            }
            Ok(Event::Comment(c)) => {
                out.push_str("<!--");
                out.push_str(c.as_ref());
                out.push_str("-->");
            }
            Ok(Event::Decl(d)) => {
                out.push_str("<?");
                out.push_str(d.as_ref());
                out.push_str("?>");
            }
            Ok(Event::PI(p)) => {
                out.push_str("<?");
                out.push_str(p.as_ref());
                out.push_str("?>");
            }
            Ok(Event::DocType(d)) => {
                out.push_str("<!DOCTYPE");
                out.push_str(d.as_ref());
                out.push('>');
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::msg(format!(
                    "failed to parse content document: {e}"
                )))
            }
        }
    }

    Ok(out)
}

fn is_skip_tag(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "title" | "script" | "style"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;

    #[test]
    fn wraps_text_nodes_in_kobo_spans() {
        let input = "<html><head><title>Ch</title>\
                     <style>p { color: red }</style></head>\
                     <body><p>Hello <em>world</em>!</p></body></html>";
        let out = add_kobo_spans(input, 1).unwrap();
        assert!(out.contains(r#"<span id="kobo.1.1">Hello </span>"#), "got: {out}");
        assert!(out.contains(r#"<span id="kobo.1.2">world</span>"#), "got: {out}");
        assert!(out.contains(r#"<span id="kobo.1.3">!</span>"#), "got: {out}");
        // title/style content is untouched
        assert!(out.contains("<title>Ch</title>"));
        assert!(out.contains("color: red"));
        assert!(!out.contains("kobo.1.4"));
    }

    #[test]
    fn preserves_entities_and_attributes() {
        let input = "<p class=\"a\">Tom &amp; Jerry</p>";
        let out = add_kobo_spans(input, 2).unwrap();
        assert!(out.contains(r#"<p class="a">"#), "got: {out}");
        // The text splits around the entity, which stays intact between spans.
        assert!(
            out.contains(
                r#"<span id="kobo.2.1">Tom </span>&amp;<span id="kobo.2.2"> Jerry</span>"#
            ),
            "got: {out}"
        );
    }

    #[test]
    fn converts_epub_zip_roundtrip() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let source = dir.join("target/test-kepub-in.epub");
        let target = dir.join("target/test-kepub-out.kepub.epub");

        let file = File::create(&source).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        writer
            .start_file("mimetype", options.compression_method(CompressionMethod::Stored))
            .unwrap();
        writer.write_all(b"application/epub+zip").unwrap();
        writer.start_file("OEBPS/ch1.xhtml", options).unwrap();
        writer
            .write_all(b"<html><body><p>Chapter text</p></body></html>")
            .unwrap();
        writer.start_file("OEBPS/style.css", options).unwrap();
        writer.write_all(b"p { }").unwrap();
        writer.finish().unwrap();

        convert_epub(&source, &target).unwrap();

        let mut archive = ZipArchive::new(File::open(&target).unwrap()).unwrap();
        assert_eq!(archive.by_index(0).unwrap().name().unwrap(), "mimetype");

        let mut content = String::new();
        archive
            .by_name("OEBPS/ch1.xhtml")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert!(content.contains(r#"<span id="kobo.1.1">Chapter text</span>"#), "got: {content}");

        let mut css = String::new();
        archive
            .by_name("OEBPS/style.css")
            .unwrap()
            .read_to_string(&mut css)
            .unwrap();
        assert_eq!(css, "p { }");

        let _ = std::fs::remove_file(&source);
        let _ = std::fs::remove_file(&target);
    }
}
