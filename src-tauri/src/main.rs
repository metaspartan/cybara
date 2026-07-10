// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri::RunEvent;
use tauri_plugin_shell::ShellExt;

const CYBARA_SERVER_ADDR: &str = "127.0.0.1:4269";
const CYBARA_SERVER_URL: &str = "http://127.0.0.1:4269";
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_millis(750);

fn should_log_sidecar_output() -> bool {
    cfg!(debug_assertions)
        || matches!(
            std::env::var("CYBARA_TAURI_LOG_SIDECAR"),
            Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
        )
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

    (headers.starts_with("HTTP/1.1 200") || headers.starts_with("HTTP/1.0 200"))
        && (body.contains("\"status\":\"healthy\"") || body.contains("\"status\": \"healthy\""))
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

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![read_cybara_api_key])
        .setup(|app| {
            app.manage(SidecarState(std::sync::Mutex::new(None)));

            // Check if server is already running (e.g., started by beforeDevCommand)
            if is_server_running() {
                println!("[Cybara] Server already running on port 4269");
                log::info!("Attached to existing Cybara gateway on port 4269");

                // Navigate to the backend URL so relative /api/ paths work
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.navigate(CYBARA_SERVER_URL.parse().unwrap());
                }

                return Ok(());
            }

            // Spawn the Cybara backend sidecar (for production builds)
            println!("[Cybara] Starting sidecar...");
            log::info!("Starting Cybara gateway sidecar");
            let mut sidecar = app.shell().sidecar("cybara").unwrap();
            if let Ok(resource_dir) = app.path().resource_dir() {
                let resource_dir = resource_dir.to_string_lossy().to_string();
                let resource_dir = resource_dir
                    .strip_prefix(r"\\?\")
                    .map(|stripped| stripped.to_string())
                    .unwrap_or(resource_dir);
                sidecar = sidecar.env("CYBARA_RESOURCE_DIR", resource_dir);
            }
            let (mut rx, child) = sidecar
                .args(["start"])
                .spawn()
                .expect("Failed to spawn Cybara sidecar");

            // Log sidecar output
            let log_sidecar_output = should_log_sidecar_output();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let output = String::from_utf8_lossy(&line);
                            if is_browser_diagnostic_line(&output) {
                                log::info!(target: "cybara::browser", "{}", output.trim());
                            }
                            if log_sidecar_output {
                                println!("[Cybara] {}", output);
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            let output = String::from_utf8_lossy(&line);
                            if is_browser_diagnostic_line(&output) {
                                log::warn!(target: "cybara::browser", "{}", output.trim());
                            }
                            if log_sidecar_output {
                                eprintln!("[Cybara] {}", output);
                            }
                        }
                        CommandEvent::Terminated(payload) => {
                            println!("[Cybara] Sidecar terminated with code: {:?}", payload.code);
                            log::warn!("Cybara gateway sidecar terminated with code {:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Store the child process so we can kill it on exit
            if let Some(state) = app.try_state::<SidecarState>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(child);
                }
            }

            // Wait for server readiness before navigating.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if wait_for_server_ready(Duration::from_secs(25)) {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.navigate(CYBARA_SERVER_URL.parse().unwrap());
                    }
                } else {
                    eprintln!("[Cybara] Sidecar did not become ready within timeout");
                    log::error!("Cybara gateway sidecar did not become ready within timeout");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                stop_sidecar(&window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Cybara");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_sidecar(app_handle);
        }
    });
}

// State to hold the sidecar child process (None if server was already running)
struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

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
}
