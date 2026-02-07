// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn is_server_running() -> bool {
    TcpStream::connect("127.0.0.1:4269").is_ok()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Check if server is already running (e.g., started by beforeDevCommand)
            if is_server_running() {
                println!("[Cybara] Server already running on port 4269");
                app.manage(SidecarState(std::sync::Mutex::new(None)));

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
                .args(["start"])
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
            app.manage(SidecarState(std::sync::Mutex::new(Some(child))));

            // Wait for the server to start, then navigate to it
            std::thread::sleep(std::time::Duration::from_millis(2000));

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.navigate("http://localhost:4269".parse().unwrap());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Kill the sidecar when window closes (only if we spawned it)
                if let Some(state) = window.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                            println!("[Cybara] Sidecar stopped");
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Cybara");
}

// State to hold the sidecar child process (None if server was already running)
struct SidecarState(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);
