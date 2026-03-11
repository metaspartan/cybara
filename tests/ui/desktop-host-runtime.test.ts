import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("desktop host runtime wiring", () => {
  test("frontend detects both tauri and cybara native desktop hosts", () => {
    const desktopHost = readFileSync(join(ROOT_DIR, "ui", "src", "lib", "desktopHost.ts"), "utf8");
    const mainTsx = readFileSync(join(ROOT_DIR, "ui", "src", "main.tsx"), "utf8");
    const settingsTsx = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Settings.tsx"), "utf8");
    const notifications = readFileSync(
      join(ROOT_DIR, "ui", "src", "hooks", "useNotifications.ts"),
      "utf8"
    );

    expect(desktopHost).toContain("'cybara-native'");
    expect(desktopHost).toContain("__CYBARA_NATIVE__");
    expect(desktopHost).toContain("getDesktopHostRuntime");
    expect(desktopHost).toContain("supportsDesktopUpdater");
    expect(desktopHost).toContain("openDesktopDirectoryDialog");

    expect(mainTsx).toContain("getDesktopHostRuntime()");
    expect(mainTsx).toContain("rootElement.dataset.runtime = desktopRuntime || 'web'");

    expect(settingsTsx).toContain("getDesktopRuntimeLabel");
    expect(settingsTsx).toContain("isDesktopUpdaterSupported");
    expect(settingsTsx).toContain("Cybara macOS app uses the same local gateway");

    expect(notifications).toContain("sendDesktopNotification");
    expect(notifications).toContain("requestDesktopNotificationPermission");
  });

  test("chat workspace picker routes through shared desktop host dialog", () => {
    const chatTsx = readFileSync(join(ROOT_DIR, "ui", "src", "pages", "Chat.tsx"), "utf8");

    expect(chatTsx).toContain("openDesktopDirectoryDialog");
    expect(chatTsx).toContain("isDesktopHostRuntime()");
    expect(chatTsx).not.toContain("tauriOpenDialog");
  });
});
