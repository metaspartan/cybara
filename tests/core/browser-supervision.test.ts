import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  browserDownloadsAccepted,
  getBrowserSupervisionSettings,
  onBrowserSupervisionSettingsChanged,
  setBrowserSupervisionSettings,
} from "../../src/core/browser/supervision";
import { isSealedSecret } from "../../src/core/secret-storage";

afterEach(() => {
  config.set("browser_supervision", null);
});

describe("browser supervision", () => {
  test("defaults to local routing with bounded recovery settings", () => {
    const settings = getBrowserSupervisionSettings();

    expect(settings.autoRestart).toBe(true);
    expect(settings.remoteRoutingEnabled).toBe(false);
    expect(settings.downloadPolicy).toBe("ask");
    expect(settings.healthCheckIntervalMs).toBe(30000);
  });

  test("seals remote credentials and redacts public settings", () => {
    const settings = setBrowserSupervisionSettings({
      remoteRoutingEnabled: true,
      remoteEndpoint: "wss://browser.example.test/devtools/browser/123",
      remoteToken: "browser-secret",
    });
    const stored = config.get<{ remoteToken: string }>("browser_supervision");

    expect(settings.remoteEndpoint).toBe("wss://browser.example.test/devtools/browser/123");
    expect(settings.remoteToken).toBe("***redacted***");
    expect(isSealedSecret(stored?.remoteToken)).toBe(true);
    expect(getBrowserSupervisionSettings({ redact: false }).remoteToken).toBe("browser-secret");
  });

  test("rejects unsafe endpoints and clamps health intervals", () => {
    expect(() => setBrowserSupervisionSettings({ remoteEndpoint: "file:///tmp/browser" })).toThrow(
      "must use HTTP, HTTPS, WS, or WSS"
    );
    expect(() =>
      setBrowserSupervisionSettings({ remoteEndpoint: "https://user:pass@example.test" })
    ).toThrow("cannot contain credentials");

    expect(setBrowserSupervisionSettings({ healthCheckIntervalMs: 1 }).healthCheckIntervalMs).toBe(
      5000
    );
    expect(
      setBrowserSupervisionSettings({ healthCheckIntervalMs: 999999 }).healthCheckIntervalMs
    ).toBe(300000);
  });

  test("only accepts downloads when explicitly allowed", () => {
    expect(browserDownloadsAccepted("ask")).toBe(false);
    expect(browserDownloadsAccepted("deny")).toBe(false);
    expect(browserDownloadsAccepted("allow")).toBe(true);
  });

  test("notifies the active supervisor when settings change", () => {
    const updates: string[] = [];
    const unsubscribe = onBrowserSupervisionSettingsChanged((settings) => {
      updates.push(settings.downloadPolicy);
    });
    try {
      setBrowserSupervisionSettings({ downloadPolicy: "deny" });
      expect(updates).toEqual(["deny"]);
    } finally {
      unsubscribe();
    }
  });
});
