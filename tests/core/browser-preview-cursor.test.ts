import { describe, expect, test } from "bun:test";
import {
  BrowserPreviewCursorTracker,
  normalizePageCursor,
  pageCursorProbeScript,
} from "../../src/core/browser/preview-cursor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("browser preview page cursor", () => {
  test("keeps only standard cursor keywords and drops custom image cursors", () => {
    expect(normalizePageCursor("pointer")).toBe("pointer");
    expect(normalizePageCursor("TEXT")).toBe("text");
    expect(normalizePageCursor('url("https://tracker.example/c.png") 4 4, grab')).toBe("grab");
    expect(normalizePageCursor('url("https://tracker.example/c.png"), auto')).toBe("default");
    expect(normalizePageCursor("expression(alert(1))")).toBe("default");
    expect(normalizePageCursor(42)).toBe("default");
  });

  test("builds a probe script with numeric coordinates only", () => {
    const script = pageCursorProbeScript(12.5, 40);
    expect(script).toContain("const x = 12.5;");
    expect(script).toContain("const y = 40;");
    expect(script).toContain("elementFromPoint");
  });

  test("publishes only cursor changes and probes the latest pointer position", async () => {
    const probes: Array<{ x: number; y: number }> = [];
    const published: string[] = [];
    const answers = ["pointer", "pointer", "text"];
    const tracker = new BrowserPreviewCursorTracker(
      async (x, y) => {
        probes.push({ x, y });
        return answers.shift() ?? "text";
      },
      (cursor) => published.push(cursor),
      0
    );

    tracker.track(1, 1);
    await Bun.sleep(5);
    tracker.track(2, 2);
    await Bun.sleep(5);
    tracker.refresh();
    await Bun.sleep(5);

    expect(probes).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(published).toEqual(["pointer", "text"]);
    tracker.dispose();
  });

  test("coalesces moves while a probe is running and stops after dispose", async () => {
    const gate = deferred<string>();
    const probes: Array<{ x: number; y: number }> = [];
    const published: string[] = [];
    const tracker = new BrowserPreviewCursorTracker(
      async (x, y) => {
        probes.push({ x, y });
        return probes.length === 1 ? await gate.promise : "grab";
      },
      (cursor) => published.push(cursor),
      0
    );

    tracker.track(1, 1);
    await Bun.sleep(2);
    tracker.track(2, 2);
    tracker.track(3, 3);
    tracker.track(4, 4);
    gate.resolve("pointer");
    await Bun.sleep(5);

    expect(probes).toEqual([
      { x: 1, y: 1 },
      { x: 4, y: 4 },
    ]);
    expect(published).toEqual(["pointer", "grab"]);

    tracker.dispose();
    tracker.track(5, 5);
    await Bun.sleep(5);
    expect(probes).toHaveLength(2);
  });

  test("ignores probe failures", async () => {
    const published: string[] = [];
    const tracker = new BrowserPreviewCursorTracker(
      async () => {
        throw new Error("page navigated");
      },
      (cursor) => published.push(cursor),
      0
    );
    tracker.track(1, 1);
    await Bun.sleep(5);
    expect(published).toEqual([]);
    tracker.dispose();
  });
});
