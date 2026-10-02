import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const runtime = readFileSync(
  join(import.meta.dir, "../../ui/src/pages/chat/useChatLiveSessionRuntime.ts"),
  "utf8"
);
const stream = readFileSync(join(import.meta.dir, "../../ui/src/lib/status-stream.ts"), "utf8");

describe("compacted active usage in live chat", () => {
  test("status usage reaches the meter only after session identity checks", () => {
    expect(stream).toContain("contextUsage?: SessionContextUsage");
    const update = runtime.indexOf(
      "if (payload.contextUsage) setSessionContextUsage(payload.contextUsage)"
    );
    const guard = runtime.indexOf(
      "if (activeSession && payload.sessionId && payload.sessionId !== activeSession) return"
    );
    expect(update).toBeGreaterThan(guard);
    expect(update).toBeLessThan(runtime.indexOf('if (status === "thinking")', guard));
  });
});
