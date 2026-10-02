#[path = "../src/image_export.rs"]
mod image_export;

use arboard::Clipboard;
use base64::Engine;

fn fixture_pixels() -> Vec<u8> {
    vec![
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
    ]
}

fn main() {
    if let Some(path) = std::env::args().nth(1) {
        let mut clipboard = Clipboard::new().expect("open clipboard");
        let written = clipboard.get_image().expect("read clipboard image");
        let image = image::RgbaImage::from_raw(
            written.width as u32,
            written.height as u32,
            written.bytes.into_owned(),
        )
        .expect("decode clipboard pixels");
        image.save(path).expect("save clipboard verification PNG");
        println!("clipboard image exported for pixel verification");
        return;
    }
    let image = image::RgbaImage::from_raw(2, 2, fixture_pixels()).expect("build fixture image");
    let mut buffer = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, image::ImageFormat::Png)
        .expect("encode fixture png");
    let encoded = base64::engine::general_purpose::STANDARD.encode(buffer.into_inner());

    image_export::copy_image_to_clipboard(encoded).expect("copy fixture png to clipboard");

    let mut clipboard = Clipboard::new().expect("open system clipboard");
    let written = clipboard.get_image().expect("read system clipboard image");
    assert_eq!((written.width, written.height), (2, 2));
    assert_eq!(written.bytes.as_ref(), fixture_pixels().as_slice());

    image_export::copy_image_to_clipboard("not base64!!".into())
        .expect_err("malformed base64 must be rejected");

    println!("clipboard probe ok: wrote 2x2 PNG and read exact pixels back");
}
