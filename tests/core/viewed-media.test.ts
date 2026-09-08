import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { PNG } from "pngjs";
import { cybaraDir } from "../../src/core/paths";
import {
  configureViewedMediaSnapshotsForTests,
  isViewedMediaSnapshot,
  snapshotViewedMedia,
  viewedMediaSnapshotCacheSizeForTests,
} from "../../src/core/viewed-media";
import { tinyBmp, tinyTiff } from "../helpers/image-fixtures";

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

  test("copies viewed renders under the served media root so they survive deletion", async () => {
    const snapshot = defined(await snapshotViewedMedia(renderPath), "snapshot");
    expect(isViewedMediaSnapshot(snapshot)).toBe(true);
    expect(snapshot.startsWith(join(cybaraDir, "media", "viewed"))).toBe(true);
    expect(basename(snapshot)).toBe("front_34.png");
    expect(await snapshotViewedMedia(renderPath)).toBe(snapshot);
    expect(await snapshotViewedMedia(snapshot)).toBe(snapshot);
    rmSync(renderPath);
    expect(readFileSync(snapshot).equals(pngBytes)).toBe(true);
    expect(await snapshotViewedMedia(renderPath)).toBeUndefined();
  });

  test("decodes TIFF and BMP sources into PNG snapshots the browser and model can use", async () => {
    const tiffPath = join(renderDir, "scan.tiff");
    const bmpPath = join(renderDir, "scan.bmp");
    const pixels: Array<[number, number, number]> = [
      [255, 0, 0],
      [0, 255, 0],
    ];
    writeFileSync(tiffPath, tinyTiff(pixels, 2, 1));
    writeFileSync(bmpPath, tinyBmp(pixels, 2, 1));
    const tiffSnapshot = defined(await snapshotViewedMedia(tiffPath), "tiff snapshot");
    const bmpSnapshot = defined(await snapshotViewedMedia(bmpPath), "bmp snapshot");
    expect(basename(tiffSnapshot)).toBe("scan.png");
    expect(basename(bmpSnapshot)).toBe("scan.png");
    expect(tiffSnapshot).not.toBe(bmpSnapshot);
    for (const snapshot of [tiffSnapshot, bmpSnapshot]) {
      const png = PNG.sync.read(readFileSync(snapshot));
      expect([png.width, png.height]).toEqual([2, 1]);
      expect(Array.from(png.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    }
    writeFileSync(join(renderDir, "broken.tiff"), Buffer.from([0x49, 0x49, 0x2a, 0, 9, 9, 9, 9]));
    expect(await snapshotViewedMedia(join(renderDir, "broken.tiff"))).toBeUndefined();
  });

  test("refuses non-image sources so only renderable media is ingested", async () => {
    expect(await snapshotViewedMedia(secretPath)).toBeUndefined();
    expect(await snapshotViewedMedia(join(renderDir, "layers.psd"))).toBeUndefined();
    expect(await snapshotViewedMedia(join(renderDir, "missing.tiff"))).toBeUndefined();
    expect(await snapshotViewedMedia("data:image/png;base64,AAAA")).toBeUndefined();
    expect(await snapshotViewedMedia("https://example.com/render.png")).toBeUndefined();
    expect(await snapshotViewedMedia("   ")).toBeUndefined();
    expect(isViewedMediaSnapshot(secretPath)).toBe(false);
  });

  test("bounds the in-memory snapshot cache and forgets entries whose directory was pruned", async () => {
    if (existsSync(isolatedRoot)) rmSync(isolatedRoot, { recursive: true, force: true });
    configureViewedMediaSnapshotsForTests({ maxDirs: 2, pruneEvery: 1, root: isolatedRoot });
    const paths = ["one", "two", "three"].map((name) => {
      const path = join(renderDir, `${name}.png`);
      writeFileSync(path, Buffer.concat([pngBytes, Buffer.from(name)]));
      return path;
    });
    const first = defined(await snapshotViewedMedia(paths[0]), "first");
    expect(first.startsWith(isolatedRoot)).toBe(true);
    expect(await snapshotViewedMedia(paths[0])).toBe(first);
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(1);
    const second = defined(await snapshotViewedMedia(paths[1]), "second");
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(2);
    expect(existsSync(first)).toBe(true);
    const third = defined(await snapshotViewedMedia(paths[2]), "third");
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(2);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
    expect(existsSync(third)).toBe(true);
    const firstRecopied = defined(await snapshotViewedMedia(paths[0]), "firstRecopied");
    expect(firstRecopied).not.toBe(first);
    expect(viewedMediaSnapshotCacheSizeForTests()).toBe(2);
    configureViewedMediaSnapshotsForTests();
  });

  test("converts viewed HEIC to a browser-renderable JPEG snapshot and copies AVIF as-is", async () => {
    const heicPath = join(renderDir, "IMG_0001.HEIC");
    writeFileSync(heicPath, Buffer.from("0000001866747970686569630000000068656963", "hex"));
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    let converted: Uint8Array | undefined;
    const snapshot = defined(
      await snapshotViewedMedia(heicPath, async (options) => {
        converted = options.buffer;
        expect(options.format).toBe("JPEG");
        return jpegBytes;
      }),
      "heic snapshot"
    );
    expect(Buffer.from(converted ?? []).equals(readFileSync(heicPath))).toBe(true);
    expect(basename(snapshot)).toBe("IMG_0001.jpg");
    expect(readFileSync(snapshot).equals(jpegBytes)).toBe(true);
    const brokenHeicPath = join(renderDir, "IMG_0002.heic");
    writeFileSync(brokenHeicPath, Buffer.from("0000001866747970686569630000000068656963", "hex"));
    expect(
      await snapshotViewedMedia(brokenHeicPath, async () => {
        throw new Error("decoder unavailable");
      })
    ).toBeUndefined();

    const avifPath = join(renderDir, "clip.avif");
    writeFileSync(avifPath, Buffer.from("avif-bytes"));
    const avifSnapshot = defined(await snapshotViewedMedia(avifPath), "avif snapshot");
    expect(basename(avifSnapshot)).toBe("clip.avif");
    expect(readFileSync(avifSnapshot).toString()).toBe("avif-bytes");
  });
});
