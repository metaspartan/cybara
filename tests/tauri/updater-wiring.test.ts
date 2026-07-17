import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  isValidTauriUpdaterPublicKey,
  TAURI_DEVELOPMENT_UPDATER_PUBLIC_KEY,
} from "../../src/core/versioning";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("desktop updater wiring", () => {
  test("desktop settings page exposes updater controls and release link support", () => {
    const settingsPath = join(ROOT_DIR, "ui", "src", "pages", "Settings.tsx");
    const settingsTsx = readFileSync(settingsPath, "utf8");
    const updateSettingsPath = join(
      ROOT_DIR,
      "ui",
      "src",
      "pages",
      "settings",
      "DesktopUpdateSettings.tsx"
    );
    const updateSettingsTsx = readFileSync(updateSettingsPath, "utf8");

    expect(settingsTsx).toContain("DesktopUpdateSettings");
    expect(updateSettingsTsx).toContain("Updates");
    expect(updateSettingsTsx).toContain("checkForUpdate");
    expect(updateSettingsTsx).toContain("startUpdateInstall");
    expect(updateSettingsTsx).toContain("useDesktopUpdate");
    expect(updateSettingsTsx).toContain("releaseRepositoryUrl");
  });

  test("tauri runtime enables updater/process plugins and permissions", () => {
    const cargoToml = readFileSync(join(ROOT_DIR, "src-tauri", "Cargo.toml"), "utf8");
    const mainRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "main.rs"), "utf8");
    const capabilityJson = readFileSync(
      join(ROOT_DIR, "src-tauri", "capabilities", "default.json"),
      "utf8"
    );
    const tauriConfig = readFileSync(join(ROOT_DIR, "src-tauri", "tauri.conf.json"), "utf8");
    const infoPlist = readFileSync(join(ROOT_DIR, "src-tauri", "Info.plist"), "utf8");
    const entitlements = readFileSync(join(ROOT_DIR, "src-tauri", "entitlements.plist"), "utf8");

    expect(cargoToml).toContain('tauri-plugin-updater = "2"');
    expect(cargoToml).toContain('tauri-plugin-process = "2"');
    expect(cargoToml).toContain('tauri-plugin-log = "2"');
    expect(cargoToml).toContain('tauri-plugin-window-state = "2"');
    expect(mainRs).toContain("tauri_plugin_updater::Builder::new().build()");
    expect(mainRs).toContain("tauri_plugin_process::init()");
    expect(mainRs).toContain("tauri_plugin_log::Builder::new()");
    expect(mainRs).toContain('target: "cybara::browser"');
    expect(mainRs).toContain("tauri_plugin_window_state::Builder::default().build()");
    expect(capabilityJson).toContain('"updater:default"');
    expect(capabilityJson).toContain('"process:default"');
    expect(tauriConfig).toContain('"updater"');
    expect(tauriConfig).toContain('"endpoints": []');
    expect(tauriConfig).not.toContain("placeholder");
    expect(tauriConfig).toContain(TAURI_DEVELOPMENT_UPDATER_PUBLIC_KEY);
    expect(isValidTauriUpdaterPublicKey(TAURI_DEVELOPMENT_UPDATER_PUBLIC_KEY)).toBe(true);
    expect(infoPlist).toContain("NSMicrophoneUsageDescription");
    expect(entitlements).toContain("com.apple.security.device.audio-input");
  });

  test("tray and frontend share the Rust-owned updater state machine", () => {
    const trayRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "tray.rs"), "utf8");
    const mainRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "main.rs"), "utf8");
    const updaterRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "desktop_update.rs"), "utf8");
    const authGateTsx = readFileSync(
      join(ROOT_DIR, "ui", "src", "components", "GatewayAuthGate.tsx"),
      "utf8"
    );
    const updateStore = readFileSync(join(ROOT_DIR, "ui", "src", "lib", "updateStore.ts"), "utf8");

    expect(trayRs).toContain("crate::desktop_update::spawn_install(app.clone())");
    expect(trayRs).toContain('"Checking for updates…"');
    expect(trayRs).toContain('"Update failed · Retry"');
    expect(updaterRs).toContain('app.emit("cybara://update-state", &snapshot)');
    expect(updaterRs).toContain("download_and_install(");
    expect(updaterRs).toContain('snapshot.phase = "downloading".to_string()');
    expect(updaterRs).toContain('snapshot.phase = "installing".to_string()');
    expect(updaterRs).toContain('snapshot.phase = "available".to_string()');
    expect(authGateTsx).toContain("ensureUpdatePolling()");
    expect(updateStore).toContain("listenForDesktopUpdateState");
    expect(updateStore).toContain("Click to install and restart Cybara");
    expect(updateStore).toContain("notification.onclick = () =>");
    expect(updateStore).toContain("void startUpdateInstall()");
    expect(mainRs).toContain("desktop_update::install_desktop_update");
    expect(mainRs).toContain("DesktopUpdateManager::default()");
    expect(trayRs).toContain("macos_template_icon");
  });

  test("release workflow prepares updater config and passes the release tag", () => {
    const workflowPath = join(ROOT_DIR, ".github", "workflows", "release.yml");
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("bun run tauri:prepare-release");
    expect(workflow).toContain("includeUpdaterJson: false");
    expect(workflow).toContain("bun run scripts/publish-tauri-updater-manifest.ts");
    expect(workflow).toContain(
      "bun run scripts/verify-tauri-updater-manifest.ts release-check/latest.json"
    );
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    expect(workflow).toContain("tagName: ${{ github.ref_name }}");
    expect(workflow).toContain("--config src-tauri/tauri.release.conf.json");
    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toContain("CYBARA_TAURI_UPDATER_PUBKEY");
    expect(workflow).toContain("publish-release:");
    expect(workflow).not.toContain("universal-apple-darwin");
  });

  test("release workflow builds platform Tauri apps as best-effort release artifacts", () => {
    const workflowPath = join(ROOT_DIR, ".github", "workflows", "release.yml");
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("build-tauri:");
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("aarch64-apple-darwin");
    expect(workflow).toContain("x86_64-pc-windows-msvc");
    expect(workflow).toContain("x86_64-unknown-linux-gnu");
    expect(workflow).toContain("tauri-apps/tauri-action@");
    expect(workflow).toContain("HAS_MACOS_SIGNING");
    expect(workflow).toContain("Build Tauri App (unsigned/no Apple signing)");
    expect(workflow).toContain("matrix.platform != 'macos' || env.HAS_MACOS_SIGNING != 'true'");
    expect(workflow).toContain("Build Tauri App (signed and notarized macOS)");
    expect(workflow).toContain("id: build_tauri_notarized_macos");
    expect(workflow).toContain("steps.build_tauri_notarized_macos.outcome == 'failure'");
    expect(workflow).toContain("name: Reset macOS disk image state");
    expect(workflow).toContain("pkill -9 diskimages-helper || true");
    expect(workflow).toContain("name: Retry Tauri App (signed and notarized macOS)");
  });
});
