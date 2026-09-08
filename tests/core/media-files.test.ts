import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { cybaraDir } from "../../src/core/paths";
import { resolveMediaFile } from "../../src/core/runtime/media-files";
import { snapshotViewedMedia } from "../../src/core/viewed-media";

const screenshotsDir = join(cybaraDir, "screenshots");
const mediaDir = join(cybaraDir, "media");
const sampleName = "test_media_files_sample.png";
const samplePath = join(screenshotsDir, sampleName);
const audioName = "test_media_files_tts.m4a";
const audioPath = join(mediaDir, audioName);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const audioBytes = Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]);
const viewedDir = join(cybaraDir, "test_media_files_viewed_outside");
const viewedPath = join(viewedDir, "render.png");
const unviewedPath = join(viewedDir, "other.png");

describe("resolveMediaFile", () => {
  beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(samplePath, pngBytes);
    writeFileSync(audioPath, audioBytes);
    mkdirSync(viewedDir, { recursive: true });
    writeFileSync(viewedPath, pngBytes);
    writeFileSync(unviewedPath, pngBytes);
  });

  afterAll(() => {
    if (existsSync(samplePath)) rmSync(samplePath);
    if (existsSync(audioPath)) rmSync(audioPath);
    if (existsSync(viewedDir)) rmSync(viewedDir, { recursive: true, force: true });
  });

  test("never serves files outside the media roots, even after the agent views them", async () => {
    expect(resolveMediaFile(viewedPath).status).toBe(403);
    const snapshot = await snapshotViewedMedia(viewedPath);
    expect(snapshot).toBeDefined();
    expect(resolveMediaFile(viewedPath).status).toBe(403);
    expect(resolveMediaFile(unviewedPath).status).toBe(403);
    if (!snapshot) throw new Error("snapshot missing");
    const served = resolveMediaFile(snapshot);
    expect(served.status).toBe(200);
    expect(served.contentType).toBe("image/png");
    expect(served.bytes?.equals(pngBytes)).toBe(true);
  });

  test("serves a file inside an allowed subdir", () => {
    const result = resolveMediaFile(`screenshots/${sampleName}`);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("image/png");
    expect(result.bytes?.equals(pngBytes)).toBe(true);
  });

  test("serves synthesized speech audio from the media dir by relative and absolute path", () => {
    const relative = resolveMediaFile(`media/${audioName}`);
    expect(relative.status).toBe(200);
    expect(relative.contentType).toBe("audio/mp4");
    const absolute = resolveMediaFile(audioPath);
    expect(absolute.status).toBe(200);
    expect(absolute.bytes?.equals(audioBytes)).toBe(true);
  });

  test("rejects path traversal out of the cybara dir", () => {
    expect(resolveMediaFile("screenshots/../../etc/passwd").status).toBe(403);
    expect(resolveMediaFile("../../../etc/passwd").status).toBe(403);
    expect(resolveMediaFile("/etc/passwd").status).toBe(403);
    expect(resolveMediaFile(`media/../secure/wallet.json`).status).toBe(403);
    expect(resolveMediaFile(join(cybaraDir, "secure", "wallet.json")).status).toBe(403);
  });

  test("rejects non-allowlisted subdirs like the database", () => {
    expect(resolveMediaFile("data/platform.db").status).toBe(403);
    expect(resolveMediaFile("secure/wallet.json").status).toBe(403);
  });

  test("rejects symlinks from an allowed media directory to outside files", () => {
    const outsidePath = join(cybaraDir, "test_media_files_private.png");
    const linkPath = join(screenshotsDir, "test_media_files_link.png");
    writeFileSync(outsidePath, pngBytes);
    symlinkSync(outsidePath, linkPath);
    try {
      expect(resolveMediaFile(linkPath).status).toBe(403);
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outsidePath, { force: true });
    }
  });

  test("rejects unsupported extensions", () => {
    expect(resolveMediaFile("screenshots/notes.txt").status).toBe(415);
  });

  test("returns 404 for a missing but allowed path", () => {
    expect(resolveMediaFile("screenshots/does_not_exist.png").status).toBe(404);
  });

  test("rejects empty and null-byte paths", () => {
    expect(resolveMediaFile("").status).toBe(400);
    expect(resolveMediaFile("screenshots/a\0.png").status).toBe(400);
  });

  test("serves the newly supported browser-renderable formats with the right content type", () => {
    const cases: Array<[string, string]> = [
      ["test_media_files_sample.avif", "image/avif"],
      ["test_media_files_sample.bmp", "image/bmp"],
      ["test_media_files_sample.svg", "image/svg+xml"],
      ["test_media_files_sample.tiff", "image/tiff"],
      ["test_media_files_sample.tif", "image/tiff"],
    ];
    for (const [name, contentType] of cases) {
      const path = join(screenshotsDir, name);
      writeFileSync(path, "x");
      try {
        const result = resolveMediaFile(`screenshots/${name}`);
        expect(result.status).toBe(200);
        expect(result.contentType).toBe(contentType);
      } finally {
        rmSync(path);
      }
    }
    expect(resolveMediaFile("screenshots/nope.psd").status).toBe(415);
  });
});
