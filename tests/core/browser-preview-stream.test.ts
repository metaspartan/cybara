import { describe, expect, test } from "bun:test";
import { BrowserPreviewStreamBroker } from "../../src/core/browser/preview-stream";

describe("browser preview stream", () => {
  test("shares one browser stream and replays the latest frame", async () => {
    let starts = 0;
    let stops = 0;
    let emit: ((frame: string) => void) | null = null;
    const broker = new BrowserPreviewStreamBroker(async (_pageId, _options, listener) => {
      starts += 1;
      emit = listener;
      return async () => {
        stops += 1;
      };
    });
    const options = { quality: 58, maxWidth: 960, maxHeight: 640, everyNthFrame: 1 };
    const firstFrames: string[] = [];
    const secondFrames: string[] = [];
    const unsubscribeFirst = await broker.subscribe("page-1", options, (frame) => {
      firstFrames.push(frame.toString());
    });
    emit?.(Buffer.from("frame-1").toString("base64"));
    const unsubscribeSecond = await broker.subscribe("page-1", options, (frame) => {
      secondFrames.push(frame.toString());
    });

    expect(starts).toBe(1);
    expect(firstFrames).toEqual(["frame-1"]);
    expect(secondFrames).toEqual(["frame-1"]);
    expect(broker.activeStreamCount()).toBe(1);

    await unsubscribeFirst();
    expect(stops).toBe(0);
    await unsubscribeSecond();
    expect(stops).toBe(1);
    expect(broker.activeStreamCount()).toBe(0);
  });

  test("cleans up a failed stream so a later subscription can retry", async () => {
    let starts = 0;
    const broker = new BrowserPreviewStreamBroker(async () => {
      starts += 1;
      if (starts === 1) throw new Error("CDP unavailable");
      return async () => undefined;
    });
    const options = { quality: 58, maxWidth: 960, maxHeight: 640, everyNthFrame: 1 };

    await expect(broker.subscribe("page-1", options, () => undefined)).rejects.toThrow(
      "CDP unavailable"
    );
    expect(broker.activeStreamCount()).toBe(0);

    const unsubscribe = await broker.subscribe("page-1", options, () => undefined);
    expect(starts).toBe(2);
    await unsubscribe();
  });
});
