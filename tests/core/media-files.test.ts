import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { resolveMediaFile } from "../../src/core/runtime/media-files";
import { cybaraDir } from "../../src/core/paths";

const screenshotsDir = join(cybaraDir, "screenshots");
const mediaDir = join(cybaraDir, "media");
const sampleName = "test_media_files_sample.png";
const samplePath = join(screenshotsDir, sampleName);
const audioName = "test_media_files_tts.m4a";
const audioPath = join(mediaDir, audioName);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const audioBytes = Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]);

describe("resolveMediaFile", () => {
  beforeAll(() => {
    mkdirSync(screenshotsDir, { recursive: true });
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(samplePath, pngBytes);
    writeFileSync(audioPath, audioBytes);
  });

  afterAll(() => {
    if (existsSync(samplePath)) rmSync(samplePath);
    if (existsSync(audioPath)) rmSync(audioPath);
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
});
