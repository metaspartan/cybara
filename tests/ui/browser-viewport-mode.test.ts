import { describe, expect, test } from "bun:test";
import {
  BROWSER_VIEWPORT_PRESETS,
  BrowserViewportResizeQueue,
  browserViewportForMode,
  inferBrowserViewportMode,
  parseBrowserViewportMode,
  type BrowserViewport,
} from "../../ui/src/pages/chat/browserViewportMode";

describe("browser viewport modes", () => {
  test("normalizes stored modes and resolves fixed presets", () => {
    expect(parseBrowserViewportMode("mobile")).toBe("mobile");
    expect(parseBrowserViewportMode("desktop")).toBe("desktop");
    expect(parseBrowserViewportMode("invalid")).toBe("responsive");
    expect(browserViewportForMode("mobile", { width: 1200, height: 800 })).toEqual(
      BROWSER_VIEWPORT_PRESETS.mobile
    );
    expect(browserViewportForMode("desktop", null)).toEqual(BROWSER_VIEWPORT_PRESETS.desktop);
    expect(inferBrowserViewportMode({ width: 390, height: 844 })).toBe("mobile");
    expect(inferBrowserViewportMode({ width: 1440, height: 900 })).toBe("desktop");
    expect(inferBrowserViewportMode({ width: 700, height: 600 })).toBeNull();
  });

  test("bounds responsive viewports through the preview contract", () => {
    expect(browserViewportForMode("responsive", { width: 2560, height: 1600 })).toEqual({
      width: 1600,
      height: 1000,
    });
  });

  test("coalesces resize bursts and applies only the newest result", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requested: BrowserViewport[] = [];
    const applied: BrowserViewport[] = [];
    const queue = new BrowserViewportResizeQueue(
      async (viewport) => {
        requested.push(viewport);
        if (requested.length === 1) await firstPending;
        return viewport;
      },
      (viewport) => applied.push(viewport),
      () => undefined
    );

    queue.enqueue({ width: 800, height: 600 });
    await Bun.sleep(0);
    queue.enqueue({ width: 900, height: 700 });
    queue.enqueue({ width: 1000, height: 800 });
    releaseFirst?.();
    await queue.whenIdle();

    expect(requested).toEqual([
      { width: 800, height: 600 },
      { width: 1000, height: 800 },
    ]);
    expect(applied).toEqual([{ width: 1000, height: 800 }]);
  });

  test("continues after a superseded resize failure", async () => {
    const applied: BrowserViewport[] = [];
    const errors: unknown[] = [];
    let calls = 0;
    const queue = new BrowserViewportResizeQueue(
      async (viewport) => {
        calls += 1;
        if (calls === 1) {
          await Bun.sleep(5);
          throw new Error("stale resize failed");
        }
        return viewport;
      },
      (viewport) => applied.push(viewport),
      (error) => errors.push(error)
    );

    queue.enqueue({ width: 800, height: 600 });
    queue.enqueue({ width: 1200, height: 900 });
    await queue.whenIdle();

    expect(applied).toEqual([{ width: 1200, height: 900 }]);
    expect(errors).toEqual([]);
  });
});
