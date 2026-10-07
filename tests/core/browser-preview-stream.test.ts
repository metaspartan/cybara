import { describe, expect, test } from "bun:test";
import {
  BROWSER_PREVIEW_STREAM_FRAME_MS,
  BrowserPreviewStreamBroker,
} from "../../src/core/browser/preview-stream";

function jpegFrame(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from(label, "utf8"),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function frameLabel(frame: Buffer): string {
  return frame.subarray(2, frame.length - 2).toString("utf8");
}

describe("browser preview stream", () => {
  test("paces the production stream at display refresh cadence", () => {
    expect(BROWSER_PREVIEW_STREAM_FRAME_MS).toBe(16);
  });

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
    const options = {
      quality: 58,
      maxWidth: 960,
      maxHeight: 640,
      everyNthFrame: 1,
    };
    const firstFrames: string[] = [];
    const secondFrames: string[] = [];
    const unsubscribeFirst = await broker.subscribe("page-1", options, (frame) => {
      firstFrames.push(frameLabel(frame));
    });
    emit?.(jpegFrame("frame-1").toString("base64"));
    const unsubscribeSecond = await broker.subscribe("page-1", options, (frame) => {
      secondFrames.push(frameLabel(frame));
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
    const options = {
      quality: 58,
      maxWidth: 960,
      maxHeight: 640,
      everyNthFrame: 1,
    };

    await expect(broker.subscribe("page-1", options, () => undefined)).rejects.toThrow(
      "CDP unavailable"
    );
    expect(broker.activeStreamCount()).toBe(0);

    const unsubscribe = await broker.subscribe("page-1", options, () => undefined);
    expect(starts).toBe(2);
    await unsubscribe();
  });

  test("does not publish a paced frame after stream startup fails", async () => {
    let emit: ((frame: string) => void) | null = null;
    const frames: string[] = [];
    const broker = new BrowserPreviewStreamBroker(async (_pageId, _options, listener) => {
      emit = listener;
      listener(jpegFrame("frame-1").toString("base64"));
      listener(jpegFrame("frame-2").toString("base64"));
      throw new Error("startup failed");
    }, 20);
    const options = {
      quality: 58,
      maxWidth: 960,
      maxHeight: 640,
      everyNthFrame: 1,
    };

    await expect(
      broker.subscribe("page-1", options, (frame) => frames.push(frameLabel(frame)))
    ).rejects.toThrow("startup failed");
    emit?.(jpegFrame("frame-3").toString("base64"));
    await Bun.sleep(30);

    expect(frames).toEqual(["frame-1"]);
    expect(broker.activeStreamCount()).toBe(0);
  });

  test("paces frame delivery and publishes only the newest pending frame", async () => {
    let emit: ((frame: string) => void) | null = null;
    const broker = new BrowserPreviewStreamBroker(async (_pageId, _options, listener) => {
      emit = listener;
      return async () => undefined;
    }, 20);
    const options = {
      quality: 58,
      maxWidth: 960,
      maxHeight: 640,
      everyNthFrame: 1,
    };
    const frames: string[] = [];
    const unsubscribe = await broker.subscribe("page-1", options, (frame) => {
      frames.push(frameLabel(frame));
    });

    emit?.(jpegFrame("frame-1").toString("base64"));
    emit?.(jpegFrame("frame-2").toString("base64"));
    emit?.(jpegFrame("frame-3").toString("base64"));
    expect(frames).toEqual(["frame-1"]);
    await Bun.sleep(30);
    expect(frames).toEqual(["frame-1", "frame-3"]);
    await unsubscribe();
  });

  test("injects one fresh frame after a viewport resize without restarting the stream", async () => {
    let starts = 0;
    let stops = 0;
    let captures = 0;
    const broker = new BrowserPreviewStreamBroker(async () => {
      starts += 1;
      return async () => {
        stops += 1;
      };
    });
    const options = {
      quality: 58,
      maxWidth: 1600,
      maxHeight: 1200,
      everyNthFrame: 1,
    };
    const frames: string[] = [];
    const unsubscribe = await broker.subscribe("page-1", options, (frame) => {
      frames.push(frameLabel(frame));
    });

    const refreshed = await broker.refresh("page-1", async (captureOptions) => {
      captures += 1;
      expect(captureOptions).toEqual(options);
      return jpegFrame("resized-frame");
    });

    expect(refreshed).toBe(1);
    expect(captures).toBe(1);
    expect(frames).toEqual(["resized-frame"]);
    expect(starts).toBe(1);
    expect(stops).toBe(0);
    await unsubscribe();
    expect(stops).toBe(1);
  });

  test("does not capture when the resized page has no subscribers", async () => {
    let captures = 0;
    const broker = new BrowserPreviewStreamBroker(async () => async () => undefined);

    const refreshed = await broker.refresh("page-1", async () => {
      captures += 1;
      return Buffer.from("unused");
    });

    expect(refreshed).toBe(0);
    expect(captures).toBe(0);
  });
});
