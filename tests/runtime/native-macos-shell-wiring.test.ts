import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MACOS_APP_DIR = join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara");

describe("native macOS shell wiring", () => {
  test("sidecar manager reuses gateway port 4269 and configures a managed local launch", () => {
    const sidecarManager = readFileSync(join(MACOS_APP_DIR, "SidecarManager.swift"), "utf8");
    const sidecarCore = readFileSync(join(MACOS_APP_DIR, "SidecarCore.swift"), "utf8");

    expect(sidecarManager).toContain('CYBARA_NATIVE_PORT');
    expect(sidecarManager).toContain("SidecarCore.port(fromEnv:");
    expect(sidecarCore).toContain("public static let defaultPort = 4269");
    expect(sidecarManager).toContain('Attached to existing Cybara gateway');
    expect(sidecarCore).toContain('environment["PORT"] = String(port)');
    expect(sidecarCore).toContain('environment["CYBARA_HOST"] = "127.0.0.1"');
    expect(sidecarManager).toContain('arguments = ["start", "--enable-terminal"]');
    expect(sidecarCore).toContain('bundledSidecar.appendingPathComponent("cybara").path');
    expect(sidecarManager).toContain("gatewayMode = .managed");
    expect(sidecarManager).toContain("gatewayMode = .attached");
  });

  test("webview injects the cybara native runtime bridge and notification support", () => {
    const webView = readFileSync(join(MACOS_APP_DIR, "CybaraWebView.swift"), "utf8");

    expect(webView).toContain('__CYBARA_NATIVE__');
    expect(webView).toContain('runtime: "cybara-native"');
    expect(webView).toContain('requestNotificationPermission');
    expect(webView).toContain('notificationPermission');
    expect(webView).toContain('openDirectoryDialog');
    expect(webView).toContain("NSOpenPanel");
    expect(webView).toContain("UNUserNotificationCenter");
    expect(webView).toContain('document.documentElement.dataset.runtime = "cybara-native"');
  });
});
