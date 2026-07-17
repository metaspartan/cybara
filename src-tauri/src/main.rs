// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri::RunEvent;
use tauri_plugin_audio_recorder::{AudioFormat, AudioQuality, AudioRecorderExt, RecordingConfig};
use tauri_plugin_shell::ShellExt;

mod desktop_update;
mod tray;

const CYBARA_SERVER_ADDR: &str = "127.0.0.1:4269";
const CYBARA_SERVER_URL: &str = "http://127.0.0.1:4269";
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_millis(750);
const MAX_NATIVE_RECORDING_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStartupStatus {
    phase: String,
    message: Option<String>,
}

impl GatewayStartupStatus {
    fn starting() -> Self {
        Self {
            phase: "starting".into(),
            message: None,
        }
    }

    fn ready() -> Self {
        Self {
            phase: "ready".into(),
            message: None,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            phase: "failed".into(),
            message: Some(message.into()),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRecordingData {
    audio_base64: String,
    mime_type: String,
    file_name: String,
}

#[cfg(target_os = "macos")]
async fn ensure_microphone_access() -> Result<(), String> {
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};

    let media_type = unsafe { AVMediaTypeAudio }
        .ok_or_else(|| "macOS audio authorization is unavailable".to_string())?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };

    match status {
        AVAuthorizationStatus::Authorized => Ok(()),
        AVAuthorizationStatus::Denied => Err(
            "Microphone access is disabled. Enable Cybara in System Settings > Privacy & Security > Microphone."
                .into(),
        ),
        AVAuthorizationStatus::Restricted => {
            Err("Microphone access is restricted by macOS policy.".into())
        }
        AVAuthorizationStatus::NotDetermined => {
            let granted = tauri::async_runtime::spawn_blocking(|| {
                let media_type = unsafe { AVMediaTypeAudio }
                    .ok_or_else(|| "macOS audio authorization is unavailable".to_string())?;
                let (sender, receiver) = std::sync::mpsc::sync_channel(1);
                let handler = block2::RcBlock::new(move |granted: objc2::runtime::Bool| {
                    let _ = sender.send(granted.as_bool());
                });
                unsafe {
                    AVCaptureDevice::requestAccessForMediaType_completionHandler(
                        media_type,
                        &handler,
                    );
                }
                receiver
                    .recv_timeout(Duration::from_secs(120))
                    .map_err(|_| "Timed out waiting for microphone permission.".to_string())
            })
            .await
            .map_err(|error| error.to_string())??;
            if granted {
                Ok(())
            } else {
                Err(
                    "Microphone access was denied. Enable Cybara in System Settings > Privacy & Security > Microphone."
                        .into(),
                )
            }
        }
        _ => Err("macOS returned an unknown microphone authorization state".into()),
    }
}

#[cfg(not(target_os = "macos"))]
async fn ensure_microphone_access() -> Result<(), String> {
    Ok(())
}

async fn read_native_recording(path: String) -> Result<NativeRecordingData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let recording = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
        let temp =
            std::fs::canonicalize(std::env::temp_dir()).map_err(|error| error.to_string())?;
        let file_name = recording
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "invalid native recording path".to_string())?;
        if !recording.starts_with(&temp)
            || !file_name.starts_with("recording-")
            || recording.extension().and_then(|value| value.to_str()) != Some("wav")
        {
            return Err(
                "native recording path is outside the temporary recording directory".into(),
            );
        }
        let metadata = std::fs::metadata(&recording).map_err(|error| error.to_string())?;
        if metadata.len() > MAX_NATIVE_RECORDING_BYTES {
            return Err("native recording exceeds the maximum supported size".into());
        }
        let bytes = std::fs::read(&recording).map_err(|error| error.to_string())?;
        std::fs::remove_file(&recording).map_err(|error| error.to_string())?;
        Ok(NativeRecordingData {
            audio_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            mime_type: "audio/wav".into(),
            file_name: file_name.to_string(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_native_recording(app: tauri::AppHandle) -> Result<(), String> {
    ensure_microphone_access().await?;
    tauri::async_runtime::spawn_blocking(move || {
        app.audio_recorder()
            .start_recording(RecordingConfig {
                output_path: String::new(),
                format: AudioFormat::Wav,
                quality: AudioQuality::Low,
                max_duration: 300,
                device_id: None,
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stop_native_recording(app: tauri::AppHandle) -> Result<NativeRecordingData, String> {
    let recording = tauri::async_runtime::spawn_blocking(move || {
        app.audio_recorder()
            .stop_recording()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    read_native_recording(recording.file_path).await
}

fn should_log_sidecar_output() -> bool {
    !matches!(
        std::env::var("CYBARA_TAURI_LOG_SIDECAR"),
        Ok(value) if value == "0" || value.eq_ignore_ascii_case("false")
    )
}

fn bounded_sidecar_output(value: &str) -> String {
    value.trim().chars().take(64 * 1024).collect()
}

fn set_gateway_startup_status(app: &tauri::AppHandle, status: GatewayStartupStatus) {
    if let Some(state) = app.try_state::<GatewayStartupState>()
        && let Ok(mut guard) = state.0.lock()
    {
        *guard = status;
    }
}

#[tauri::command]
fn get_gateway_startup_status(app: tauri::AppHandle) -> GatewayStartupStatus {
    app.try_state::<GatewayStartupState>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()))
        .unwrap_or_else(GatewayStartupStatus::starting)
}

fn is_browser_diagnostic_line(value: &str) -> bool {
    value.contains("Browser preview")
        || value.contains("browser preview")
        || value.contains("Windows browser CDP")
        || value.contains("[Browser]")
}

fn is_server_running_at(addr: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect(addr) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(HEALTH_PROBE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(HEALTH_PROBE_TIMEOUT));

    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        addr
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };

    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    matches!(
        value.get("status").and_then(serde_json::Value::as_str),
        Some("healthy" | "warning" | "critical")
    )
}

fn is_server_running() -> bool {
    is_server_running_at(CYBARA_SERVER_ADDR)
}

fn wait_for_server_ready(timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if is_server_running() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
                println!("[Cybara] Sidecar stopped");
            }
        }
    }
}

fn cybara_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("CYBARA_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(home));
    }
    if let Some(home) = std::env::var_os("HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(home).join(".cybara"));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(profile).join(".cybara"));
    }
    None
}

#[tauri::command]
fn read_cybara_api_key() -> Result<Option<String>, String> {
    cybara_api_key()
}

pub(crate) fn badge_icon(base: &tauri::image::Image) -> tauri::image::Image<'static> {
    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();
    let w = width as i64;
    let h = height as i64;
    let radius = ((w.min(h) as f64) * 0.28).max(3.0);
    let cx = w as f64 - radius - 1.0;
    let cy = h as f64 - radius - 1.0;
    for y in 0..h {
        for x in 0..w {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            if dx * dx + dy * dy <= radius * radius {
                let idx = ((y * w + x) * 4) as usize;
                if idx + 3 < rgba.len() {
                    rgba[idx] = 124;
                    rgba[idx + 1] = 92;
                    rgba[idx + 2] = 255;
                    rgba[idx + 3] = 255;
                }
            }
        }
    }
    tauri::image::Image::new_owned(rgba, width, height)
}

fn cybara_api_key() -> Result<Option<String>, String> {
    if let Ok(key) = std::env::var("CYBARA_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    let Some(home) = cybara_home_dir() else {
        return Ok(None);
    };
    let path = home.join("api_key");
    match std::fs::read_to_string(&path) {
        Ok(value) => {
            let trimmed = value.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to read Cybara API key: {error}")),
    }
}

fn file_path_from_args(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        if std::path::Path::new(arg).exists() {
            return Some(arg.clone());
        }
    }
    None
}

fn ide_url_for_path(path: &str) -> Option<tauri::Url> {
    let mut url = tauri::Url::parse(CYBARA_SERVER_URL).ok()?;
    url.set_path("/ide");
    url.query_pairs_mut().append_pair("path", path);
    Some(url)
}

fn set_pending_open(app: &tauri::AppHandle, path: String) {
    if let Some(state) = app.try_state::<PendingOpen>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(path);
        }
    }
}

fn take_pending_open(app: &tauri::AppHandle) -> Option<String> {
    app.try_state::<PendingOpen>()
        .and_then(|state| state.0.lock().ok().and_then(|mut guard| guard.take()))
}

fn open_path_in_ide(app: &tauri::AppHandle, path: &str) {
    if !is_server_running() {
        set_pending_open(app, path.to_string());
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Some(url) = ide_url_for_path(path) {
            let _ = window.navigate(url);
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn navigate_after_ready(app: &tauri::AppHandle) {
    let pending = take_pending_open(app);
    if let Some(window) = app.get_webview_window("main") {
        let url = pending
            .as_deref()
            .and_then(ide_url_for_path)
            .unwrap_or_else(|| CYBARA_SERVER_URL.parse().unwrap());
        let _ = window.navigate(url);
    }
}

fn main() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = file_path_from_args(&argv) {
                open_path_in_ide(app, &path);
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_audio_recorder::init())
        .invoke_handler(tauri::generate_handler![
            read_cybara_api_key,
            get_gateway_startup_status,
            start_native_recording,
            stop_native_recording,
            desktop_update::get_desktop_update_state,
            desktop_update::check_desktop_update,
            desktop_update::install_desktop_update
        ])
        .setup(|app| {
            app.manage(SidecarState(std::sync::Mutex::new(None)));
            app.manage(PendingOpen(std::sync::Mutex::new(None)));
            app.manage(GatewayStartupState(std::sync::Mutex::new(
                GatewayStartupStatus::starting(),
            )));
            app.manage(desktop_update::DesktopUpdateManager::default());
            tray::setup(app)?;

            if let Some(path) = file_path_from_args(&std::env::args().collect::<Vec<_>>()) {
                set_pending_open(app.handle(), path);
            }

            if is_server_running() {
                println!("[Cybara] Server already running on port 4269");
                log::info!("Attached to existing Cybara gateway on port 4269");
                set_gateway_startup_status(app.handle(), GatewayStartupStatus::ready());

                navigate_after_ready(app.handle());

                return Ok(());
            }

            println!("[Cybara] Starting sidecar...");
            log::info!("Starting Cybara gateway sidecar");
            let Ok(mut sidecar) = app.shell().sidecar("cybara") else {
                let message = "The packaged Cybara gateway could not be located.";
                log::error!("{message}");
                set_gateway_startup_status(
                    app.handle(),
                    GatewayStartupStatus::failed(message),
                );
                return Ok(());
            };
            if let Ok(resource_dir) = app.path().resource_dir() {
                let resource_dir = resource_dir.to_string_lossy().to_string();
                let resource_dir = resource_dir
                    .strip_prefix(r"\\?\")
                    .map(|stripped| stripped.to_string())
                    .unwrap_or(resource_dir);
                sidecar = sidecar.env("CYBARA_RESOURCE_DIR", resource_dir);
            }
            let (mut rx, child) = match sidecar.args(["start"]).spawn() {
                Ok(result) => result,
                Err(error) => {
                    let message = format!("The Cybara gateway could not start: {error}");
                    log::error!("{message}");
                    set_gateway_startup_status(
                        app.handle(),
                        GatewayStartupStatus::failed(message),
                    );
                    return Ok(());
                }
            };

            let log_sidecar_output = should_log_sidecar_output();
            let output_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let output = String::from_utf8_lossy(&line);
                            let output = bounded_sidecar_output(&output);
                            if !output.is_empty() {
                                if is_browser_diagnostic_line(&output) {
                                    log::info!(target: "cybara::browser", "{output}");
                                } else if log_sidecar_output {
                                    log::info!(target: "cybara::sidecar", "{output}");
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            let output = String::from_utf8_lossy(&line);
                            let output = output.trim();
                            if !output.is_empty() {
                                if is_browser_diagnostic_line(output) {
                                    log::warn!(target: "cybara::browser", "{output}");
                                } else {
                                    log::warn!(target: "cybara::sidecar", "{output}");
                                }
                            }
                        }
                        CommandEvent::Terminated(payload) => {
                            println!("[Cybara] Sidecar terminated with code: {:?}", payload.code);
                            log::warn!(
                                "Cybara gateway sidecar terminated with code {:?}",
                                payload.code
                            );
                            set_gateway_startup_status(
                                &output_app_handle,
                                GatewayStartupStatus::failed(match payload.code {
                                    Some(code) => {
                                        format!("The Cybara gateway exited with code {code}.")
                                    }
                                    None => "The Cybara gateway exited unexpectedly.".into(),
                                }),
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            });

            if let Some(state) = app.try_state::<SidecarState>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(child);
                }
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if wait_for_server_ready(Duration::from_secs(25)) {
                    set_gateway_startup_status(&app_handle, GatewayStartupStatus::ready());
                    navigate_after_ready(&app_handle);
                } else {
                    eprintln!("[Cybara] Sidecar did not become ready within timeout");
                    log::error!("Cybara gateway sidecar did not become ready within timeout");
                    set_gateway_startup_status(
                        &app_handle,
                        GatewayStartupStatus::failed(
                            "The Cybara gateway did not become ready within 25 seconds. Review the desktop logs for the underlying sidecar error.",
                        ),
                    );
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Cybara");

    app.run(|app_handle, event| match &event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => stop_sidecar(app_handle),
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if let Some(path) = path.to_str() {
                        open_path_in_ide(app_handle, path);
                        break;
                    }
                }
            }
        }
        _ => {}
    });
}

struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

struct PendingOpen(std::sync::Mutex<Option<String>>);

struct GatewayStartupState(std::sync::Mutex<GatewayStartupStatus>);

#[cfg(test)]
mod tests {
    use super::is_server_running_at;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn server_check_is_false_for_closed_port() {
        assert!(!is_server_running_at("127.0.0.1:65534"));
    }

    #[test]
    fn server_check_is_false_when_listener_is_not_cybara() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test connection");
            let mut buffer = [0; 512];
            let _ = stream.read(&mut buffer);
            let body = "{\"ok\":true}";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        });

        assert!(!is_server_running_at(&addr.to_string()));
        handle.join().expect("join test server");
    }

    #[test]
    fn server_check_is_true_for_cybara_health_response() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test connection");
            let mut buffer = [0; 512];
            let _ = stream.read(&mut buffer);
            let body = "{\"status\":\"healthy\"}";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        });

        assert!(is_server_running_at(&addr.to_string()));
        handle.join().expect("join test server");
    }

    #[test]
    fn server_check_accepts_resource_pressure_statuses() {
        for status in ["warning", "critical"] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
            let addr = listener.local_addr().expect("read local addr");
            let status = status.to_string();
            let handle = thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept test connection");
                let mut buffer = [0; 512];
                let _ = stream.read(&mut buffer);
                let body = format!("{{\"status\":\"{}\"}}", status);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            });

            assert!(is_server_running_at(&addr.to_string()));
            handle.join().expect("join test server");
        }
    }
}
