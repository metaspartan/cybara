#[path = "../src/image_export.rs"]
mod image_export;

use std::path::PathBuf;
use tauri::WebviewUrl;

fn main() {
    let profile = std::env::var("CYBARA_IMAGE_EXPORT_SMOKE_HOME")
        .expect("an isolated smoke profile is required");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            image_export::save_image_file,
            image_export::copy_image_to_clipboard
        ]);
    let receipt = PathBuf::from(&profile).with_extension("saved-path");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(move |invoke| {
            if invoke.message.command() == "save_image_file" {
                if let tauri::ipc::InvokeBody::Json(body) = invoke.message.payload() {
                    if let Some(path) = body.get("path").and_then(serde_json::Value::as_str) {
                        std::fs::write(&receipt, path).expect("record chosen fixture save path");
                    }
                }
            }
            handler(invoke)
        })
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(
                    "http://127.0.0.1:4271/chat?session=native-image-export".parse()?,
                ),
            )
            .initialization_script(
                "sessionStorage.setItem('cybara_api_key', 'image-native-fixture-key')",
            )
            .visible(false)
            .title("Cybara image export verification")
            .inner_size(1200.0, 900.0)
            .data_directory(PathBuf::from(&profile))
            .build()?;
            Ok(())
        })
        .run(context)
        .expect("image export smoke host failed");
}
