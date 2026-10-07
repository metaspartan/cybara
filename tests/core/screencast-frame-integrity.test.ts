import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeJpegFrameDefect,
  isCompleteJpegFrame,
} from "../../src/core/browser/screencast-frame-integrity";
import { BrowserPreviewStreamBroker } from "../../src/core/browser/preview-stream";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const OPTIONS = { quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 };

function jpeg(body: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from(body, "utf8"),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const TRUNCATED = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0x03]);
const NO_SOI = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd9]);

function collectBroker(emit: (push: (frame: string) => void) => void): Promise<Buffer[]> {
  const received: Buffer[] = [];
  const broker = new BrowserPreviewStreamBroker(async (_pageId, _options, listener) => {
    emit(listener);
    return async () => undefined;
  });
  return (async () => {
    const stop = await broker.subscribe("page-1", OPTIONS, (frame) => received.push(frame));
    await stop();
    return received;
  })();
}

describe("screencast frame integrity", () => {
  test("a complete JPEG is accepted", () => {
    expect(isCompleteJpegFrame(jpeg("payload"))).toBe(true);
    expect(describeJpegFrameDefect(jpeg("payload"))).toBe("frame is a complete JPEG");
  });

  test("a truncated frame is rejected", () => {
    expect(isCompleteJpegFrame(TRUNCATED)).toBe(false);
    expect(describeJpegFrameDefect(TRUNCATED)).toContain("truncated");
  });

  test("a non-JPEG payload is rejected", () => {
    expect(isCompleteJpegFrame(NO_SOI)).toBe(false);
    expect(describeJpegFrameDefect(NO_SOI)).toContain("start-of-image");
  });

  test("an empty or tiny frame is rejected", () => {
    expect(isCompleteJpegFrame(Buffer.alloc(0))).toBe(false);
    expect(isCompleteJpegFrame(Buffer.from([0xff, 0xd8]))).toBe(false);
  });

  test("a corrupt frame never reaches subscribers", async () => {
    const received = await collectBroker((push) => {
      push(TRUNCATED.toString("base64"));
    });
    expect(received).toEqual([]);
  });

  test("a valid frame is still delivered", async () => {
    const received = await collectBroker((push) => {
      push(jpeg("payload").toString("base64"));
    });
    expect(received).toHaveLength(1);
    expect(isCompleteJpegFrame(received[0])).toBe(true);
  });

  test("a corrupt frame does not block the next good frame", async () => {
    const received = await collectBroker((push) => {
      push(TRUNCATED.toString("base64"));
      push(jpeg("good").toString("base64"));
    });
    expect(received).toHaveLength(1);
    expect(received[0].toString("utf8")).toContain("good");
  });
});

describe("screencast session setup", () => {
  const source = readFileSync(join(REPO_ROOT, "src/core/browser/automation-driver.ts"), "utf8");

  test("the Page domain is enabled before the screencast starts", () => {
    const enableIndex = source.indexOf('await session.send("Page.enable")');
    const startIndex = source.indexOf('await session.send("Page.startScreencast"');
    expect(enableIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(-1);
    expect(enableIndex).toBeLessThan(startIndex);
  });

  test("screencast capture is configured for complete frames, not fast lossy ones", () => {
    const startIndex = source.indexOf('await session.send("Page.startScreencast"');
    const block = source.slice(startIndex, startIndex + 400);
    expect(block).toContain("optimizeForSpeed: false");
  });
});
