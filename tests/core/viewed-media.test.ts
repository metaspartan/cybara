import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { cybaraDir } from "../../src/core/paths";
import { isViewedMediaSnapshot, snapshotViewedMedia } from "../../src/core/viewed-media";

const renderDir = join(cybaraDir, "test_viewed_media_renders");
const renderPath = join(renderDir, "front_34.png");
const secretPath = join(renderDir, "secret.txt");
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("viewed media snapshots", () => {
  beforeAll(() => {
    mkdirSync(renderDir, { recursive: true });
    writeFileSync(renderPath, pngBytes);
    writeFileSync(secretPath, "top secret");
  });

  afterAll(() => {
    if (existsSync(renderDir)) rmSync(renderDir, { recursive: true, force: true });
  });

  test("copies viewed renders under the served media root so they survive deletion", () => {
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
  });

  test("refuses non-image sources so only renderable media is ingested", () => {
    expect(snapshotViewedMedia(secretPath)).toBeUndefined();
    expect(snapshotViewedMedia("data:image/png;base64,AAAA")).toBeUndefined();
    expect(snapshotViewedMedia("https://example.com/render.png")).toBeUndefined();
    expect(snapshotViewedMedia("   ")).toBeUndefined();
    expect(isViewedMediaSnapshot(secretPath)).toBe(false);
  });
});
