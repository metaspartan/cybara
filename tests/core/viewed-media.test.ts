import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { cybaraDir } from "../../src/core/paths";
import {
  configureViewedMediaSnapshotsForTests,
  isViewedMediaSnapshot,
  snapshotViewedMedia,
  viewedMediaSnapshotCacheSizeForTests,
} from "../../src/core/viewed-media";

const renderDir = join(cybaraDir, "test_viewed_media_renders");
const isolatedRoot = join(cybaraDir, "test_viewed_media_root");
const renderPath = join(renderDir, "front_34.png");
const secretPath = join(renderDir, "secret.txt");
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function defined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} was undefined`);
  return value;
}

describe("viewed media snapshots", () => {
  beforeAll(() => {
    mkdirSync(renderDir, { recursive: true });
    writeFileSync(renderPath, pngBytes);
    writeFileSync(secretPath, "top secret");
  });

  afterAll(() => {
    configureViewedMediaSnapshotsForTests();
    for (const dir of [renderDir, isolatedRoot]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("copies viewed renders under the served media root so they survive deletion", () => {
    const snapshot = defined(snapshotViewedMedia(renderPath), "snapshot");
    expect(isViewedMediaSnapshot(snapshot)).toBe(true);
    expect(snapshot.startsWith(join(cybaraDir, "media", "viewed"))).toBe(true);
    expect(basename(snapshot)).toBe("front_34.png");
    expect(snapshotViewedMedia(renderPath)).toBe(snapshot);
    expect(snapshotViewedMedia(snapshot)).toBe(snapshot);
    rmSync(renderPath);
    expect(readFileSync(snapshot).equals(pngBytes)).toBe(true);
    expect(snapshotViewedMedia(renderPath)).toBeUndefined();
  });

  test("refuses non-image sources so only renderable media is ingested", () => {
    expect(snapshotViewedMedia(secretPath)).toBeUndefined();
    expect(snapshotViewedMedia("data:image/png;base64,AAAA")).toBeUndefined();
    expect(snapshotViewedMedia("https://example.com/render.png")).toBeUndefined();
    expect(snapshotViewedMedia("   ")).toBeUndefined();
    expect(isViewedMediaSnapshot(secretPath)).toBe(false);
  });

  test("bounds the in-memory snapshot cache and forgets entries whose directory was pruned", () => {
    if (existsSync(isolatedRoot)) rmSync(isolatedRoot, { recursive: true, force: true });
    configureViewedMediaSnapshotsForTests({ maxDirs: 2, pruneEvery: 1, root: isolatedRoot });
    const paths = ["one", "two", "three"].map((name) => {
      const path = join(renderDir, `${name}.png`);
      writeFileSync(path, Buffer.concat([pngBytes, Buffer.from(name)]));
      return path;
    });
    const first = defined(snapshotViewedMedia(paths[0]), "first");
    expect(first.startsWith(isolatedRoot)).toBe(true);
    expect(snapshotViewedMedia(paths[0])).toBe(first);
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(1);
    const second = defined(snapshotViewedMedia(paths[1]), "second");
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(2);
    expect(existsSync(first)).toBe(true);
    const third = defined(snapshotViewedMedia(paths[2]), "third");
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(2);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
    expect(existsSync(third)).toBe(true);
    const firstRecopied = defined(snapshotViewedMedia(paths[0]), "firstRecopied");
    expect(firstRecopied).not.toBe(first);
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(2);
    configureViewedMediaSnapshotsForTests();
  });
});
