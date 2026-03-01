// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri::RunEvent;
use tauri_plugin_shell::ShellExt;

fn is_server_running_at(addr: &str) -> bool {
    TcpStream::connect(addr).is_ok()
}

fn is_server_running() -> bool {
    is_server_running_at("127.0.0.1:4269")
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

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(SidecarState(std::sync::Mutex::new(None)));

            // Check if server is already running (e.g., started by beforeDevCommand)
            if is_server_running() {
                println!("[Cybara] Server already running on port 4269");

                // Navigate to the backend URL so relative /api/ paths work
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.navigate("http://localhost:4269".parse().unwrap());
                }

                return Ok(());
            }

            // Spawn the Cybara backend sidecar (for production builds)
            println!("[Cybara] Starting sidecar...");
            let sidecar = app.shell().sidecar("cybara").unwrap();
            let (mut rx, child) = sidecar
                // Enable terminal APIs for desktop-sidecar runs without passing flags to cargo.
                .args(["start", "--enable-terminal"])
                .spawn()
                .expect("Failed to spawn Cybara sidecar");

            // Log sidecar output
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let output = String::from_utf8_lossy(&line);
                            println!("[Cybara] {}", output);
                        }
                        CommandEvent::Stderr(line) => {
                            let output = String::from_utf8_lossy(&line);
                            eprintln!("[Cybara] {}", output);
                        }
                        CommandEvent::Terminated(payload) => {
                            println!("[Cybara] Sidecar terminated with code: {:?}", payload.code);
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
                        let _ = window.navigate("http://localhost:4269".parse().unwrap());
                    }
                } else {
                    eprintln!("[Cybara] Sidecar did not become ready within timeout");
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
    use std::net::TcpListener;

    #[test]
    fn server_check_is_false_for_closed_port() {
        assert!(!is_server_running_at("127.0.0.1:65534"));
    }

    #[test]
    fn server_check_is_true_when_listener_exists() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let addr = listener.local_addr().expect("read local addr");
        assert!(is_server_running_at(&addr.to_string()));
    }
}
