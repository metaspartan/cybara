import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("desktop host runtime wiring", () => {
  test("frontend detects both tauri and cybara native desktop hosts", () => {
    const desktopHost = readFileSync(join(ROOT_DIR, "ui", "src", "lib", "desktopHost.ts"), "utf8");
    const desktopUpdater = readFileSync(
      join(ROOT_DIR, "ui", "src", "lib", "desktopUpdater.ts"),
      "utf8"
    );
    const openExternal = readFileSync(
      join(ROOT_DIR, "ui", "src", "utils", "openExternal.ts"),
      "utf8"
    );
    const mainTsx = readFileSync(join(ROOT_DIR, "ui", "src", "main.tsx"), "utf8");
    const settingsTsx = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Settings.tsx"), "utf8");
    const notifications = readFileSync(
      join(ROOT_DIR, "ui", "src", "hooks", "useNotifications.ts"),
      "utf8"
    );

    expect(desktopHost).toMatch(/["']cybara-native["']/);
    expect(desktopHost).toContain("__CYBARA_NATIVE__");
    expect(desktopHost).toContain("getDesktopHostRuntime");
    expect(desktopHost).toContain("supportsDesktopUpdater");
    expect(desktopHost).toContain("openDesktopDirectoryDialog");
    expect(desktopHost).toContain("openDesktopFileDialog");

    expect(desktopUpdater).toContain('from "@tauri-apps/plugin-updater"');
    expect(desktopUpdater).toContain('from "@tauri-apps/plugin-process"');
    expect(desktopUpdater).not.toContain('import("@tauri-apps/plugin-updater")');
    expect(desktopUpdater).not.toContain('import("@tauri-apps/plugin-process")');
    expect(openExternal).toContain('from "@tauri-apps/plugin-shell"');
    expect(openExternal).toContain("isTauriDesktopRuntime()");
    expect(openExternal).toContain("openTauriExternal(url)");

    expect(mainTsx).toContain("getDesktopHostRuntime()");
    expect(mainTsx).toMatch(/rootElement\.dataset\.runtime = desktopRuntime \|\| ["']web["']/);

    expect(settingsTsx).toContain("getDesktopRuntimeLabel");
    expect(settingsTsx).toContain("isDesktopUpdaterSupported");
    expect(settingsTsx).toContain("Cybara macOS app uses the same local gateway");
    expect(settingsTsx).toContain("openDesktopFileDialog");

    expect(notifications).toContain("sendDesktopNotification");
    expect(notifications).toContain("requestDesktopNotificationPermission");
  });

  test("chat workspace picker routes through shared desktop host dialog", () => {
    const chatTsx = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Chat.tsx"), "utf8");
    const localFolderPicker = readFileSync(
      join(ROOT_DIR, "ui", "src", "components", "LocalFolderPickerModal.tsx"),
      "utf8"
    );
    const gatewayPaths = readFileSync(
      join(ROOT_DIR, "ui", "src", "components", "settings", "GatewayPathSettingsSection.tsx"),
      "utf8"
    );

    expect(chatTsx).toContain("openDesktopDirectoryDialog");
    expect(chatTsx).toContain("isDesktopHostRuntime()");
    expect(chatTsx).toContain("LocalFolderPickerModal");
    expect(chatTsx).not.toContain("Enter workspace folder path");
    expect(chatTsx).not.toContain("Unable to open native folder picker");
    expect(chatTsx).not.toContain("tauriOpenDialog");
    expect(localFolderPicker).toContain("/api/ide/browse");
    expect(localFolderPicker).toContain('entry.type === "directory"');
    expect(gatewayPaths).toContain("LocalFolderPickerModal");
    expect(gatewayPaths).toContain("isDesktopHostRuntime()");
  });

  test("desktop updater remains packaged after route-level code splitting", () => {
    const distAssetsDir = join(ROOT_DIR, "ui", "dist", "assets");
    if (!existsSync(distAssetsDir)) return;

    const assetFiles = readdirSync(distAssetsDir).filter((file) => file.endsWith(".js"));
    const mainChunks = assetFiles.filter((file) => file.startsWith("index-"));
    const routeChunks = assetFiles.filter((file) => !file.startsWith("index-"));

    const mainChunkSource = mainChunks
      .map((file) => readFileSync(join(distAssetsDir, file), "utf8"))
      .join("\n");
    const routeChunkSource = routeChunks
      .map((file) => readFileSync(join(distAssetsDir, file), "utf8"))
      .join("\n");

    const productionBundleSource = `${mainChunkSource}\n${routeChunkSource}`;
    expect(productionBundleSource).toContain("plugin:updater");
    expect(productionBundleSource).toContain("plugin:process");
    expect(productionBundleSource).toContain("downloadAndInstall");
  });
});
