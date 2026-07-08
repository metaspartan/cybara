import { afterEach, describe, expect, test } from "bun:test";
import {
  createMobileDevice,
  resetMobileDeviceStoreForTests,
  updateMobileDevicePushPreferences,
  updateMobileDevicePushToken,
} from "../../src/core/mobile-devices";
import {
  resetMobilePushNotificationStateForTests,
  sendMobilePushNotification,
} from "../../src/core/mobile-push";
import { broadcastStatus, broadcastTaskEvent } from "../../src/core/status";

const expoToken = "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]";

afterEach(() => {
  resetMobileDeviceStoreForTests();
  resetMobilePushNotificationStateForTests();
});

function installFetchMock(response: unknown = { data: { status: "ok", id: "ticket-1" } }) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    return Response.json(response);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("mobile push notifications", () => {
  test("skips delivery when no paired devices have push tokens", async () => {
    const result = await sendMobilePushNotification({ title: "Cybara finished" });
    expect(result).toEqual({ attempted: 0, sent: 0, skipped: true, errors: [] });
  });

  test("sends Expo payloads only to registered mobile push targets", async () => {
    const { device } = createMobileDevice({ baseUrl: "http://127.0.0.1:4269" });
    updateMobileDevicePushToken(device.id, {
      token: expoToken,
      platform: "android",
    });
    const mock = installFetchMock();

    try {
      const result = await sendMobilePushNotification({
        title: "Cybara finished",
        body: "Chat response is ready.",
        data: { type: "chat_completed", sessionId: "s1" },
      });

      expect(result.sent).toBe(1);
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]?.url).toBe("https://exp.host/--/api/v2/push/send");
      expect(mock.calls[0]?.body).toMatchObject({
        to: expoToken,
        title: "Cybara finished",
        data: { type: "chat_completed", sessionId: "s1" },
      });
    } finally {
      mock.restore();
    }
  });

  test("broadcasts chat completion and task completion notifications", async () => {
    const { device } = createMobileDevice({ baseUrl: "http://127.0.0.1:4269" });
    updateMobileDevicePushToken(device.id, { token: expoToken, platform: "ios" });
    const mock = installFetchMock();

    try {
      broadcastStatus({
        status: "idle",
        timestamp: Date.now(),
        sessionId: "session-push-1",
        detail: "Final answer is ready",
      });
      broadcastTaskEvent({
        type: "task_completed",
        taskId: "task-1",
        taskName: "Nightly review",
        status: "completed",
        resultPreview: "Review finished",
      });
      broadcastTaskEvent({
        type: "task_completed",
        taskId: "task-2",
        taskName: "Nightly cleanup",
        status: "failed",
        error: "Cleanup failed",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(mock.calls.map((call) => (call.body as { title?: string }).title)).toContain(
        "Cybara finished"
      );
      expect(mock.calls.map((call) => (call.body as { title?: string }).title)).toContain(
        "Cybara task completed"
      );
      expect(
        mock.calls.map((call) => (call.body as { data?: { type?: string } }).data?.type)
      ).toContain("task_failed");
    } finally {
      mock.restore();
    }
  });

  test("honors per-device chat and task push preferences", async () => {
    const { device } = createMobileDevice({ baseUrl: "http://127.0.0.1:4269" });
    updateMobileDevicePushToken(device.id, { token: expoToken, platform: "ios" });
    updateMobileDevicePushPreferences(device.id, {
      chatCompletions: false,
      taskCompletions: true,
    });
    const mock = installFetchMock();

    try {
      broadcastStatus({
        status: "idle",
        timestamp: Date.now(),
        sessionId: "session-push-filtered",
        detail: "Final answer is ready",
      });
      broadcastTaskEvent({
        type: "task_completed",
        taskId: "task-filtered",
        taskName: "Nightly review",
        status: "completed",
        resultPreview: "Review finished",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]?.body).toMatchObject({
        title: "Cybara task completed",
        data: { type: "task_completed", taskId: "task-filtered" },
      });
    } finally {
      mock.restore();
    }
  });
});
