import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  encodeAndroidPngPreview,
  encodeAndroidRawPreview,
  getMobileSimulatorStatus,
  isMobileSimulatorAction,
  parseAdbDevices,
  parseSimctlDevices,
  resolveAndroidSdkExecutable,
  summarizeMobileSimulatorStatus,
} from "../../src/core/mobile-simulator";
import { handleMobileSimulator } from "../../src/core/tools/handlers/mobile-simulator";

describe("mobile simulator discovery", () => {
  test("parses available iOS devices and prioritizes booted devices", () => {
    const devices = parseSimctlDevices(
      {
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
            { udid: "shutdown", name: "iPhone Air", state: "Shutdown", isAvailable: true },
            { udid: "booted", name: "iPhone Pro", state: "Booted", isAvailable: true },
            { udid: "missing", name: "Unavailable", state: "Shutdown", isAvailable: false },
          ],
        },
      },
      true
    );

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      id: "booted",
      name: "iPhone Pro",
      state: "booted",
      runtime: "iOS 26.5",
      interactive: true,
    });
  });

  test("parses only online Android emulators", () => {
    expect(
      parseAdbDevices(
        "List of devices attached\nemulator-5554 device product:sdk model:Pixel\nemulator-5556 offline\nphone-1 device\n"
      )
    ).toEqual(["emulator-5554"]);
  });

  test("encodes raw Android RGBA frames as preview PNGs", () => {
    const raw = Buffer.alloc(16 + 2 * 2 * 4);
    raw.writeUInt32LE(2, 0);
    raw.writeUInt32LE(2, 4);
    raw.writeUInt32LE(1, 8);
    raw.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255], 16);
    const preview = encodeAndroidRawPreview(raw);
    expect(preview?.width).toBe(2);
    expect(preview?.height).toBe(2);
    expect(preview?.sourceWidth).toBe(2);
    expect(preview?.sourceHeight).toBe(2);
    expect(preview?.bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(encodeAndroidRawPreview(Buffer.alloc(8))).toBeNull();
  });

  test("downsamples Android emulator PNG fallbacks with explicit native dimensions", () => {
    const source = new PNG({ width: 1080, height: 2400 });
    source.data.fill(255);
    const preview = encodeAndroidPngPreview(PNG.sync.write(source));
    expect(preview?.width).toBe(720);
    expect(preview?.height).toBe(1600);
    expect(preview?.sourceWidth).toBe(1080);
    expect(preview?.sourceHeight).toBe(2400);
    const encoded = preview ? PNG.sync.read(preview.bytes) : null;
    expect(encoded?.width).toBe(720);
    expect(encoded?.height).toBe(1600);
  });

  test("summarizes running devices without sending the full inventory to agents", () => {
    const summary = summarizeMobileSimulatorStatus({
      ios: {
        platform: "ios",
        supported: true,
        installed: true,
        interactive: false,
        devices: [
          {
            id: "running",
            name: "iPhone Pro",
            platform: "ios",
            state: "booted",
            interactive: false,
          },
          {
            id: "stopped",
            name: "iPhone Air",
            platform: "ios",
            state: "shutdown",
            interactive: false,
          },
        ],
      },
      android: {
        platform: "android",
        supported: true,
        installed: false,
        interactive: false,
        reason: "SDK missing",
        devices: [],
      },
    });
    expect(summary.ios.availableDeviceCount).toBe(2);
    expect(summary.ios.runningDevices.map((device) => device.id)).toEqual(["running"]);
    expect(summary.android.reason).toBe("SDK missing");
  });

  test("rejects unsupported actions at tool and API boundaries", () => {
    expect(isMobileSimulatorAction("tap")).toBe(true);
    expect(isMobileSimulatorAction("erase")).toBe(false);
    expect(isMobileSimulatorAction(null)).toBe(false);
  });

  test("rejects an unsupported agent tool action before running a device command", async () => {
    await expect(handleMobileSimulator({ action: "erase", platform: "ios" })).rejects.toThrow(
      "Invalid simulator action"
    );
  });

  test("finds Android SDK tools outside PATH on every desktop layout", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-android-sdk-"));
    const darwinHome = join(root, "mac");
    const linuxHome = join(root, "linux");
    const windowsLocal = join(root, "windows-local");
    const darwinAdb = join(darwinHome, "Library", "Android", "sdk", "platform-tools", "adb");
    const linuxEmulator = join(linuxHome, "Android", "Sdk", "emulator", "emulator");
    const windowsAdb = join(windowsLocal, "Android", "Sdk", "platform-tools", "adb.exe");
    for (const file of [darwinAdb, linuxEmulator, windowsAdb]) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "");
    }

    expect(resolveAndroidSdkExecutable("adb", "darwin", {}, darwinHome)).toBe(darwinAdb);
    expect(resolveAndroidSdkExecutable("emulator", "linux", {}, linuxHome)).toBe(linuxEmulator);
    expect(
      resolveAndroidSdkExecutable("adb", "win32", { LOCALAPPDATA: windowsLocal }, join(root, "win"))
    ).toBe(windowsAdb);
  });

  test("returns platform status without requiring either SDK", async () => {
    const status = await getMobileSimulatorStatus();
    expect(status.ios.platform).toBe("ios");
    expect(status.android.platform).toBe("android");
    expect(Array.isArray(status.ios.devices)).toBe(true);
    expect(Array.isArray(status.android.devices)).toBe(true);
  });

  test("returns concise status and reserves full inventory for list", async () => {
    const status = await handleMobileSimulator({ action: "status" });
    const list = await handleMobileSimulator({ action: "list" });
    expect(status).toHaveProperty("ios.availableDeviceCount");
    expect(status).not.toHaveProperty("ios.devices");
    expect(list).toHaveProperty("ios.devices");
  });
});
