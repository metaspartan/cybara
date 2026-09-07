import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { cybaraDir } from "../../src/core/paths";
import {
  isViewedMediaPath,
  isViewedMediaSnapshot,
  registerViewedMediaPath,
  snapshotViewedMedia,
} from "../../src/core/viewed-media";

const renderDir = join(cybaraDir, "test_viewed_media_renders");
const renderPath = join(renderDir, "front_34.png");
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("viewed media registry", () => {
  beforeAll(() => {
    mkdirSync(renderDir, { recursive: true });
    writeFileSync(renderPath, pngBytes);
  });

  afterAll(() => {
    if (existsSync(renderDir)) rmSync(renderDir, { recursive: true, force: true });
  });

  test("snapshots viewed renders into the media dir and survives the original being deleted", () => {
    const snapshot = snapshotViewedMedia(renderPath);
    expect(snapshot).toBeDefined();
    expect(isViewedMediaSnapshot(snapshot!)).toBe(true);
    expect(snapshot!.startsWith(join(cybaraDir, "media", "viewed"))).toBe(true);
    expect(basename(snapshot!)).toBe("front_34.png");
    expect(snapshotViewedMedia(renderPath)).toBe(snapshot);
    expect(snapshotViewedMedia(snapshot!)).toBe(snapshot);
    rmSync(renderPath);
    expect(readFileSync(snapshot!).equals(pngBytes)).toBe(true);
    expect(snapshotViewedMedia(renderPath)).toBeUndefined();
    expect(snapshotViewedMedia("data:image/png;base64,AAAA")).toBeUndefined();
  });

  test("remembers local image paths the agent viewed and ignores remote or inline sources", () => {
    const viewed = join(cybaraDir, "test_viewed_media", "render.png");
    expect(isViewedMediaPath(viewed)).toBe(false);
    registerViewedMediaPath(viewed);
    expect(isViewedMediaPath(viewed)).toBe(true);
    expect(
      isViewedMediaPath(
        join(cybaraDir, "test_viewed_media", "..", "test_viewed_media", "render.png")
      )
    ).toBe(true);
    registerViewedMediaPath("data:image/png;base64,AAAA");
    registerViewedMediaPath("https://example.com/render.png");
    expect(isViewedMediaPath("data:image/png;base64,AAAA")).toBe(false);
    expect(isViewedMediaPath("https://example.com/render.png")).toBe(false);
  });
});
