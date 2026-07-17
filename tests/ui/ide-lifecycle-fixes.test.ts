import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readIdeUiSource } from "../source-fixtures";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("GitStatus refresh + cleanup", () => {
  const src = read("../../ui/src/pages/ide/GitStatus.tsx");

  test("guards against setState-after-unmount and stale responses", () => {
    expect(src).toContain("let cancelled = false");
    expect(src).toContain("new AbortController()");
    expect(src).toContain("if (cancelled) return");
    expect(src).toContain("controller.abort()");
  });

  test("polls so the branch/counts do not go stale, and re-fetches on refreshKey", () => {
    expect(src).toContain("setInterval");
    expect(src).toContain("clearInterval");
    expect(src).toContain("refreshKey");
    // The dependency array must include refreshKey + pollMs so both trigger refetch.
    expect(src).toMatch(/\[path, refreshKey, pollMs\]/);
  });
});

describe("IDE workspace browse lifecycle", () => {
  const src = readIdeUiSource();

  test("aborts superseded workspace requests and ignores stale responses", () => {
    expect(src).toContain("const controller = new AbortController()");
    expect(src).toContain("signal: controller.signal");
    expect(src).toContain("if (cancelled) return");
    expect(src).toContain("controller.abort()");
  });
});

describe("Terminal WebSocket + xterm cleanup on unmount", () => {
  const src = read("../../ui/src/pages/Terminal.tsx");

  test("mirrors sessions into a ref and disposes them all on unmount", () => {
    expect(src).toContain("sessionsRef");
    expect(src).toContain("sessionsRef.current = sessions");
    // An unmount-only effect ([] deps) that closes sockets and disposes terminals.
    expect(src).toContain("session.ws?.close()");
    expect(src).toContain("session.term?.dispose()");
    expect(src).toMatch(/for \(const session of sessionsRef\.current\)/);
  });
});

describe("CodeViewer LSP keyboard + hover fixes", () => {
  const src = readIdeUiSource();

  test("go-to-definition/references fall back to the live cursor (F12 without a context menu)", () => {
    // resolveLspLocations now uses the cursor as a fallback instead of bailing
    // when no right-click context menu is open.
    expect(src).toContain("editorContextMenu ? editorContextMenu.line : cursorLine");
    expect(src).toContain("editorContextMenu ? editorContextMenu.column : cursorColumn");
    // The LSP resolver itself only guards on `path`, not on the context menu.
    expect(src).toContain(
      "): Promise<Array<{ path: string; line: number; character: number }>> => {\n      if (!path) return [];"
    );
  });

  test("hover stores a 1-based display line and converts to 0-based for LSP", () => {
    expect(src).toContain("setHoverInfo({ line: displayLine");
    expect(src).toContain("line: String(Math.max(displayLine - 1, 0))");
    // The row handler passes the 1-based line so it matches `hoverInfo.line === i + 1`.
    expect(src).toContain("scheduleHover(i + 1, 0)");
  });
});
