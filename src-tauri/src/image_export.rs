use base64::Engine;
use image::ImageDecoder;
use std::path::Path;

const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_ENCODED_BASE64_CHARS: usize = MAX_IMAGE_BYTES / 3 * 4 + 4;
const MAX_PNG_DIMENSION: u32 = 16_384;
const CLIPBOARD_ATTEMPTS: u32 = 3;
const CLIPBOARD_RETRY_DELAY_MS: u64 = 40;
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

fn decode_image_input(data_base64: String) -> Result<Vec<u8>, String> {
    if data_base64.len() > MAX_ENCODED_BASE64_CHARS {
        return Err("image exceeds the supported size".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| "image data is not valid base64".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("image exceeds the supported size".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub fn save_image_file(path: String, data_base64: String) -> Result<(), String> {
    let bytes = decode_image_input(data_base64)?;
    write_image_export(Path::new(&path), &bytes)
}

fn decode_png_rgba(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    if detect_image_kind(bytes) != Some(ImageKind::Png) {
        return Err("clipboard image must be a PNG image".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_PNG_DIMENSION);
    limits.max_image_height = Some(MAX_PNG_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_BYTES as u64);
    let decoder = image::codecs::png::PngDecoder::with_limits(std::io::Cursor::new(bytes), limits)
        .map_err(|error| format!("image data is not a readable PNG: {error}"))?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return Err("image dimensions must be greater than zero".into());
    }
    let decoded_len = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("image dimensions exceed the supported size")?;
    if decoded_len > MAX_IMAGE_BYTES as u64 {
        return Err("image dimensions exceed the supported size".into());
    }
    let image = image::DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("image data is not a readable PNG: {error}"))?;
    let buffer = image.to_rgba8().into_raw();
    Ok((width, height, buffer))
}

fn write_rgba_to_clipboard(width: u32, height: u32, pixels: Vec<u8>) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};
    let mut last_error = "system clipboard is unavailable".to_string();
    for attempt in 0..CLIPBOARD_ATTEMPTS {
        let outcome = Clipboard::new()
            .and_then(|mut clipboard| {
                clipboard.set_image(ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: pixels.as_slice().into(),
                })
            })
            .map_err(|error| error.to_string());
        match outcome {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
        if attempt + 1 < CLIPBOARD_ATTEMPTS {
            std::thread::sleep(std::time::Duration::from_millis(CLIPBOARD_RETRY_DELAY_MS));
        }
    }
    Err(format!("system clipboard write failed: {last_error}"))
}

#[tauri::command]
pub fn copy_image_to_clipboard(data_base64: String) -> Result<(), String> {
    let bytes = decode_image_input(data_base64)?;
    let (width, height, pixels) = decode_png_rgba(&bytes)?;
    write_rgba_to_clipboard(width, height, pixels)
}

#[cfg(test)]
mod tests {
    use super::{
        ImageKind, MAX_ENCODED_BASE64_CHARS, copy_image_to_clipboard, decode_png_rgba,
        detect_image_kind, write_image_export,
    };
    use base64::Engine;
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

    fn fixture_pixels() -> Vec<u8> {
        vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
        ]
    }

    fn png_fixture() -> Vec<u8> {
        let image =
            image::RgbaImage::from_raw(2, 2, fixture_pixels()).expect("build fixture image");
        let mut buffer = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut buffer, image::ImageFormat::Png)
            .expect("encode fixture png");
        buffer.into_inner()
    }

    fn encode_base64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xedb8_8320 & mask);
            }
        }
        !crc
    }

    fn push_chunk(bytes: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(data);
        let mut crc_input = Vec::new();
        crc_input.extend_from_slice(kind);
        crc_input.extend_from_slice(data);
        bytes.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    }

    fn png_announcing_dimensions(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let mut header = Vec::new();
        header.extend_from_slice(&width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[8, 6, 0, 0, 0]);
        push_chunk(&mut bytes, b"IHDR", &header);
        push_chunk(
            &mut bytes,
            b"IDAT",
            &[0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01],
        );
        push_chunk(&mut bytes, b"IEND", &[]);
        bytes
    }

    #[test]
    fn decodes_valid_png_fixture_into_expected_rgba_pixels() {
        let (width, height, pixels) = decode_png_rgba(&png_fixture()).expect("decode fixture png");
        assert_eq!((width, height), (2, 2));
        assert_eq!(pixels, fixture_pixels());
    }

    #[test]
    fn expands_rgb_and_grayscale_pngs_into_rgba_without_pixel_loss() {
        let rgb = image::RgbImage::from_raw(2, 1, vec![255, 0, 0, 0, 255, 0])
            .expect("construct RGB fixture");
        let gray =
            image::GrayImage::from_raw(2, 1, vec![0, 255]).expect("construct grayscale fixture");
        for (source, expected) in [
            (
                image::DynamicImage::ImageRgb8(rgb),
                vec![255, 0, 0, 255, 0, 255, 0, 255],
            ),
            (
                image::DynamicImage::ImageLuma8(gray),
                vec![0, 0, 0, 255, 255, 255, 255, 255],
            ),
        ] {
            let mut encoded = std::io::Cursor::new(Vec::new());
            source
                .write_to(&mut encoded, image::ImageFormat::Png)
                .expect("encode fixture");
            let (width, height, pixels) =
                decode_png_rgba(&encoded.into_inner()).expect("decode PNG");
            assert_eq!((width, height), (2, 1));
            assert_eq!(pixels, expected);
        }
    }
    #[test]
    fn rejects_malformed_base64_for_clipboard_copies() {
        assert_eq!(
            copy_image_to_clipboard("not base64!!".into()),
            Err("image data is not valid base64".to_string())
        );
        assert!(copy_image_to_clipboard(String::new()).is_err());
    }

    #[test]
    fn rejects_encoded_input_beyond_the_supported_size() {
        let oversized = "A".repeat(MAX_ENCODED_BASE64_CHARS + 4);
        assert!(copy_image_to_clipboard(oversized).is_err());
    }

    #[test]
    fn rejects_non_png_and_incomplete_png_clipboard_payloads() {
        assert!(copy_image_to_clipboard(encode_base64(b"not an image at all")).is_err());
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, b'J', b'F', b'I', b'F'];
        assert!(copy_image_to_clipboard(encode_base64(&jpeg)).is_err());
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert!(copy_image_to_clipboard(encode_base64(svg)).is_err());
        let truncated = &png_fixture()[..png_fixture().len() / 2];
        assert!(copy_image_to_clipboard(encode_base64(truncated)).is_err());
        let signature_only = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        assert!(copy_image_to_clipboard(encode_base64(signature_only)).is_err());
    }

    #[test]
    fn rejects_png_headers_that_exceed_the_decoded_size_bound() {
        let bomb = png_announcing_dimensions(30_000, 30_000);
        assert!(decode_png_rgba(&bomb).is_err());
        let wide = png_announcing_dimensions(64_000, 2);
        assert!(decode_png_rgba(&wide).is_err());
    }

    #[test]
    fn clipboard_roundtrip_preserves_exact_pixels_when_opted_in() {
        if std::env::var("CYBARA_TEST_IMAGE_CLIPBOARD").as_deref() != Ok("1") {
            return;
        }
        let previous = arboard::Clipboard::new()
            .ok()
            .and_then(|mut clipboard| clipboard.get_image().ok());
        copy_image_to_clipboard(encode_base64(&png_fixture())).expect("copy fixture to clipboard");
        let mut clipboard = arboard::Clipboard::new().expect("open system clipboard");
        let image = clipboard.get_image().expect("read system clipboard image");
        assert_eq!((image.width, image.height), (2, 2));
        assert_eq!(image.bytes.as_ref(), fixture_pixels().as_slice());
        if let Some(previous) = previous {
            let _ = clipboard.set_image(previous);
        }
    }
}
