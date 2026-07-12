import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("desktop updater wiring", () => {
  test("desktop settings page exposes updater controls and release link support", () => {
    const settingsPath = join(ROOT_DIR, "ui", "src", "pages", "Settings.tsx");
    const settingsTsx = readFileSync(settingsPath, "utf8");

    expect(settingsTsx).toContain("Desktop Updates");
    expect(settingsTsx).toContain("checkForUpdate");
    expect(settingsTsx).toContain("startUpdateInstall");
    expect(settingsTsx).toContain("useDesktopUpdate");
    expect(settingsTsx).toContain("releaseRepositoryUrl");
  });

  test("tauri runtime enables updater/process plugins and permissions", () => {
    const cargoToml = readFileSync(join(ROOT_DIR, "src-tauri", "Cargo.toml"), "utf8");
    const mainRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "main.rs"), "utf8");
    const capabilityJson = readFileSync(
      join(ROOT_DIR, "src-tauri", "capabilities", "default.json"),
      "utf8"
    );
    const tauriConfig = readFileSync(join(ROOT_DIR, "src-tauri", "tauri.conf.json"), "utf8");

    expect(cargoToml).toContain('tauri-plugin-updater = "2"');
    expect(cargoToml).toContain('tauri-plugin-process = "2"');
    expect(cargoToml).toContain('tauri-plugin-log = "2"');
    expect(cargoToml).toContain('tauri-plugin-window-state = "2"');
    expect(mainRs).toContain("tauri_plugin_updater::Builder::new().build()");
    expect(mainRs).toContain("tauri_plugin_process::init()");
    expect(mainRs).toContain("tauri_plugin_log::Builder::new().build()");
    expect(mainRs).toContain('target: "cybara::browser"');
    expect(mainRs).toContain("tauri_plugin_window_state::Builder::default().build()");
    expect(capabilityJson).toContain('"updater:default"');
    expect(capabilityJson).toContain('"process:default"');
    expect(tauriConfig).toContain('"updater"');
    expect(tauriConfig).toContain('"endpoints": []');
    expect(tauriConfig).toContain('"pubkey": "dev-placeholder-updater-key"');
  });

  test("tray update state becomes busy before frontend installation begins", () => {
    const trayRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "tray.rs"), "utf8");
    const mainRs = readFileSync(join(ROOT_DIR, "src-tauri", "src", "main.rs"), "utf8");
    const mainTsx = readFileSync(join(ROOT_DIR, "ui", "src", "main.tsx"), "utf8");
    const updateStore = readFileSync(join(ROOT_DIR, "ui", "src", "lib", "updateStore.ts"), "utf8");

    expect(trayRs).toContain(
      'apply_update_state(app, true, None, Some("downloading".to_string()))'
    );
    expect(mainTsx).toContain("ensureUpdatePolling()");
    expect(updateStore).toContain("if (!state.available) await checkForUpdate()");
    expect(updateStore).toContain('await notifyTray(true, update.version, "downloading")');
    expect(mainRs).toContain("std::sync::mpsc::sync_channel(1)");
    expect(mainRs).toContain("app.run_on_main_thread");
    expect(mainRs).toContain("receiver.recv()");
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
  });
});
