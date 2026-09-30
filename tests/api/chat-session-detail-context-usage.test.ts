import { describe, expect, test } from "bun:test";
import { createRoutesFixture } from "./routes.fixture";

const fixture = createRoutesFixture();

interface ContextUsageShape {
  usedTokens: number;
  limitTokens: number;
  usedPercent: number;
  remainingTokens: number;
  compactionCount: number;
  compacted: boolean;
}

describe("chat session detail usage fields", () => {
  test("returns live context usage so the client can render the context meter on load", async () => {
    const sessionId = `ctx-${crypto.randomUUID()}`;
    fixture.insertRawSession(sessionId, "default", [
      { role: "user", content: "Summarize the telemetry runbook for the launch window." },
      { role: "assistant", content: "The runbook requires a pre-flight checklist." },
    ]);

    const detail = await fixture.api("GET", `/api/chat/sessions/${sessionId}`);

    const usage = detail.data.contextUsage as ContextUsageShape | undefined;
    expect(usage).toBeDefined();
    expect(typeof usage?.usedTokens).toBe("number");
    expect(usage?.usedTokens).toBeGreaterThan(0);
    expect(usage?.limitTokens).toBeGreaterThan(0);
    expect(usage?.usedPercent).toBeGreaterThan(0);
    expect(usage?.remainingTokens).toBe(usage!.limitTokens - usage!.usedTokens);
  });

  test("reports compaction state that already happened in the session", async () => {
    const sessionId = `compact-${crypto.randomUUID()}`;
    fixture.insertRawSession(sessionId, "default", [
      { role: "user", content: "First request before compaction." },
      { role: "assistant", content: "Answered." },
      {
        role: "user",
        content: "[Context Summary: earlier turns were condensed]\n\n---\n\nSecond request.",
      },
    ]);

    const detail = await fixture.api("GET", `/api/chat/sessions/${sessionId}`);
    const usage = detail.data.contextUsage as ContextUsageShape | undefined;

    expect(usage).toBeDefined();
    expect(usage?.compacted).toBe(true);
    expect(usage?.compactionCount).toBeGreaterThan(0);
  });

  test("returns an always-populated message list for client hydration", async () => {
    const sessionId = `msgs-${crypto.randomUUID()}`;
    fixture.insertRawSession(sessionId, "default", [{ role: "user", content: "Hello there." }]);

    const detail = await fixture.api("GET", `/api/chat/sessions/${sessionId}`);

    expect(Array.isArray(detail.data.messagesList)).toBe(true);
    expect((detail.data.messagesList as Array<{ content: string }>).length).toBeGreaterThan(0);
  });
});
