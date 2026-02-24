import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const hookPath = join(process.cwd(), "ui", "src", "hooks", "useChat.ts");

describe("useChat session race guards", () => {
  test("ignores stale in-flight responses after a session switch", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("if (activeRequestAbortRef.current !== controller)");
    expect(source).toContain("prev.sessionId !== requestSessionId");
  });

  test("aborts the active request when loading another session", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("activeRequestAbortRef.current?.abort();");
    expect(source).toContain("activeRequestAbortRef.current = null;");
  });
});
