use base64::Engine;
use std::path::Path;

const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const SVG_SNIFF_BYTES: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ImageKind {
    Png,
    Jpeg,
    Gif,
    Webp,
    Bmp,
    Avif,
    Svg,
}

impl ImageKind {
    fn extensions(self) -> &'static [&'static str] {
        match self {
            ImageKind::Png => &["png"],
            ImageKind::Jpeg => &["jpg", "jpeg"],
            ImageKind::Gif => &["gif"],
            ImageKind::Webp => &["webp"],
            ImageKind::Bmp => &["bmp"],
            ImageKind::Avif => &["avif"],
            ImageKind::Svg => &["svg"],
        }
    }
}

fn detect_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(SVG_SNIFF_BYTES)];
    let Ok(text) = std::str::from_utf8(head) else {
        return false;
    };
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    let lowered = trimmed.to_ascii_lowercase();
    (lowered.starts_with("<svg") || lowered.starts_with("<?xml")) && lowered.contains("<svg")
}

fn detect_image_kind(bytes: &[u8]) -> Option<ImageKind> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some(ImageKind::Png);
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(ImageKind::Jpeg);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(ImageKind::Gif);
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(ImageKind::Webp);
    }
    if bytes.starts_with(b"BM") {
        return Some(ImageKind::Bmp);
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"avif" | b"avis") {
        return Some(ImageKind::Avif);
    }
    if detect_svg(bytes) {
        return Some(ImageKind::Svg);
    }
    None
}

fn extension_matches(path: &Path, kind: ImageKind) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .is_some_and(|value| kind.extensions().contains(&value.as_str()))
}

fn write_image_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("image exceeds the supported size".into());
    }
    let kind = detect_image_kind(bytes).ok_or("content is not a supported image format")?;
    if !path.is_absolute() {
        return Err("image export path must be absolute".into());
    }
    if path.file_name().is_none() || !extension_matches(path, kind) {
        return Err("image export path extension does not match the image format".into());
    }
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_image_file(path: String, data_base64: String) -> Result<(), String> {
    if data_base64.len() > MAX_IMAGE_BYTES / 3 * 4 + 4 {
        return Err("image exceeds the supported size".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| "image data is not valid base64".to_string())?;
    write_image_export(Path::new(&path), &bytes)
}

#[cfg(test)]
mod tests {
    use super::{ImageKind, detect_image_kind, write_image_export};
    use std::path::PathBuf;

    const PNG_BYTES: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

    fn scratch_dir(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("cybara-image-export-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create image export root");
        root
    }

    #[test]
    fn detects_supported_image_signatures() {
        assert_eq!(detect_image_kind(&PNG_BYTES), Some(ImageKind::Png));
        assert_eq!(
            detect_image_kind(&[0xff, 0xd8, 0xff, 0xe0]),
            Some(ImageKind::Jpeg)
        );
        assert_eq!(detect_image_kind(b"GIF89a...."), Some(ImageKind::Gif));
        assert_eq!(
            detect_image_kind(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(ImageKind::Webp)
        );
        assert_eq!(detect_image_kind(b"BM......"), Some(ImageKind::Bmp));
        assert_eq!(
            detect_image_kind(b"\0\0\0\x1cftypavif"),
            Some(ImageKind::Avif)
        );
        assert_eq!(
            detect_image_kind(
                b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"
            ),
            Some(ImageKind::Svg)
        );
        assert_eq!(
            detect_image_kind(b"<svg viewBox=\"0 0 1 1\"></svg>"),
            Some(ImageKind::Svg)
        );
    }

    #[test]
    fn rejects_non_image_content() {
        assert_eq!(detect_image_kind(b"#!/bin/sh\nrm -rf /"), None);
        assert_eq!(detect_image_kind(b"<html><body></body></html>"), None);
        assert_eq!(
            detect_image_kind(b"<?xml version=\"1.0\"?><plist></plist>"),
            None
        );
        assert_eq!(detect_image_kind(&[]), None);
    }

    #[test]
    fn writes_image_bytes_to_a_matching_absolute_path() {
        let root = scratch_dir("write");
        let path = root.join("shot.png");
        write_image_export(&path, &PNG_BYTES).expect("write image export");
        assert_eq!(std::fs::read(&path).expect("read image export"), PNG_BYTES);
        std::fs::remove_dir_all(root).expect("remove image export root");
    }

    #[test]
    fn rejects_mismatched_extension_relative_path_and_non_image_bytes() {
        let root = scratch_dir("reject");
        assert!(write_image_export(&root.join("shot.sh"), &PNG_BYTES).is_err());
        assert!(write_image_export(&root.join("shot.jpg"), &PNG_BYTES).is_err());
        assert!(write_image_export(&root.join("shot"), &PNG_BYTES).is_err());
        assert!(write_image_export(&PathBuf::from("shot.png"), &PNG_BYTES).is_err());
        assert!(write_image_export(&root.join("shot.png"), b"not an image").is_err());
        assert!(write_image_export(&root.join("shot.png"), &[]).is_err());
        assert!(!root.join("shot.sh").exists());
        assert!(!root.join("shot.png").exists());
        std::fs::remove_dir_all(root).expect("remove image export root");
    }

    #[test]
    fn accepts_jpeg_with_either_extension() {
        let root = scratch_dir("jpeg");
        let bytes = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
        write_image_export(&root.join("a.JPG"), &bytes).expect("write jpg");
        write_image_export(&root.join("b.jpeg"), &bytes).expect("write jpeg");
        std::fs::remove_dir_all(root).expect("remove image export root");
    }
}
