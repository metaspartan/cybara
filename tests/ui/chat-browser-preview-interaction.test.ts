import { describe, expect, test } from "bun:test";
import {
  BROWSER_SCROLL_DELTA_LIMIT,
  BROWSER_SCROLL_FRAME_MS,
  BrowserFramePresenter,
  BrowserScrollBatcher,
  mergeBrowserScrollDelta,
  normalizeBrowserWheelDelta,
  type BrowserScrollDelta,
} from "../../ui/src/pages/chat/browserPreviewInteraction";

describe("browser preview interactions", () => {
  test("batches wheel input below one display frame", () => {
    expect(BROWSER_SCROLL_FRAME_MS).toBe(8);
  });

  test("normalizes pixel, line, and page wheel deltas", () => {
    expect(normalizeBrowserWheelDelta(2, 3, 0, 640)).toEqual({ deltaX: 2, deltaY: 3 });
    expect(normalizeBrowserWheelDelta(2, 3, 1, 640)).toEqual({ deltaX: 32, deltaY: 48 });
    expect(normalizeBrowserWheelDelta(0, 1, 2, 640)).toEqual({ deltaX: 0, deltaY: 640 });
  });

  test("bounds merged trackpad bursts to the route contract", () => {
    expect(
      mergeBrowserScrollDelta({ deltaX: 3_900, deltaY: -3_900 }, { deltaX: 500, deltaY: -500 })
    ).toEqual({ deltaX: BROWSER_SCROLL_DELTA_LIMIT, deltaY: -BROWSER_SCROLL_DELTA_LIMIT });
  });

  test("coalesces a wheel burst into one request", async () => {
    const batches: BrowserScrollDelta[] = [];
    const batcher = new BrowserScrollBatcher(async (delta) => {
      batches.push(delta);
    }, 0);
    for (let index = 0; index < 30; index += 1) {
      batcher.enqueue({ deltaX: 1, deltaY: 4 });
    }
    await batcher.whenIdle();
    expect(batches).toEqual([{ deltaX: 30, deltaY: 120 }]);
    batcher.dispose();
  });

  test("keeps one trailing batch while a request is active", async () => {
    const batches: BrowserScrollDelta[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new BrowserScrollBatcher(async (delta) => {
      batches.push(delta);
      if (batches.length === 1) await firstRequest;
    }, 0);
    batcher.enqueue({ deltaX: 0, deltaY: 20 });
    await Bun.sleep(5);
    batcher.enqueue({ deltaX: 0, deltaY: 30 });
    batcher.enqueue({ deltaX: 0, deltaY: 40 });
    releaseFirst?.();
    await batcher.whenIdle();
    expect(batches).toEqual([
      { deltaX: 0, deltaY: 20 },
      { deltaX: 0, deltaY: 70 },
    ]);
    batcher.dispose();
  });

  test("keeps the displayed frame until the newest image is decoded", async () => {
    const decoders = new Map<string, () => void>();
    const presented: string[] = [];
    const presenter = new BrowserFramePresenter<{ screenshot: string }>(
      (source) =>
        new Promise<void>((resolve) => {
          decoders.set(source, resolve);
        }),
      (frame) => presented.push(frame.screenshot)
    );
    presenter.enqueue({ screenshot: "frame-1" });
    decoders.get("frame-1")?.();
    await Bun.sleep(0);
    presenter.enqueue({ screenshot: "frame-2" });
    presenter.enqueue({ screenshot: "frame-3" });
    expect(presented).toEqual(["frame-1"]);
    decoders.get("frame-2")?.();
    await Bun.sleep(0);
    expect(presented).toEqual(["frame-1"]);
    decoders.get("frame-3")?.();
    await Bun.sleep(0);
    expect(presented).toEqual(["frame-1", "frame-3"]);
    presenter.dispose();
  });

  test("updates frame metadata without decoding the same image again", async () => {
    let decodeCount = 0;
    const presented: number[] = [];
    const presenter = new BrowserFramePresenter<{ screenshot: string; cursorX: number }>(
      async () => {
        decodeCount += 1;
      },
      (frame) => presented.push(frame.cursorX)
    );
    presenter.enqueue({ screenshot: "frame", cursorX: 1 });
    await Bun.sleep(0);
    presenter.enqueue({ screenshot: "frame", cursorX: 2 });
    expect(decodeCount).toBe(1);
    expect(presented).toEqual([1, 2]);
    presenter.dispose();
  });
});
