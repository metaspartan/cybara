import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { cybaraDir } from "../../src/core/paths";
import { handleImage } from "../../src/core/tools/handlers/channel";

const cleanupPaths: string[] = [];
let originalFetch: typeof fetch | undefined;

function trackPath(filePath: string): void {
  cleanupPaths.push(filePath);
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) {
      continue;
    }
    try {
      if (existsSync(target)) {
        rmSync(target, { force: true });
      }
    } catch {
      continue;
    }
  }

  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
});

describe("image tool path resolution", () => {
  test("resolves cached inbound media by original attachment filename", async () => {
    const inboundDir = path.join(cybaraDir, "media", "inbound", "discord");
    mkdirSync(inboundDir, { recursive: true });

    const originalName = `image-tool-resolution-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const storedName = `${Date.now()}-cached-${originalName}`;
    const storedPath = path.join(inboundDir, storedName);
    writeFileSync(storedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), { mode: 0o600 });
    trackPath(storedPath);

    const result = await handleImage({
      image: `<attachment:${originalName}>`,
      prompt: "Resolve inbound media path",
    });

    expect(result.image).toBe(storedPath);
    expect(result.description).toBe("Resolve inbound media path");
  });

  test("downloads direct image URLs to image-tool inbound storage", async () => {
    const inboundDir = path.join(cybaraDir, "media", "inbound", "image-tool");
    mkdirSync(inboundDir, { recursive: true });

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const result = await handleImage({
      image: "https://example.com/folder/remote-image.png",
      prompt: "Download remote image",
    });
    trackPath(result.image);

    expect(result.image.startsWith(`${inboundDir}${path.sep}`)).toBe(true);
    expect(existsSync(result.image)).toBe(true);
    expect(result.description).toBe("Download remote image");
  });
});
