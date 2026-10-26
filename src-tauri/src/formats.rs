use std::fs::File;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use zip::ZipArchive;

use crate::error::AppError;

#[derive(Debug, Default, Clone)]
pub struct ExtractedMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub year: Option<i64>,
    pub cover: Option<Vec<u8>>,
    pub cover_ext: Option<String>,
}

pub fn extract(path: &Path, format: &str) -> Result<ExtractedMeta, AppError> {
    match format {
        "epub" => extract_epub(path),
        "pdf" => extract_pdf(path),
        other => Err(AppError::msg(format!("unsupported format: {other}"))),
    }
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

fn extract_epub(path: &Path) -> Result<ExtractedMeta, AppError> {
    let file = File::open(path)?;
    let mut zip = ZipArchive::new(file)?;

    let container = read_zip_text(&mut zip, "META-INF/container.xml").ok_or_else(|| {
        AppError::msg("not a valid EPUB: missing META-INF/container.xml")
    })?;

    let opf_path = parse_container(&container)
        .ok_or_else(|| AppError::msg("not a valid EPUB: no rootfile in container.xml"))?;

    let opf = read_zip_text(&mut zip, &opf_path)
        .ok_or_else(|| AppError::msg(format!("EPUB is missing its OPF file: {opf_path}")))?;

    let meta = parse_opf(&opf);

    let cover = meta
        .cover_href
        .as_ref()
        .and_then(|href| {
            let full = resolve_opf_path(&opf_path, &percent_decode(href));
            read_zip_bytes(&mut zip, &full)
        })
        .map(|(bytes, ext)| {
            let cover_ext = ext.unwrap_or_else(|| "jpg".to_string());
            (bytes, cover_ext)
        });

    Ok(ExtractedMeta {
        title: meta.title,
        author: meta.author,
        year: meta.year,
        cover: cover.as_ref().map(|(b, _)| b.clone()),
        cover_ext: cover.map(|(_, e)| e),
    })
}

fn read_zip_text(zip: &mut ZipArchive<File>, name: &str) -> Option<String> {
    let mut out = String::new();
    with_zip_entry(zip, name, |entry| {
        use std::io::Read;
        entry.read_to_string(&mut out)
    })?;
    Some(out)
}

fn read_zip_bytes(zip: &mut ZipArchive<File>, name: &str) -> Option<(Vec<u8>, Option<String>)> {
    let ext = name.rsplit('.').next().map(|e| e.to_ascii_lowercase());
    let mut out = Vec::new();
    with_zip_entry(zip, name, |entry| {
        use std::io::Read;
        entry.read_to_end(&mut out)
    })?;
    Some((out, ext))
}

/// Run `f` on the zip entry matching `name` (case-insensitive fallback),
/// keeping the archive borrow contained inside this function.
fn with_zip_entry<R>(
    zip: &mut ZipArchive<File>,
    name: &str,
    f: impl for<'z> FnOnce(&mut zip::read::ZipFile<'z, File>) -> std::io::Result<R>,
) -> Option<R> {
    let names: Vec<String> = zip
        .file_names()
        .filter_map(|n| n.ok().map(|s| s.into_owned()))
        .collect();
    let idx = names
        .iter()
        .position(|n| n.eq_ignore_ascii_case(name))
        .or_else(|| {
            let lower = name.to_lowercase();
            names.iter().position(|n| n.to_lowercase() == lower)
        })?;
    let mut entry = zip.by_index(idx).ok()?;
    match f(&mut entry) {
        Ok(v) => Some(v),
        Err(_) => None,
    }
}

/// Parse META-INF/container.xml and return the OPF path.
fn parse_container(container: &str) -> Option<String> {
    let mut reader = Reader::from_str(container);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if local_name(e.name().as_ref()) == "rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == "full-path" {
                            return Some(attr_value(&attr));
                        }
                    }
                }
            }
            Ok(Event::Eof) => return None,
            Err(_) => return None,
            _ => {}
        }
    }
}

struct OpfParsed {
    title: Option<String>,
    author: Option<String>,
    year: Option<i64>,
    cover_href: Option<String>,
}

#[derive(Default)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

fn parse_opf(opf: &str) -> OpfParsed {
    let mut reader = Reader::from_str(opf);
    reader.config_mut().trim_text(true);

    let mut title: Option<String> = None;
    let mut author: Option<String> = None;
    let mut manifest: Vec<ManifestItem> = Vec::new();
    let mut cover_meta_id: Option<String> = None;

    // Which text-bearing element we are currently inside of.
    #[derive(PartialEq)]
    enum Want {
        Title,
        Author,
        Date,
        None,
    }
    let mut want = Want::None;
    let mut date: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_string();
                match name.as_str() {
                    "title" if title.is_none() => want = Want::Title,
                    "creator" if author.is_none() => want = Want::Author,
                    "date" if date.is_none() => want = Want::Date,
                    "item" => {
                        let mut item = ManifestItem::default();
                        for attr in e.attributes().flatten() {
                            let value = attr_value(&attr);
                            match attr.key.as_ref() {
                                "id" => item.id = value,
                                "href" => item.href = value,
                                "media-type" => item.media_type = value,
                                "properties" => item.properties = value,
                                _ => {}
                            }
                        }
                        manifest.push(item);
                    }
                    "meta" => {
                        let mut name_attr: Option<String> = None;
                        let mut content_attr: Option<String> = None;
                        for attr in e.attributes().flatten() {
                            let value = attr_value(&attr);
                            match attr.key.as_ref() {
                                "name" => name_attr = Some(value),
                                "content" => content_attr = Some(value),
                                _ => {}
                            }
                        }
                        if name_attr.as_deref() == Some("cover") {
                            cover_meta_id = content_attr;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                if local_name(e.name().as_ref()) == "item" {
                    let mut item = ManifestItem::default();
                    for attr in e.attributes().flatten() {
                        let value = attr_value(&attr);
                        match attr.key.as_ref() {
                            "id" => item.id = value,
                            "href" => item.href = value,
                            "media-type" => item.media_type = value,
                            "properties" => item.properties = value,
                            _ => {}
                        }
                    }
                    manifest.push(item);
                }
            }
            Ok(Event::Text(t)) => {
                let text = t
                    .xml_content(XmlVersion::Implicit1_0)
                    .trim()
                    .to_string();
                if !text.is_empty() {
                    match want {
                        Want::Title if title.is_none() => title = Some(text),
                        Want::Author if author.is_none() => author = Some(text),
                        Want::Date if date.is_none() => date = Some(text),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_string();
                if name == "title" || name == "creator" || name == "date" {
                    want = Want::None;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    // Resolve the cover: EPUB3 uses properties="cover-image",
    // EPUB2 uses <meta name="cover" content="id"/> pointing at a manifest item.
    let cover_href = manifest
        .iter()
        .find(|m| m.properties.split_whitespace().any(|p| p == "cover-image"))
        .map(|m| m.href.clone())
        .or_else(|| {
            cover_meta_id
                .as_deref()
                .and_then(|id| manifest.iter().find(|m| m.id == id).map(|m| m.href.clone()))
        })
        .or_else(|| {
            manifest
                .iter()
                .find(|m| {
                    m.media_type.starts_with("image/")
                        && (m.id.to_lowercase().contains("cover")
                            || m.href.to_lowercase().contains("cover"))
                })
                .map(|m| m.href.clone())
        });

    OpfParsed {
        title,
        author,
        year: date.as_deref().and_then(parse_year),
        cover_href,
    }
}

/// Pull a plausible publication year (1000-3000) out of a date-ish string
/// such as "1999-11-30" or "0101-01-01T00:00:00+00:00".
pub fn parse_year(raw: &str) -> Option<i64> {
    let digits: String = raw
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.len() < 4 {
        return None;
    }
    let year: i64 = digits[..4].parse().ok()?;
    (1000..=3000).contains(&year).then_some(year)
}

fn attr_value(attr: &quick_xml::events::attributes::Attribute) -> String {
    attr.normalized_value(XmlVersion::Implicit1_0)
        .map(|v| v.into_owned())
        .unwrap_or_else(|_| attr.value.clone().into_owned())
}

fn local_name(name: &str) -> &str {
    match name.find(':') {
        Some(i) => &name[i + 1..],
        None => name,
    }
}

fn resolve_opf_path(opf_path: &str, href: &str) -> String {
    if href.starts_with('/') {
        return href.trim_start_matches('/').to_string();
    }
    let base = match opf_path.rfind('/') {
        Some(i) => &opf_path[..i],
        None => "",
    };
    let joined = if base.is_empty() {
        href.to_string()
    } else {
        format!("{base}/{href}")
    };
    normalize_zip_path(&joined)
}

fn normalize_zip_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

fn extract_pdf(path: &Path) -> Result<ExtractedMeta, AppError> {
    let doc = lopdf::Document::load(path)
        .map_err(|e| AppError::msg(format!("failed to read PDF: {e}")))?;

    Ok(ExtractedMeta {
        title: info_string(&doc, "Title"),
        author: info_string(&doc, "Author"),
        year: None,
        cover: None,
        cover_ext: None,
    })
}

fn info_string(doc: &lopdf::Document, key: &str) -> Option<String> {
    let info = doc.trailer.get(b"Info").ok()?;
    let dict = match info {
        lopdf::Object::Reference(id) => match doc.get_object(*id).ok()? {
            lopdf::Object::Dictionary(d) => d,
            _ => return None,
        },
        lopdf::Object::Dictionary(d) => d,
        _ => return None,
    };
    let value = dict.get(key.as_bytes()).ok()?;
    match value {
        lopdf::Object::String(bytes, _) => Some(decode_pdf_string(bytes.as_slice())),
        _ => None,
    }
}

fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        // UTF-16BE with BOM
        let mut units = Vec::with_capacity((bytes.len() - 2) / 2);
        for chunk in bytes[2..].chunks_exact(2) {
            units.push(u16::from_be_bytes([chunk[0], chunk[1]]));
        }
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    #[test]
    fn extracts_epub_metadata_and_cover() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test.epub");
        let file = File::create(&path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(
            b"<?xml version=\"1.0\"?>\
              <container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\
              <rootfiles>\
              <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\
              </rootfiles></container>",
        )
        .unwrap();

        zip.start_file("OEBPS/content.opf", options).unwrap();
        zip.write_all(
            b"<?xml version=\"1.0\"?>\
              <package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" \
              xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\
              <metadata>\
              <dc:title>The Great Test</dc:title>\
              <dc:creator>Ada Lovelace</dc:creator>\
              </metadata>\
              <manifest>\
              <item id=\"cover\" href=\"cover.jpg\" media-type=\"image/jpeg\" properties=\"cover-image\"/>\
              </manifest></package>",
        )
        .unwrap();

        zip.start_file("OEBPS/cover.jpg", options).unwrap();
        zip.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();
        zip.finish().unwrap();

        let meta = extract(&path, "epub").unwrap();
        assert_eq!(meta.title.as_deref(), Some("The Great Test"));
        assert_eq!(meta.author.as_deref(), Some("Ada Lovelace"));
        assert_eq!(meta.cover.as_deref(), Some(&[0xFF, 0xD8, 0xFF, 0xE0][..]));
        assert_eq!(meta.cover_ext.as_deref(), Some("jpg"));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parse_year_extracts_plausible_years() {
        assert_eq!(parse_year("1999-11-30T00:00:00+00:00"), Some(1999));
        assert_eq!(parse_year("2003"), Some(2003));
        assert_eq!(parse_year("0101-01-01 00:00:00+00:00"), None);
        assert_eq!(parse_year("no date here"), None);
    }
}
