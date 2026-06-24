import { describe, expect, test } from "bun:test";
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
});
