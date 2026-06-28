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
    expect(settingsTsx).toContain("checkForDesktopUpdate");
    expect(settingsTsx).toContain("installDesktopUpdate");
    expect(settingsTsx).toContain("relaunchDesktopApp");
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
    expect(mainRs).toContain("tauri_plugin_updater::Builder::new().build()");
    expect(mainRs).toContain("tauri_plugin_process::init()");
    expect(capabilityJson).toContain('"updater:default"');
    expect(capabilityJson).toContain('"process:default"');
    expect(tauriConfig).toContain('"updater"');
    expect(tauriConfig).toContain('"endpoints": []');
    expect(tauriConfig).toContain('"pubkey": "dev-placeholder-updater-key"');
  });

  test("release workflow prepares updater config and passes the release tag", () => {
    const workflowPath = join(ROOT_DIR, ".github", "workflows", "release.yml");
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("bun run tauri:prepare-release");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    expect(workflow).toContain("tagName: ${{ github.ref_name }}");
    expect(workflow).toContain("--config src-tauri/tauri.release.conf.json");
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
    expect(workflow).toContain("tauri-apps/tauri-action@v0");
  });
});
