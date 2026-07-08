import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, rmSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  persistImageAttachments,
  attachmentsToImages,
  hydrateImageDataFromPath,
} from "../../src/core/chat/attachments";
import { cybaraDir } from "../../src/core/paths";

const sessionId = "test-attach-session-1234";
const sessionDir = join(cybaraDir, "attachments", sessionId);
const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

describe("chat attachments persistence", () => {
  afterAll(() => {
    if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("persists inline image data to a per-session dir and returns a path ref", () => {
    const refs = persistImageAttachments(sessionId, [{ data: pngBase64, mimeType: "image/png" }]);
    expect(refs.length).toBe(1);
    expect(refs[0].kind).toBe("image");
    expect(refs[0].path).toMatch(new RegExp(`^attachments/${sessionId}/[0-9a-f-]+\\.png$`));
    const abs = resolve(cybaraDir, refs[0].path!);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).toString("base64")).toBe(pngBase64);
  });

  test("keeps url-only images as url refs (no file written)", () => {
    const refs = persistImageAttachments(sessionId, [
      { url: "https://example.com/a.png", mimeType: "image/png" },
    ]);
    expect(refs[0]).toEqual({ kind: "image", url: "https://example.com/a.png", mimeType: "image/png" });
  });

  test("rejects unsafe session ids (traversal) — writes nothing", () => {
    expect(persistImageAttachments("../evil", [{ data: pngBase64 }])).toEqual([]);
    expect(persistImageAttachments("a/b", [{ data: pngBase64 }])).toEqual([]);
    expect(persistImageAttachments("..", [{ data: pngBase64 }])).toEqual([]);
  });

  test("attachmentsToImages normalizes stored refs", () => {
    const images = attachmentsToImages([
      { kind: "image", path: "attachments/x/y.png", mimeType: "image/png" },
      { kind: "image", url: "https://e/x.png" },
      { garbage: true },
      null,
    ]);
    expect(images).toEqual([
      { path: "attachments/x/y.png", mimeType: "image/png" },
      { url: "https://e/x.png", mimeType: undefined },
    ]);
  });

  test("hydrateImageDataFromPath loads base64 back for a valid path, ignores traversal", () => {
    const refs = persistImageAttachments(sessionId, [{ data: pngBase64, mimeType: "image/png" }]);
    const hydrated = hydrateImageDataFromPath({ path: refs[0].path, mimeType: "image/png" });
    expect(hydrated.data).toBe(pngBase64);

    const escaped = hydrateImageDataFromPath({ path: "attachments/../../etc/passwd" });
    expect(escaped.data).toBeUndefined();

    const nonAttach = hydrateImageDataFromPath({ path: "screenshots/x.png" });
    expect(nonAttach.data).toBeUndefined();
  });

  test("does not overwrite data when already present", () => {
    const hydrated = hydrateImageDataFromPath({ data: "abc", path: "attachments/x/y.png" });
    expect(hydrated.data).toBe("abc");
  });
});
