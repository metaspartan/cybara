use serde::Deserialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Manager};

use crate::cybara_api_key;
use crate::desktop_update::DesktopUpdateSnapshot;

pub struct UpdateMenu(pub std::sync::Mutex<MenuItem<tauri::Wry>>);

const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(300);
const UPDATE_FIRST_CHECK_DELAY: Duration = Duration::from_secs(1);

fn macos_template_icon(source: &tauri::image::Image) -> tauri::image::Image<'static> {
    let mut rgba = source.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        let source_alpha = pixel[3] as f32 / 255.0;
        let luminance =
            (pixel[0] as f32 * 0.2126 + pixel[1] as f32 * 0.7152 + pixel[2] as f32 * 0.0722)
                / 255.0;
        let detail_alpha = ((luminance - 0.18) / 0.24).clamp(0.0, 1.0);
        pixel[0] = 0;
        pixel[1] = 0;
        pixel[2] = 0;
        pixel[3] = (source_alpha * detail_alpha * 255.0).round() as u8;
    }
    tauri::image::Image::new_owned(rgba, source.width(), source.height())
}

fn tray_image(source: &tauri::image::Image, badged: bool) -> tauri::image::Image<'static> {
    let base = if badged {
        crate::badge_icon(source)
    } else {
        tauri::image::Image::new_owned(source.rgba().to_vec(), source.width(), source.height())
    };
    if cfg!(target_os = "macos") {
        macos_template_icon(&base)
    } else {
        base
    }
}

fn update_menu_text(snapshot: &DesktopUpdateSnapshot) -> String {
    match snapshot.phase.as_str() {
        "checking" => "Checking for updates…".to_string(),
        "downloading" => {
            if snapshot.progress > 0.0 {
                format!(
                    "Downloading update · {}%",
                    (snapshot.progress * 100.0).round() as u32
                )
            } else {
                "Downloading update…".to_string()
            }
        }
        "installing" => "Installing update…".to_string(),
        "done" => "Update installed · restarting…".to_string(),
        "error" => "Update check failed · Open Cybara".to_string(),
        "available" if snapshot.error.is_some() => "Update failed · Retry".to_string(),
        "available" => match &snapshot.version {
            Some(value) => format!("Install Update {value}"),
            None => "Install Update".to_string(),
        },
        _ => "No updates available".to_string(),
    }
}

fn update_tooltip_text(snapshot: &DesktopUpdateSnapshot) -> String {
    match snapshot.phase.as_str() {
        "checking" => "Cybara · Checking for updates…".to_string(),
        "downloading" => format!(
            "Cybara · Downloading update · {}%",
            (snapshot.progress * 100.0).round() as u32
        ),
        "installing" => "Cybara · Installing update…".to_string(),
        "done" => "Cybara · Restarting to finish update".to_string(),
        "error" => "Cybara · Update check unavailable".to_string(),
        "available" if snapshot.error.is_some() => {
            "Cybara · Update failed · Retry available".to_string()
        }
        "available" => match &snapshot.version {
            Some(value) => format!("Cybara · Update {value} available"),
            None => "Cybara · Update available".to_string(),
        },
        _ => "Cybara".to_string(),
    }
}

pub fn apply_update_state(app: &AppHandle, snapshot: &DesktopUpdateSnapshot) {
    let busy = matches!(
        snapshot.phase.as_str(),
        "downloading" | "installing" | "done"
    );
    let available = snapshot.phase == "available";
    if let Some(state) = app.try_state::<UpdateMenu>()
        && let Ok(item) = state.0.lock()
    {
        let _ = item.set_text(update_menu_text(snapshot));
        let _ = item.set_enabled(available && !busy);
    }
    if let Some(tray) = app.tray_by_id("cybara-tray") {
        let _ = tray.set_tooltip(Some(update_tooltip_text(snapshot)));
        if let Some(base) = app.default_window_icon() {
            let _ = tray.set_icon(Some(tray_image(base, available || busy)));
            let _ = tray.set_icon_as_template(cfg!(target_os = "macos"));
        }
    }
}

fn start_update_check(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(UPDATE_FIRST_CHECK_DELAY);
        loop {
            crate::desktop_update::spawn_check(handle.clone());
            std::thread::sleep(UPDATE_CHECK_INTERVAL);
        }
    });
}

const USAGE_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const USAGE_RETRY_INTERVAL: Duration = Duration::from_secs(10);
const USAGE_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderUsageResponse {
    #[serde(default)]
    providers: Vec<ProviderUsagePlan>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderUsagePlan {
    #[serde(alias = "provider_name")]
    provider_name: String,
    #[serde(default, alias = "managed_automatically")]
    managed_automatically: bool,
    #[serde(default)]
    monitored: bool,
    #[serde(default, alias = "external_source_available")]
    external_source_available: bool,
    #[serde(default)]
    windows: Vec<ProviderUsageWindow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderUsageWindow {
    kind: String,
    #[serde(default, alias = "usage_known")]
    usage_known: bool,
    #[serde(default)]
    unlimited: bool,
    #[serde(alias = "used_percent")]
    used_percent: Option<f64>,
    #[serde(default, alias = "reset_description")]
    reset_description: String,
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_route(app: &AppHandle, route: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let endpoint = crate::gateway_endpoint(app);
        if let Ok(url) = format!("{}{route}", endpoint.url).parse() {
            let _ = window.navigate(url);
        }
    }
    show_main_window(app);
}

fn read_http_body(
    endpoint: &crate::gateway::GatewayEndpoint,
    path: &str,
) -> Result<String, String> {
    let mut stream = TcpStream::connect(&endpoint.addr).map_err(|error| error.to_string())?;
    let _ = stream.set_read_timeout(Some(USAGE_REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(USAGE_REQUEST_TIMEOUT));
    let authorization = cybara_api_key()
        .ok()
        .flatten()
        .map(|key| format!("Authorization: Bearer {key}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\n{authorization}Connection: close\r\n\r\n",
        endpoint.addr
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "gateway returned an invalid response".to_string())?;
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err("gateway usage request failed".to_string());
    }
    Ok(body.to_string())
}

fn usage_window_text(plan: &ProviderUsagePlan, kind: &str) -> String {
    let Some(window) = plan
        .windows
        .iter()
        .find(|window| window.kind == kind && window.usage_known)
    else {
        return "--".to_string();
    };
    if window.unlimited {
        return "∞".to_string();
    }
    let Some(percent) = window.used_percent else {
        return "--".to_string();
    };
    format!("{}%", percent.clamp(0.0, 100.0).ceil() as u32)
}

fn meaningful_reset(description: &str) -> bool {
    !description.is_empty()
        && !description.starts_with("Rolling")
        && !description.eq_ignore_ascii_case("No limit")
}

fn usage_reset_text(plan: &ProviderUsagePlan) -> Option<String> {
    plan.windows
        .iter()
        .find(|window| {
            window.kind == "rolling_5h"
                && window.usage_known
                && !window.unlimited
                && meaningful_reset(&window.reset_description)
        })
        .or_else(|| {
            plan.windows.iter().find(|window| {
                window.kind == "rolling_week"
                    && window.usage_known
                    && !window.unlimited
                    && meaningful_reset(&window.reset_description)
            })
        })
        .map(|window| window.reset_description.clone())
}

fn truncate_label(value: &str, limit: usize) -> String {
    let mut characters = value.chars();
    let prefix: String = characters.by_ref().take(limit).collect();
    if characters.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn provider_usage_rows(endpoint: &crate::gateway::GatewayEndpoint) -> Result<Vec<String>, String> {
    let body = read_http_body(endpoint, "/api/provider-plans/status")?;
    let response: ProviderUsageResponse =
        serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let mut plans: Vec<_> = response
        .providers
        .into_iter()
        .filter(|plan| {
            plan.managed_automatically
                && (plan.monitored || plan.external_source_available || !plan.windows.is_empty())
        })
        .collect();
    plans.sort_by(|left, right| {
        left.provider_name
            .to_lowercase()
            .cmp(&right.provider_name.to_lowercase())
    });
    Ok(plans
        .iter()
        .map(|plan| {
            let provider = truncate_label(&plan.provider_name, 15);
            let five_hour = usage_window_text(plan, "rolling_5h");
            let weekly = usage_window_text(plan, "rolling_week");
            let reset = usage_reset_text(plan)
                .map(|value| format!("   ↻ {}", truncate_label(&value, 22)))
                .unwrap_or_default();
            format!("{provider}   5h {five_hour} · 7d {weekly}{reset}")
        })
        .collect())
}

fn rebuild_usage_menu(
    app: &AppHandle,
    usage_menu: &Submenu<tauri::Wry>,
    rows: Result<Vec<String>, String>,
) -> tauri::Result<()> {
    for item in usage_menu.items()? {
        usage_menu.remove(&item)?;
    }
    match rows {
        Ok(rows) if !rows.is_empty() => {
            for (index, row) in rows.iter().enumerate() {
                let item = MenuItem::with_id(
                    app,
                    format!("usage-provider-{index}"),
                    row,
                    false,
                    None::<&str>,
                )?;
                usage_menu.append(&item)?;
            }
        }
        Ok(_) => {
            usage_menu.append(&MenuItem::with_id(
                app,
                "usage-empty",
                "No automatic usage available",
                false,
                None::<&str>,
            )?)?;
        }
        Err(_) => {
            usage_menu.append(&MenuItem::with_id(
                app,
                "usage-unavailable",
                "Usage temporarily unavailable",
                false,
                None::<&str>,
            )?)?;
        }
    }
    usage_menu.append(&PredefinedMenuItem::separator(app)?)?;
    usage_menu.append(&MenuItem::with_id(
        app,
        "open-usage",
        "Open Usage",
        true,
        None::<&str>,
    )?)?;
    Ok(())
}

fn start_usage_refresh(app: &AppHandle, usage_menu: Submenu<tauri::Wry>) {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        loop {
            let endpoint = crate::gateway_endpoint(&app_handle);
            let rows = provider_usage_rows(&endpoint);
            let delay = if rows.is_ok() {
                USAGE_REFRESH_INTERVAL
            } else {
                USAGE_RETRY_INTERVAL
            };
            let menu = usage_menu.clone();
            let handle = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                let _ = rebuild_usage_menu(&handle, &menu, rows);
            });
            std::thread::sleep(delay);
        }
    });
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Cybara", true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, "new-chat", "New Chat", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let gateway = MenuItem::with_id(
        app,
        "gateway-status",
        "Gateway · Starting",
        false,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(
        app,
        "install-update",
        "Checking for updates…",
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Cybara", true, None::<&str>)?;
    let usage_menu = Submenu::with_id(app, "usage", "Usage", true)?;
    usage_menu.append(&MenuItem::with_id(
        app,
        "usage-loading",
        "Loading usage…",
        false,
        None::<&str>,
    )?)?;
    usage_menu.append(&PredefinedMenuItem::separator(app)?)?;
    usage_menu.append(&MenuItem::with_id(
        app,
        "open-usage",
        "Open Usage",
        true,
        None::<&str>,
    )?)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &new_chat,
            &PredefinedMenuItem::separator(app)?,
            &usage_menu,
            &gateway,
            &update,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let window_icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("Cybara tray icon".to_string()))?;
    let icon = tray_image(&window_icon, false);
    let gateway_item = gateway.clone();
    TrayIconBuilder::with_id("cybara-tray")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Cybara")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "new-chat" => show_route(app, "/chat?fresh=1"),
            "open-usage" => show_route(app, "/usage"),
            "settings" => show_route(app, "/settings"),
            "install-update" => {
                show_main_window(app);
                crate::desktop_update::spawn_install(app.clone());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    app.manage(UpdateMenu(std::sync::Mutex::new(update.clone())));
    start_update_check(app.handle());
    let app_handle = app.handle().clone();
    std::thread::spawn(move || {
        loop {
            let endpoint = crate::gateway_endpoint(&app_handle);
            let label = if crate::gateway::is_compatible_gateway_at(
                &endpoint.addr,
                env!("CARGO_PKG_VERSION"),
            ) {
                "Gateway · Connected"
            } else {
                "Gateway · Offline"
            };
            let item = gateway_item.clone();
            let _ = app_handle.run_on_main_thread(move || {
                let _ = item.set_text(label);
            });
            std::thread::sleep(Duration::from_secs(10));
        }
    });
    start_usage_refresh(app.handle(), usage_menu);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ProviderUsagePlan, ProviderUsageWindow, macos_template_icon, truncate_label,
        update_menu_text, usage_reset_text, usage_window_text,
    };
    use crate::desktop_update::DesktopUpdateSnapshot;

    fn plan(window: ProviderUsageWindow) -> ProviderUsagePlan {
        ProviderUsagePlan {
            provider_name: "Provider".to_string(),
            managed_automatically: true,
            monitored: true,
            external_source_available: true,
            windows: vec![window],
        }
    }

    #[test]
    fn update_menu_reports_busy_phases() {
        let snapshot = |phase: &str, progress: f64| DesktopUpdateSnapshot {
            phase: phase.to_string(),
            version: Some("1.2.3".to_string()),
            progress,
            ..DesktopUpdateSnapshot::default()
        };
        assert_eq!(
            update_menu_text(&snapshot("downloading", 0.42)),
            "Downloading update · 42%"
        );
        assert_eq!(
            update_menu_text(&snapshot("installing", 1.0)),
            "Installing update…"
        );
        assert_eq!(
            update_menu_text(&snapshot("checking", 0.0)),
            "Checking for updates…"
        );
        assert_eq!(
            update_menu_text(&snapshot("error", 0.0)),
            "Update check failed · Open Cybara"
        );
    }

    #[test]
    fn update_menu_keeps_retryable_failures_actionable() {
        let failed = DesktopUpdateSnapshot {
            phase: "available".to_string(),
            version: Some("1.2.3".to_string()),
            error: Some("download failed".to_string()),
            ..DesktopUpdateSnapshot::default()
        };
        assert_eq!(update_menu_text(&failed), "Update failed · Retry");
    }

    #[test]
    fn macos_template_icon_uses_transparency_for_dark_character_detail() {
        let source = tauri::image::Image::new_owned(
            vec![240, 180, 80, 255, 24, 20, 18, 255, 0, 0, 0, 0],
            3,
            1,
        );
        let template = macos_template_icon(&source);
        assert_eq!(&template.rgba()[0..3], &[0, 0, 0]);
        assert!(template.rgba()[3] > template.rgba()[7]);
        assert_eq!(template.rgba()[3], 255);
        assert_eq!(template.rgba()[7], 0);
        assert_eq!(template.rgba()[11], 0);
    }

    #[test]
    fn usage_percent_is_bounded_and_rounded_up() {
        let value = usage_window_text(
            &plan(ProviderUsageWindow {
                kind: "rolling_5h".to_string(),
                usage_known: true,
                unlimited: false,
                used_percent: Some(61.01),
                reset_description: String::new(),
            }),
            "rolling_5h",
        );
        assert_eq!(value, "62%");
    }

    #[test]
    fn unlimited_usage_uses_infinity() {
        let value = usage_window_text(
            &plan(ProviderUsageWindow {
                kind: "rolling_week".to_string(),
                usage_known: true,
                unlimited: true,
                used_percent: None,
                reset_description: String::new(),
            }),
            "rolling_week",
        );
        assert_eq!(value, "∞");
    }

    #[test]
    fn reset_text_skips_unlimited_windows() {
        let plan = ProviderUsagePlan {
            provider_name: "Codex".to_string(),
            managed_automatically: true,
            monitored: true,
            external_source_available: true,
            windows: vec![
                ProviderUsageWindow {
                    kind: "rolling_5h".to_string(),
                    usage_known: true,
                    unlimited: true,
                    used_percent: Some(0.0),
                    reset_description: "No limit".to_string(),
                },
                ProviderUsageWindow {
                    kind: "rolling_week".to_string(),
                    usage_known: true,
                    unlimited: false,
                    used_percent: Some(22.0),
                    reset_description: "resets in 6d 14h".to_string(),
                },
            ],
        };

        assert_eq!(usage_reset_text(&plan).as_deref(), Some("resets in 6d 14h"));
    }

    #[test]
    fn labels_are_unicode_safe() {
        assert_eq!(truncate_label("MiniMax Provider", 7), "MiniMax…");
        assert_eq!(truncate_label("短い名前", 8), "短い名前");
    }
}
