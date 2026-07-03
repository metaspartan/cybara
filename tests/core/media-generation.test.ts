import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getMediaProvider,
  isConfigured,
  listMediaProviders,
  registerImageProvider,
  registerMusicProvider,
  registerVideoProvider,
  resolveDefaultProvider,
  type ImageGenerationRequest,
  type MusicGenerationRequest,
  type VideoGenerationRequest,
} from "../../src/core/media-generation";
import { handleImageGenerate } from "../../src/core/tools/handlers/media-generation";

describe("media-generation registry", () => {
  test("ships built-in openai (image) and fal (image/video/music) providers", () => {
    expect(listMediaProviders("image")).toEqual(expect.arrayContaining(["openai", "fal"]));
    expect(listMediaProviders("video")).toContain("fal");
    expect(listMediaProviders("music")).toContain("fal");
  });

  test("getMediaProvider resolves aliases", () => {
    expect(getMediaProvider("image", "dall-e").id).toBe("openai");
    expect(getMediaProvider("image", "DALL-E").id).toBe("openai"); // case-insensitive
  });

  test("getMediaProvider throws for an unknown provider", () => {
    expect(() => getMediaProvider("image", "nope")).toThrow(/unknown image/i);
  });

  test("a custom provider can be registered and resolved", () => {
    registerImageProvider({
      id: "test-custom-img",
      isConfigured: () => true,
      generate: async (_req: ImageGenerationRequest) => ({ assets: [], model: "test" }),
    });
    expect(listMediaProviders("image")).toContain("test-custom-img");
    const p = getMediaProvider("image", "test-custom-img");
    expect(typeof p.generate).toBe("function");
  });

  test("video and music providers register independently", () => {
    registerVideoProvider({
      id: "test-vid",
      generate: async (_req: VideoGenerationRequest) => ({ assets: [] }),
    });
    registerMusicProvider({
      id: "test-music",
      generate: async (_req: MusicGenerationRequest) => ({ assets: [] }),
    });
    expect(listMediaProviders("video")).toContain("test-vid");
    expect(listMediaProviders("music")).toContain("test-music");
  });

  test("resolveDefaultProvider returns a provider when any is configured", () => {
    registerImageProvider({
      id: "test-default-configured",
      isConfigured: () => true,
      generate: async () => ({ assets: [] }),
    });
    expect(resolveDefaultProvider("image")).not.toBeNull();
  });

  test("isConfigured reflects the provider's readiness check", () => {
    registerImageProvider({
      id: "test-not-configured",
      isConfigured: () => false,
      generate: async () => ({ assets: [] }),
    });
    expect(isConfigured(getMediaProvider("image", "test-not-configured"))).toBe(false);
  });

  test("image generation blocks private asset URLs before fetch", async () => {
    const providerId = `test-private-asset-${Date.now()}`;
    registerImageProvider({
      id: providerId,
      isConfigured: () => true,
      generate: async () => ({
        assets: [
          {
            url: "http://127.0.0.1:4269/private.png",
            mimeType: "image/png",
            fileName: "private.png",
          },
        ],
      }),
    });

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as typeof fetch;

    try {
      await expect(
        handleImageGenerate(
          { provider: providerId, prompt: "asset url" },
          { workspaceDir: tmpdir() }
        )
      ).rejects.toThrow("media asset URL blocked");
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("image generation blocks private redirects from public asset URLs", async () => {
    const providerId = `test-private-redirect-${Date.now()}`;
    registerImageProvider({
      id: providerId,
      isConfigured: () => true,
      generate: async () => ({
        assets: [
          {
            url: "https://assets.example.test/generated.png",
            mimeType: "image/png",
            fileName: "generated.png",
          },
        ],
      }),
    });

    const originalFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (url) => {
      fetched.push(String(url));
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:4269/redirected.png" },
      });
    }) as typeof fetch;

    try {
      await expect(
        handleImageGenerate(
          { provider: providerId, prompt: "redirect" },
          { workspaceDir: tmpdir() }
        )
      ).rejects.toThrow("media asset URL blocked");
      expect(fetched).toEqual(["https://assets.example.test/generated.png"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("image generation sanitizes provider asset filenames before writing", async () => {
    const providerId = `test-safe-filename-${Date.now()}`;
    const tempWorkspace = mkdtempSync(join(tmpdir(), "cybara-media-handler-"));
    registerImageProvider({
      id: providerId,
      isConfigured: () => true,
      generate: async () => ({
        assets: [
          {
            buffer: Buffer.from("image-bytes").toString("base64"),
            mimeType: "image/png",
            fileName: "../escape.png",
          },
        ],
      }),
    });

    try {
      const result = await handleImageGenerate(
        { provider: providerId, prompt: "safe filename" },
        { workspaceDir: tempWorkspace }
      );
      const expectedPath = join(tempWorkspace, ".cybara", "media", "escape.png");
      expect(result.assets[0]?.path).toBe(expectedPath);
      expect(result.assets[0]?.path).not.toContain("..");
      expect(existsSync(expectedPath)).toBe(true);
      expect(readFileSync(expectedPath, "utf8")).toBe("image-bytes");
    } finally {
      rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });
});
