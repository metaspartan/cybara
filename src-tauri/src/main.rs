// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri::RunEvent;
use tauri_plugin_audio_recorder::{AudioFormat, AudioQuality, AudioRecorderExt, RecordingConfig};
use tauri_plugin_shell::ShellExt;

mod desktop_update;
mod gateway;
mod gateway_supervision;
mod tray;

const CYBARA_DEFAULT_PORT: u16 = 4269;
const CYBARA_FALLBACK_PORT_COUNT: u16 = 10;
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

    fn restarting(message: impl Into<String>) -> Self {
        Self {
            phase: "starting".into(),
            message: Some(message.into()),
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

#[tauri::command]
fn write_theme_file(path: String, content: String) -> Result<(), String> {
    const MAX_THEME_BYTES: usize = 64 * 1024;
    if content.len() > MAX_THEME_BYTES {
        return Err("theme file exceeds the maximum supported size".into());
    }
    let target = std::path::PathBuf::from(path);
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !file_name.ends_with(".cybara-theme.json") {
        return Err("theme export path must end with .cybara-theme.json".into());
    }
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|_| "theme export content is not valid JSON".to_string())?;
    std::fs::write(target, content).map_err(|error| error.to_string())
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

const SIDECAR_STDERR_TAIL_LINES: usize = 8;

fn record_sidecar_stderr(buffer: &std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>>, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    if let Ok(mut guard) = buffer.lock() {
        guard.push_back(trimmed.chars().take(600).collect());
        while guard.len() > SIDECAR_STDERR_TAIL_LINES {
            guard.pop_front();
        }
    }
}

fn sidecar_failure_reason(
    base: String,
    buffer: &std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>>,
) -> String {
    let tail = buffer
        .lock()
        .ok()
        .map(|guard| guard.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    if tail.is_empty() {
        return base;
    }
    format!("{base} Gateway output:\n{}", tail.join("\n"))
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

#[tauri::command]
fn restart_gateway_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<GatewaySupervisionState>()
        .ok_or_else(|| "Gateway supervisor is unavailable".to_string())?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Gateway supervisor is unavailable".to_string())?;
    *guard = gateway_supervision::GatewaySupervision::default();
    drop(guard);
    stop_sidecar(&app);
    set_gateway_startup_status(
        &app,
        GatewayStartupStatus::restarting("Restarting the Cybara gateway."),
    );
    start_sidecar(app);
    Ok(())
}

fn is_browser_diagnostic_line(value: &str) -> bool {
    value.contains("Browser preview")
        || value.contains("browser preview")
        || value.contains("Windows browser CDP")
        || value.contains("[Browser]")
}

fn wait_for_server_ready(
    endpoint: &gateway::GatewayEndpoint,
    expected_version: &str,
    timeout: Duration,
) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if gateway::is_compatible_gateway_at(&endpoint.addr, expected_version) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.generation = guard.generation.wrapping_add(1);
            guard.launching = false;
            if let Some(child) = guard.child.take() {
                let _ = child.kill();
                println!("[Cybara] Sidecar stopped");
            }
        }
    }
}

fn shutdown_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<GatewaySupervisionState>()
        && let Ok(mut guard) = state.0.lock()
    {
        guard.mark_shutting_down();
    }
    stop_sidecar(app);
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

fn gateway_endpoint(app: &tauri::AppHandle) -> gateway::GatewayEndpoint {
    app.try_state::<GatewayRuntimeState>()
        .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()))
        .unwrap_or_else(|| gateway::GatewayEndpoint::loopback(CYBARA_DEFAULT_PORT))
}

fn set_gateway_endpoint(app: &tauri::AppHandle, endpoint: gateway::GatewayEndpoint) {
    if let Some(state) = app.try_state::<GatewayRuntimeState>()
        && let Ok(mut guard) = state.0.lock()
    {
        *guard = endpoint;
    }
}

#[tauri::command]
fn get_gateway_url(app: tauri::AppHandle) -> String {
    gateway_endpoint(&app).url
}

fn ide_url_for_path(base_url: &str, path: &str) -> Option<tauri::Url> {
    let mut url = tauri::Url::parse(base_url).ok()?;
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
    let endpoint = gateway_endpoint(app);
    if !gateway::is_compatible_gateway_at(&endpoint.addr, env!("CARGO_PKG_VERSION")) {
        set_pending_open(app, path.to_string());
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Some(url) = ide_url_for_path(&endpoint.url, path) {
            let _ = window.navigate(url);
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn navigate_after_ready(app: &tauri::AppHandle) {
    let pending = take_pending_open(app);
    let endpoint = gateway_endpoint(app);
    if let Some(window) = app.get_webview_window("main") {
        let url = pending
            .as_deref()
            .and_then(|path| ide_url_for_path(&endpoint.url, path))
            .or_else(|| {
                window
                    .url()
                    .ok()
                    .and_then(|current| gateway_url_for_location(&endpoint.url, &current))
            })
            .unwrap_or_else(|| endpoint.url.parse().unwrap());
        let _ = window.navigate(url);
    }
}

fn gateway_url_for_location(base_url: &str, current: &tauri::Url) -> Option<tauri::Url> {
    let mut target = tauri::Url::parse(base_url).ok()?;
    if matches!(current.scheme(), "http" | "https") {
        target.set_path(current.path());
        target.set_query(current.query());
        target.set_fragment(current.fragment());
    }
    Some(target)
}

fn reserve_sidecar_launch(app: &tauri::AppHandle) -> Option<u64> {
    let state = app.try_state::<SidecarState>()?;
    let mut guard = state.0.lock().ok()?;
    if guard.child.is_some() || guard.launching {
        return None;
    }
    guard.launching = true;
    guard.generation = guard.generation.wrapping_add(1);
    Some(guard.generation)
}

fn release_sidecar_launch(app: &tauri::AppHandle, generation: u64) {
    if let Some(state) = app.try_state::<SidecarState>()
        && let Ok(mut guard) = state.0.lock()
        && guard.generation == generation
    {
        guard.launching = false;
    }
}

fn store_sidecar_child(
    app: &tauri::AppHandle,
    generation: u64,
    child: tauri_plugin_shell::process::CommandChild,
) {
    let mut child = Some(child);
    if let Some(state) = app.try_state::<SidecarState>()
        && let Ok(mut guard) = state.0.lock()
        && guard.generation == generation
        && guard.launching
    {
        guard.child = child.take();
        guard.launching = false;
    }
    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn clear_terminated_sidecar(app: &tauri::AppHandle, generation: u64) -> bool {
    let Some(state) = app.try_state::<SidecarState>() else {
        return false;
    };
    let Ok(mut guard) = state.0.lock() else {
        return false;
    };
    if guard.generation != generation {
        return false;
    }
    guard.child = None;
    guard.launching = false;
    true
}

fn stop_sidecar_generation(app: &tauri::AppHandle, generation: u64) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if guard.generation != generation {
        return;
    }
    guard.generation = guard.generation.wrapping_add(1);
    guard.launching = false;
    if let Some(child) = guard.child.take() {
        let _ = child.kill();
    }
}

fn record_gateway_healthy(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<GatewaySupervisionState>()
        && let Ok(mut guard) = state.0.lock()
    {
        guard.record_healthy();
    }
}

fn schedule_sidecar_restart(app: tauri::AppHandle, reason: String) {
    use gateway_supervision::RestartPlan;

    let plan = app
        .try_state::<GatewaySupervisionState>()
        .and_then(|state| {
            state
                .0
                .lock()
                .ok()
                .map(|mut guard| guard.schedule_restart())
        });
    match plan {
        Some(RestartPlan::Retry { attempt, delay }) => {
            let message = format!(
                "Gateway unavailable. Restarting in {}s (attempt {attempt}/{}).",
                delay.as_secs(),
                gateway_supervision::MAX_RESTART_ATTEMPTS
            );
            log::warn!("{reason} {message}");
            set_gateway_startup_status(&app, GatewayStartupStatus::restarting(message));
            std::thread::spawn(move || {
                std::thread::sleep(delay);
                let should_start = app
                    .try_state::<GatewaySupervisionState>()
                    .and_then(|state| {
                        state
                            .0
                            .lock()
                            .ok()
                            .map(|mut guard| guard.begin_scheduled_restart())
                    })
                    .unwrap_or(false);
                if should_start {
                    start_sidecar(app);
                }
            });
        }
        Some(RestartPlan::Exhausted) => {
            let message = format!(
                "The Cybara gateway could not recover after {} attempts. Review the desktop and gateway logs, then restart Cybara.",
                gateway_supervision::MAX_RESTART_ATTEMPTS
            );
            log::error!("{reason} {message}");
            set_gateway_startup_status(&app, GatewayStartupStatus::failed(message));
        }
        Some(RestartPlan::AlreadyScheduled | RestartPlan::ShuttingDown) | None => {}
    }
}

fn start_sidecar(app: tauri::AppHandle) {
    let Some(generation) = reserve_sidecar_launch(&app) else {
        return;
    };
    let preferred = gateway::GatewayEndpoint::loopback(CYBARA_DEFAULT_PORT);
    if gateway::is_compatible_gateway_at(&preferred.addr, env!("CARGO_PKG_VERSION")) {
        release_sidecar_launch(&app, generation);
        set_gateway_endpoint(&app, preferred);
        record_gateway_healthy(&app);
        set_gateway_startup_status(&app, GatewayStartupStatus::ready());
        navigate_after_ready(&app);
        return;
    }

    log::info!(
        "Starting Cybara gateway sidecar on ports {}-{}",
        CYBARA_DEFAULT_PORT,
        CYBARA_DEFAULT_PORT + CYBARA_FALLBACK_PORT_COUNT
    );
    let Ok(mut sidecar) = app.shell().sidecar("cybara") else {
        release_sidecar_launch(&app, generation);
        schedule_sidecar_restart(
            app,
            "The packaged Cybara gateway could not be located.".into(),
        );
        return;
    };
    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_dir = resource_dir.to_string_lossy().to_string();
        let resource_dir = resource_dir
            .strip_prefix(r"\\?\")
            .map(|stripped| stripped.to_string())
            .unwrap_or(resource_dir);
        sidecar = sidecar.env("CYBARA_RESOURCE_DIR", resource_dir);
    }
    sidecar = sidecar
        .env("PORT", CYBARA_DEFAULT_PORT.to_string())
        .env(
            "CYBARA_PORT_FALLBACK_COUNT",
            CYBARA_FALLBACK_PORT_COUNT.to_string(),
        )
        .env("CYBARA_GATEWAY_PORT_SIGNAL", "stdout")
        .env("CYBARA_NATIVE_APP", "1")
        .env("CYBARA_NATIVE_PARENT_PID", std::process::id().to_string());
    let (port_sender, port_receiver) = std::sync::mpsc::sync_channel(1);
    let (mut rx, child) = match sidecar.args(["start"]).spawn() {
        Ok(result) => result,
        Err(error) => {
            release_sidecar_launch(&app, generation);
            schedule_sidecar_restart(app, format!("The Cybara gateway could not start: {error}"));
            return;
        }
    };

    store_sidecar_child(&app, generation, child);
    let log_sidecar_output = should_log_sidecar_output();
    let output_app = app.clone();
    let stderr_tail: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>> =
        std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
    let stderr_tail_events = stderr_tail.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        let mut port_sender = Some(port_sender);
        let mut port_parser = gateway::GatewayPortSignalParser::default();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let output = String::from_utf8_lossy(&line);
                    if let Some(port) = port_parser.push(&output)
                        && let Some(sender) = port_sender.take()
                    {
                        let _ = sender.send(port);
                    }
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
                            record_sidecar_stderr(&stderr_tail_events, output);
                            log::warn!(target: "cybara::sidecar", "{output}");
                        }
                    }
                }
                CommandEvent::Error(message) => {
                    record_sidecar_stderr(&stderr_tail_events, &message);
                    log::warn!(target: "cybara::sidecar", "{message}");
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(
                        "Cybara gateway sidecar terminated with code {:?}",
                        payload.code
                    );
                    if clear_terminated_sidecar(&output_app, generation) {
                        let base = match payload.code {
                            Some(code) => format!("Gateway exited with code {code}."),
                            None => "Gateway exited unexpectedly.".into(),
                        };
                        schedule_sidecar_restart(
                            output_app.clone(),
                            sidecar_failure_reason(base, &stderr_tail_events),
                        );
                    }
                    return;
                }
                _ => {}
            }
        }
        if clear_terminated_sidecar(&output_app, generation) {
            schedule_sidecar_restart(
                output_app,
                sidecar_failure_reason(
                    "Gateway process event stream closed unexpectedly.".into(),
                    &stderr_tail,
                ),
            );
        }
    });

    std::thread::spawn(move || {
        let port = match port_receiver.recv_timeout(Duration::from_secs(10)) {
            Ok(port) => port,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                stop_sidecar_generation(&app, generation);
                schedule_sidecar_restart(
                    app,
                    "Gateway did not report its listening port within 10 seconds.".into(),
                );
                return;
            }
        };
        let endpoint = gateway::GatewayEndpoint::loopback(port);
        set_gateway_endpoint(&app, endpoint.clone());
        log::info!("Cybara gateway sidecar is listening on port {port}");
        if wait_for_server_ready(
            &endpoint,
            env!("CARGO_PKG_VERSION"),
            Duration::from_secs(25),
        ) {
            record_gateway_healthy(&app);
            set_gateway_startup_status(&app, GatewayStartupStatus::ready());
            navigate_after_ready(&app);
        } else {
            stop_sidecar_generation(&app, generation);
            schedule_sidecar_restart(
                app,
                "Gateway did not become ready within 25 seconds.".into(),
            );
        }
    });
}

fn start_gateway_watchdog(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(3));
            let shutting_down = app
                .try_state::<GatewaySupervisionState>()
                .and_then(|state| state.0.lock().ok().map(|guard| guard.is_shutting_down()))
                .unwrap_or(true);
            if shutting_down {
                return;
            }
            let ready = app
                .try_state::<GatewayStartupState>()
                .and_then(|state| state.0.lock().ok().map(|guard| guard.phase == "ready"))
                .unwrap_or(false);
            if !ready {
                continue;
            }
            let endpoint = gateway_endpoint(&app);
            let healthy = gateway::is_gateway_live_at(&endpoint.addr);
            let should_restart = app
                .try_state::<GatewaySupervisionState>()
                .and_then(|state| {
                    state.0.lock().ok().map(|mut guard| {
                        if healthy {
                            guard.record_healthy();
                            false
                        } else {
                            guard.record_unhealthy()
                        }
                    })
                })
                .unwrap_or(false);
            if should_restart {
                stop_sidecar(&app);
                schedule_sidecar_restart(
                    app.clone(),
                    "Gateway liveness probe failed repeatedly.".into(),
                );
            }
        }
    });
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
            get_gateway_url,
            get_gateway_startup_status,
            restart_gateway_sidecar,
            start_native_recording,
            stop_native_recording,
            write_theme_file,
            desktop_update::get_desktop_update_state,
            desktop_update::check_desktop_update,
            desktop_update::install_desktop_update
        ])
        .setup(|app| {
            app.manage(SidecarState(std::sync::Mutex::new(
                ManagedSidecar::default(),
            )));
            app.manage(GatewaySupervisionState(std::sync::Mutex::new(
                gateway_supervision::GatewaySupervision::default(),
            )));
            app.manage(PendingOpen(std::sync::Mutex::new(None)));
            app.manage(GatewayStartupState(std::sync::Mutex::new(
                GatewayStartupStatus::starting(),
            )));
            app.manage(GatewayRuntimeState(std::sync::Mutex::new(
                gateway::GatewayEndpoint::loopback(CYBARA_DEFAULT_PORT),
            )));
            app.manage(desktop_update::DesktopUpdateManager::default());
            tray::setup(app)?;

            if let Some(path) = file_path_from_args(&std::env::args().collect::<Vec<_>>()) {
                set_pending_open(app.handle(), path);
            }

            start_gateway_watchdog(app.handle().clone());
            start_sidecar(app.handle().clone());

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
        RunEvent::ExitRequested { .. } | RunEvent::Exit => shutdown_sidecar(app_handle),
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

#[derive(Default)]
struct ManagedSidecar {
    child: Option<tauri_plugin_shell::process::CommandChild>,
    generation: u64,
    launching: bool,
}

struct SidecarState(std::sync::Mutex<ManagedSidecar>);

struct GatewaySupervisionState(std::sync::Mutex<gateway_supervision::GatewaySupervision>);

struct PendingOpen(std::sync::Mutex<Option<String>>);

struct GatewayStartupState(std::sync::Mutex<GatewayStartupStatus>);

struct GatewayRuntimeState(std::sync::Mutex<gateway::GatewayEndpoint>);

#[cfg(test)]
mod tests {
    use super::{gateway_url_for_location, write_theme_file};

    #[test]
    fn theme_export_writes_valid_json_to_theme_file() {
        let root = std::env::temp_dir().join(format!("cybara-theme-export-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create theme export root");
        let path = root.join("studio.cybara-theme.json");
        write_theme_file(
            path.to_string_lossy().into_owned(),
            "{\"version\":1}".into(),
        )
        .expect("write theme export");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read theme export"),
            "{\"version\":1}"
        );
        std::fs::remove_dir_all(root).expect("remove theme export root");
    }

    #[test]
    fn theme_export_rejects_wrong_extension_and_invalid_json() {
        let root = std::env::temp_dir();
        assert!(
            write_theme_file(
                root.join("studio.json").to_string_lossy().into_owned(),
                "{\"version\":1}".into()
            )
            .is_err()
        );
        assert!(
            write_theme_file(
                root.join("studio.cybara-theme.json")
                    .to_string_lossy()
                    .into_owned(),
                "not-json".into()
            )
            .is_err()
        );
    }

    #[test]
    fn recovered_gateway_preserves_the_active_route() {
        let current =
            tauri::Url::parse("http://127.0.0.1:4271/chat?session=active-session#activity")
                .expect("parse current URL");
        let recovered = gateway_url_for_location("http://127.0.0.1:4272", &current)
            .expect("build recovered URL");
        assert_eq!(
            recovered.as_str(),
            "http://127.0.0.1:4272/chat?session=active-session#activity"
        );
    }

    #[test]
    fn initial_asset_url_opens_the_gateway_root() {
        let current = tauri::Url::parse("tauri://localhost/index.html").expect("parse asset URL");
        let recovered =
            gateway_url_for_location("http://127.0.0.1:4269", &current).expect("build initial URL");
        assert_eq!(recovered.as_str(), "http://127.0.0.1:4269/");
    }
}
