import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  appendComputerUseTrajectoryTurn,
  createComputerUseTrajectory,
  deleteComputerUseTrajectory,
  exportComputerUseTrajectories,
  finishComputerUseTrajectory,
  getComputerUseTrajectory,
  getPersistedComputerUsePreview,
  listComputerUseTrajectories,
} from "../../src/core/computer-use-trajectories";
import { config } from "../../src/core/config";
import {
  recordVisualInteractionTrajectoryTurn,
  stopComputerUseTrajectoryCapture,
} from "../../src/core/computer-use";

describe("computer-use trajectory research data", () => {
  test("preserves trajectory capture settings when only the driver path changes", () => {
    const previous = config.getComputerUseSettings();
    try {
      config.setComputerUseSettings({
        trajectoryCaptureEnabled: true,
        trajectoryVideoEnabled: true,
      });
      const updated = config.setComputerUseSettings({
        driverCommand: "/tmp/cua-driver",
      });
      expect(updated).toEqual({
        driverCommand: "/tmp/cua-driver",
        trajectoryCaptureEnabled: true,
        trajectoryVideoEnabled: true,
      });
    } finally {
      config.setComputerUseSettings(previous);
    }
  });

  test("catalogs driver-native turns and exports redacted replay data", () => {
    const created = createComputerUseTrajectory({
      sessionId: "research-session",
      recordVideo: false,
    });
    const turnDir = join(created.dir, "turn-00001");
    mkdirSync(turnDir, { recursive: true });
    writeFileSync(
      join(turnDir, "action.json"),
      JSON.stringify({
        tool: "click",
        arguments: { x: 120, y: 90, api_key: "secret-value" },
        result_summary: "clicked",
        pid: 42,
        click_point: { x: 120, y: 90 },
        timestamp: "2026-07-13T00:00:00.000Z",
      })
    );
    writeFileSync(join(turnDir, "screenshot.png"), "png");
    writeFileSync(join(turnDir, "click.png"), "click");
    writeFileSync(join(turnDir, "app_state.json"), JSON.stringify({ title: "Test app" }));
    finishComputerUseTrajectory(created.metadata.id, "completed");

    const detail = getComputerUseTrajectory(created.metadata.id);
    expect(detail).toMatchObject({
      sessionId: "research-session",
      status: "completed",
      turnCount: 1,
      screenshotCount: 1,
      clickCount: 1,
    });
    expect(detail?.turns[0]).toMatchObject({
      tool: "click",
      pid: 42,
      clickPoint: { x: 120, y: 90 },
      hasScreenshot: true,
      hasClickImage: true,
      hasAppState: true,
    });
    expect(listComputerUseTrajectories().some((item) => item.id === created.metadata.id)).toBe(
      true
    );

    const exported = exportComputerUseTrajectories([created.metadata.id], {
      includeMedia: true,
      redact: true,
    });
    expect(exported.count).toBe(1);
    expect(exported.content).toContain("cybara-computer-use-trajectory");
    expect(exported.content).toContain("screenshot_png");
    expect(exported.content).toContain("[REDACTED]");
    expect(exported.content).not.toContain("secret-value");

    expect(deleteComputerUseTrajectory(created.metadata.id)).toBe(true);
    expect(getComputerUseTrajectory(created.metadata.id)).toBeNull();
  });

  test("prefers agent-visible actions over driver-internal recording events", () => {
    const created = createComputerUseTrajectory({
      sessionId: "visible-actions-session",
      recordVideo: false,
    });
    const driverTurnDir = join(created.dir, "turn-00001");
    mkdirSync(driverTurnDir, { recursive: true });
    writeFileSync(
      join(driverTurnDir, "action.json"),
      JSON.stringify({ tool: "check_permissions", arguments: {}, result_summary: "granted" })
    );
    appendComputerUseTrajectoryTurn(created.metadata.id, {
      tool: "capture",
      arguments: { action: "capture", app: "desktop" },
      result: { ok: true, viewport: { width: 1920, height: 1080 } },
      screenshot: Buffer.from("image").toString("base64"),
      screenshotMime: "image/png",
    });
    appendComputerUseTrajectoryTurn(created.metadata.id, {
      tool: "move",
      arguments: { action: "move", coordinate: [960, 540] },
      result: { ok: true },
    });
    finishComputerUseTrajectory(created.metadata.id, "completed");

    const detail = getComputerUseTrajectory(created.metadata.id);
    expect(detail?.turns.map((turn) => turn.tool)).toEqual(["capture", "move"]);
    expect(detail?.screenshotCount).toBe(1);
    const exported = exportComputerUseTrajectories([created.metadata.id], {
      includeMedia: true,
      redact: true,
    });
    expect(exported.content).toContain("screenshot_png");
    expect(exported.content).not.toContain("check_permissions");
    expect(deleteComputerUseTrajectory(created.metadata.id)).toBe(true);
  });

  test("hydrates a completed session preview from its latest persisted trajectory", () => {
    const created = createComputerUseTrajectory({
      sessionId: "persisted-preview-session",
      recordVideo: false,
    });
    appendComputerUseTrajectoryTurn(created.metadata.id, {
      tool: "capture",
      arguments: { action: "capture", app: "desktop" },
      result: { ok: true, viewport: { width: 1920, height: 1080 } },
      screenshot: Buffer.from("first-frame").toString("base64"),
      screenshotMime: "image/png",
    });
    appendComputerUseTrajectoryTurn(created.metadata.id, {
      tool: "move",
      arguments: { action: "move", coordinate: [960, 540] },
      result: { ok: true },
    });
    appendComputerUseTrajectoryTurn(created.metadata.id, {
      tool: "capture",
      arguments: { action: "capture", app: "desktop" },
      result: { ok: true, viewport: { width: 1920, height: 1080 } },
      screenshot: Buffer.from("final-frame").toString("base64"),
      screenshotMime: "image/png",
    });
    finishComputerUseTrajectory(created.metadata.id, "completed");

    expect(getPersistedComputerUsePreview("persisted-preview-session")).toMatchObject({
      action: "capture",
      app: "desktop",
      screenshot: Buffer.from("final-frame").toString("base64"),
      contentType: "image/png",
      viewport: { width: 1920, height: 1080 },
      cursor: { x: 960, y: 540, action: "move" },
      revision: 3,
      screenshotRevision: 3,
    });

    expect(deleteComputerUseTrajectory(created.metadata.id)).toBe(true);
  });

  test("records simulator actions with media without replacing desktop previews", async () => {
    const sessionId = `simulator-trajectory-${crypto.randomUUID()}`;
    const previous = config.getComputerUseSettings();
    const desktop = createComputerUseTrajectory({
      sessionId,
      recordVideo: false,
      surface: "desktop",
    });
    appendComputerUseTrajectoryTurn(desktop.metadata.id, {
      tool: "capture",
      arguments: { action: "capture", app: "desktop" },
      result: { ok: true, viewport: { width: 800, height: 600 } },
      screenshot: Buffer.from("desktop-frame").toString("base64"),
      screenshotMime: "image/png",
    });
    finishComputerUseTrajectory(desktop.metadata.id, "completed");
    try {
      config.setComputerUseSettings({
        trajectoryCaptureEnabled: true,
        trajectoryVideoEnabled: false,
      });
      expect(
        await recordVisualInteractionTrajectoryTurn({
          arguments: {
            action: "tap",
            deviceId: "ios-test-device",
            platform: "ios",
            x: 120,
            y: 240,
          },
          captureAfter: async () => ({
            screenshot: Buffer.from("simulator-frame").toString("base64"),
            screenshotMime: "image/png",
          }),
          clickPoint: { x: 120, y: 240 },
          result: { success: true },
          sessionId,
          surface: "ios_simulator",
          tool: "mobile_simulator",
        })
      ).toBe(true);
      await stopComputerUseTrajectoryCapture();
      const simulator = listComputerUseTrajectories().find(
        (item) => item.sessionId === sessionId && item.surface === "ios_simulator"
      );
      expect(simulator).toMatchObject({
        status: "completed",
        turnCount: 1,
        screenshotCount: 1,
        clickCount: 1,
      });
      expect(
        getComputerUseTrajectory(simulator?.id ?? "missing-trajectory")?.turns[0]
      ).toMatchObject({
        tool: "mobile_simulator",
        clickPoint: { x: 120, y: 240 },
        hasScreenshot: true,
      });
      expect(
        exportComputerUseTrajectories([simulator?.id ?? "missing-trajectory"], {
          includeMedia: false,
          redact: true,
        }).content
      ).toContain('"surface":"ios_simulator"');
      expect(getPersistedComputerUsePreview(sessionId)?.screenshot).toBe(
        Buffer.from("desktop-frame").toString("base64")
      );
      if (simulator) expect(deleteComputerUseTrajectory(simulator.id)).toBe(true);
    } finally {
      await stopComputerUseTrajectoryCapture();
      config.setComputerUseSettings(previous);
      deleteComputerUseTrajectory(desktop.metadata.id);
    }
  });

  test("rejects trajectory path traversal", () => {
    expect(() => getComputerUseTrajectory("../outside")).toThrow("Invalid trajectory ID");
    expect(() => deleteComputerUseTrajectory("bad/id")).toThrow("Invalid trajectory ID");
  });
});
