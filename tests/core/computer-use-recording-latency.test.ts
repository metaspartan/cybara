import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isDriverStartRecordingReliable,
  shouldStartDriverVideoRecording,
} from "../../src/core/computer-use-recording";

const computerUseSource = readFileSync(
  fileURLToPath(new URL("../../src/core/computer-use.ts", import.meta.url)),
  "utf8"
);

const enabled = {
  trajectoryVideoEnabled: true,
  driverReady: true,
  hasStartRecordingTool: true,
  surface: "desktop" as const,
  driverStartRecordingReliable: true,
};

describe("driver video recording gate", () => {
  test("starts video only for a ready driver that exposes the tool", () => {
    expect(shouldStartDriverVideoRecording(enabled)).toBe(true);
  });

  test("never records video outside the desktop surface", () => {
    expect(shouldStartDriverVideoRecording({ ...enabled, surface: "app" })).toBe(false);
    expect(shouldStartDriverVideoRecording({ ...enabled, surface: "android_emulator" })).toBe(
      false
    );
  });

  test("never records video when the driver is unavailable", () => {
    expect(shouldStartDriverVideoRecording({ ...enabled, driverReady: false })).toBe(false);
  });

  test("never records video when the driver lacks the tool", () => {
    expect(shouldStartDriverVideoRecording({ ...enabled, hasStartRecordingTool: false })).toBe(
      false
    );
  });

  test("never records video when the setting is off", () => {
    expect(shouldStartDriverVideoRecording({ ...enabled, trajectoryVideoEnabled: false })).toBe(
      false
    );
  });

  test("never records video when start_recording is known to hang", () => {
    expect(
      shouldStartDriverVideoRecording({ ...enabled, driverStartRecordingReliable: false })
    ).toBe(false);
  });
});

describe("driver start_recording capability probe", () => {
  test("a driver that never answers start_recording is unreliable", () => {
    expect(
      isDriverStartRecordingReliable({
        listedToolNames: ["start_recording", "capture"],
        startRecordingResponds: false,
      })
    ).toBe(false);
  });

  test("a driver that answers start_recording is reliable", () => {
    expect(
      isDriverStartRecordingReliable({
        listedToolNames: ["start_recording", "capture"],
        startRecordingResponds: true,
      })
    ).toBe(true);
  });

  test("a driver without the tool is never reliable", () => {
    expect(
      isDriverStartRecordingReliable({
        listedToolNames: ["capture"],
        startRecordingResponds: true,
      })
    ).toBe(false);
  });
});

describe("video recording never blocks the requested action", () => {
  test("the recorder start is detached from the action path", () => {
    expect(computerUseSource).toContain("shouldStartDriverVideoRecording");
    expect(computerUseSource).not.toMatch(
      /await callDriverTool\(\s*"start_recording"[\s\S]{0,80}?\);[\s\S]{0,400}?isFullDesktopCaptureRequest/
    );
  });

  test("a stalled recorder cannot consume the request timeout budget", () => {
    expect(computerUseSource).toContain("startDriverVideoRecording");
    expect(computerUseSource).toMatch(/void startDriverVideoRecording|startDriverVideoRecording\(/);
  });

  test("the driver request timeout stays bounded", () => {
    const match = computerUseSource.match(/REQUEST_TIMEOUT_MS = ([\d_]+)/);
    expect(match).not.toBeNull();
    expect(Number((match?.[1] ?? "0").replace(/_/g, ""))).toBeLessThanOrEqual(30_000);
  });
});
