import { describe, expect, test } from "bun:test";
import { LatestBrowserFrameDecoder } from "../../ui/src/pages/chat/browserPreviewStreamClient";

describe("browser preview image", () => {
  test("decodes one frame at a time and keeps only the latest queued frame", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const decoded: string[] = [];
    const presented: string[] = [];
    const decoder = new LatestBrowserFrameDecoder(
      async (frame) => {
        const value = await frame.text();
        decoded.push(value);
        if (value === "frame-1") await firstPending;
        return value;
      },
      (source) => presented.push(source),
      () => undefined
    );

    decoder.enqueue(new Blob(["frame-1"]));
    await Bun.sleep(0);
    decoder.enqueue(new Blob(["frame-2"]));
    decoder.enqueue(new Blob(["frame-3"]));
    releaseFirst?.();
    await Bun.sleep(5);

    expect(decoded).toEqual(["frame-1", "frame-3"]);
    expect(presented).toEqual(["frame-1", "frame-3"]);
    decoder.dispose();
  });

  test("discards a frame decoded after disposal", async () => {
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const presented: string[] = [];
    const discarded: string[] = [];
    const decoder = new LatestBrowserFrameDecoder(
      async () => {
        await pending;
        return "decoded-frame";
      },
      (source) => presented.push(source),
      (source) => discarded.push(source)
    );

    decoder.enqueue(new Blob(["frame"]));
    await Bun.sleep(0);
    decoder.dispose();
    release?.();
    await Bun.sleep(0);

    expect(presented).toEqual([]);
    expect(discarded).toEqual(["decoded-frame"]);
  });
});
