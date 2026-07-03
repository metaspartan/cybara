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

  test("keeps in-flight requests alive when loading another session", () => {
    const source = readFileSync(hookPath, "utf8");
    const loadSessionBlock = source.slice(source.indexOf("const loadSession = useCallback"));
    expect(loadSessionBlock).toContain("setState({");
    expect(loadSessionBlock).not.toContain("activeRequestAbortRef.current?.abort();");
  });
});
