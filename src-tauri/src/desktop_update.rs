use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateSnapshot {
    pub phase: String,
    pub version: Option<String>,
    pub current_version: Option<String>,
    pub body: Option<String>,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub last_checked_at_ms: Option<u64>,
    pub error: Option<String>,
}

impl Default for DesktopUpdateSnapshot {
    fn default() -> Self {
        Self {
            phase: "idle".to_string(),
            version: None,
            current_version: None,
            body: None,
            progress: 0.0,
            downloaded_bytes: 0,
            total_bytes: None,
            last_checked_at_ms: None,
            error: None,
        }
    }
}

pub struct DesktopUpdateManager {
    operation: tauri::async_runtime::Mutex<()>,
    pending: Mutex<Option<Update>>,
    snapshot: Mutex<DesktopUpdateSnapshot>,
}

impl Default for DesktopUpdateManager {
    fn default() -> Self {
        Self {
            operation: tauri::async_runtime::Mutex::new(()),
            pending: Mutex::new(None),
            snapshot: Mutex::new(DesktopUpdateSnapshot::default()),
        }
    }
}

fn checked_at_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn current_snapshot(app: &AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    app.state::<DesktopUpdateManager>()
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|error| error.to_string())
}

fn replace_snapshot(
    app: &AppHandle,
    snapshot: DesktopUpdateSnapshot,
) -> Result<DesktopUpdateSnapshot, String> {
    {
        let manager = app.state::<DesktopUpdateManager>();
        let mut stored = manager.snapshot.lock().map_err(|error| error.to_string())?;
        *stored = snapshot.clone();
    }
    let display_app = app.clone();
    let display_snapshot = snapshot.clone();
    app.run_on_main_thread(move || {
        crate::tray::apply_update_state(&display_app, &display_snapshot);
    })
    .map_err(|error| error.to_string())?;
    let _ = app.emit("cybara://update-state", &snapshot);
    Ok(snapshot)
}

fn mutate_snapshot(
    app: &AppHandle,
    mutate: impl FnOnce(&mut DesktopUpdateSnapshot),
) -> Result<DesktopUpdateSnapshot, String> {
    let snapshot = {
        let manager = app.state::<DesktopUpdateManager>();
        let mut stored = manager.snapshot.lock().map_err(|error| error.to_string())?;
        mutate(&mut stored);
        stored.clone()
    };
    let display_app = app.clone();
    let display_snapshot = snapshot.clone();
    app.run_on_main_thread(move || {
        crate::tray::apply_update_state(&display_app, &display_snapshot);
    })
    .map_err(|error| error.to_string())?;
    let _ = app.emit("cybara://update-state", &snapshot);
    Ok(snapshot)
}

async fn check_locked(app: &AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    mutate_snapshot(app, |snapshot| {
        snapshot.phase = "checking".to_string();
        snapshot.error = None;
    })?;

    let result = match app.updater() {
        Ok(updater) => updater.check().await.map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    let manager = app.state::<DesktopUpdateManager>();

    match result {
        Ok(Some(update)) => {
            let snapshot = DesktopUpdateSnapshot {
                phase: "available".to_string(),
                version: Some(update.version.clone()),
                current_version: Some(update.current_version.clone()),
                body: update.body.clone(),
                progress: 0.0,
                downloaded_bytes: 0,
                total_bytes: None,
                last_checked_at_ms: Some(checked_at_ms()),
                error: None,
            };
            *manager.pending.lock().map_err(|error| error.to_string())? = Some(update);
            log::info!(
                "Desktop update available: {}",
                snapshot.version.as_deref().unwrap_or("unknown")
            );
            replace_snapshot(app, snapshot)
        }
        Ok(None) => {
            *manager.pending.lock().map_err(|error| error.to_string())? = None;
            log::debug!("Desktop app is current");
            replace_snapshot(
                app,
                DesktopUpdateSnapshot {
                    phase: "current".to_string(),
                    last_checked_at_ms: Some(checked_at_ms()),
                    ..DesktopUpdateSnapshot::default()
                },
            )
        }
        Err(error) => {
            log::warn!("Desktop update check failed: {error}");
            let has_pending = manager
                .pending
                .lock()
                .map_err(|lock_error| lock_error.to_string())?
                .is_some();
            mutate_snapshot(app, |snapshot| {
                snapshot.phase = if has_pending { "available" } else { "error" }.to_string();
                snapshot.last_checked_at_ms = Some(checked_at_ms());
                snapshot.error = Some(error.clone());
            })
        }
    }
}

pub async fn check(app: AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    let manager = app.state::<DesktopUpdateManager>();
    let _operation = manager.operation.lock().await;
    check_locked(&app).await
}

pub async fn install(app: AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    let manager = app.state::<DesktopUpdateManager>();
    let _operation = manager.operation.lock().await;
    let mut update = manager
        .pending
        .lock()
        .map_err(|error| error.to_string())?
        .clone();

    if update.is_none() {
        check_locked(&app).await?;
        update = manager
            .pending
            .lock()
            .map_err(|error| error.to_string())?
            .clone();
    }

    let update = update.ok_or_else(|| "No desktop update is available".to_string())?;
    mutate_snapshot(&app, |snapshot| {
        snapshot.phase = "downloading".to_string();
        snapshot.progress = 0.0;
        snapshot.downloaded_bytes = 0;
        snapshot.total_bytes = None;
        snapshot.error = None;
    })?;

    let progress_app = app.clone();
    let install_app = app.clone();
    let mut downloaded = 0_u64;
    let mut last_percent = 0_u64;
    let mut last_publish = Instant::now();
    let result = update
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let percent = content_length
                    .filter(|total| *total > 0)
                    .map(|total| downloaded.saturating_mul(100) / total)
                    .unwrap_or(0);
                if percent > last_percent || last_publish.elapsed() >= Duration::from_millis(500) {
                    last_percent = percent;
                    last_publish = Instant::now();
                    let _ = mutate_snapshot(&progress_app, |snapshot| {
                        snapshot.downloaded_bytes = downloaded;
                        snapshot.total_bytes = content_length;
                        snapshot.progress = content_length
                            .filter(|total| *total > 0)
                            .map(|total| (downloaded as f64 / total as f64).clamp(0.0, 1.0))
                            .unwrap_or(0.0);
                    });
                }
            },
            move || {
                let _ = mutate_snapshot(&install_app, |snapshot| {
                    snapshot.phase = "installing".to_string();
                    snapshot.progress = 1.0;
                });
            },
        )
        .await;

    match result {
        Ok(()) => {
            mutate_snapshot(&app, |snapshot| {
                snapshot.phase = "done".to_string();
                snapshot.progress = 1.0;
                snapshot.error = None;
            })?;
            std::thread::sleep(Duration::from_millis(750));
            app.restart();
        }
        Err(error) => {
            let message = error.to_string();
            log::error!("Desktop update install failed: {message}");
            mutate_snapshot(&app, |snapshot| {
                snapshot.phase = "available".to_string();
                snapshot.error = Some(message.clone());
            })?;
            Err(message)
        }
    }
}

pub fn spawn_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = check(app).await {
            log::warn!("Desktop update check failed: {error}");
        }
    });
}

pub fn spawn_install(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = install(app).await {
            log::error!("Desktop update install failed: {error}");
        }
    });
}

#[tauri::command]
pub async fn get_desktop_update_state(app: AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    current_snapshot(&app)
}

#[tauri::command]
pub async fn check_desktop_update(app: AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    check(app).await
}

#[tauri::command]
pub async fn install_desktop_update(app: AppHandle) -> Result<DesktopUpdateSnapshot, String> {
    install(app).await
}
