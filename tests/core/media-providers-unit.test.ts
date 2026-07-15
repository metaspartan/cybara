import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getMediaProvider,
  isConfigured,
  listMediaProviders,
  resolveDefaultProvider,
} from "../../src/core/media-generation";
import { registerFalProviders, registerOpenAIImageProvider } from "../../src/core/media-providers";

const MEDIA_ENV_KEYS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_BASE_URL",
  "FAL_KEY",
  "FAL_API_KEY",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of MEDIA_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Idempotent re-registration; the module also registers these at import.
  registerOpenAIImageProvider();
  registerFalProviders();
});

afterEach(() => {
  for (const k of MEDIA_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("media provider registration + listing", () => {
  test("built-in providers are registered for each kind", () => {
    expect(listMediaProviders("image")).toEqual(expect.arrayContaining(["openai", "fal"]));
    expect(listMediaProviders("video")).toEqual(expect.arrayContaining(["fal"]));
    expect(listMediaProviders("music")).toEqual(expect.arrayContaining(["fal"]));
  });
});

describe("media provider selection", () => {
  test("getMediaProvider resolves canonical ids", () => {
    expect(getMediaProvider("image", "openai").id).toBe("openai");
    expect(getMediaProvider("image", "fal").id).toBe("fal");
    expect(getMediaProvider("video", "fal").id).toBe("fal");
    expect(getMediaProvider("music", "fal").id).toBe("fal");
  });

  test("id resolution is case-insensitive and trims whitespace", () => {
    expect(getMediaProvider("image", "  OpenAI  ").id).toBe("openai");
    expect(getMediaProvider("image", "FAL").id).toBe("fal");
  });

  test("aliases resolve to the canonical provider", () => {
    // OpenAI image provider declares aliases dall-e / gpt-image.
    expect(getMediaProvider("image", "dall-e").id).toBe("openai");
    expect(getMediaProvider("image", "gpt-image").id).toBe("openai");
  });

  test("unknown provider throws a descriptive error", () => {
    expect(() => getMediaProvider("image", "no-such-provider")).toThrow(
      /Unknown image generation provider/
    );
    expect(() => getMediaProvider("video", "openai")).toThrow(/Unknown video/);
  });

  test("garbage ids throw cleanly, not crash", () => {
    for (const bad of ["", "  ", "🚀", "../../etc", "'; DROP TABLE x; --", "\n"]) {
      expect(() => getMediaProvider("image", bad)).toThrow(/Unknown image/);
    }
  });
});

describe("media provider config resolution (isConfigured)", () => {
  test("openai image is not configured without a key", () => {
    expect(isConfigured(getMediaProvider("image", "openai"))).toBe(false);
  });

  test("openai image becomes configured with OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isConfigured(getMediaProvider("image", "openai"))).toBe(true);
  });

  test("openai image accepts CODEX_API_KEY fallback", () => {
    process.env.CODEX_API_KEY = "codex-test";
    expect(isConfigured(getMediaProvider("image", "openai"))).toBe(true);
  });

  test("fal is not configured without a key", () => {
    expect(isConfigured(getMediaProvider("image", "fal"))).toBe(false);
    expect(isConfigured(getMediaProvider("video", "fal"))).toBe(false);
    expect(isConfigured(getMediaProvider("music", "fal"))).toBe(false);
  });

  test("fal becomes configured with FAL_KEY or FAL_API_KEY", () => {
    process.env.FAL_KEY = "fal-test";
    expect(isConfigured(getMediaProvider("image", "fal"))).toBe(true);
    delete process.env.FAL_KEY;
    process.env.FAL_API_KEY = "fal-alt";
    expect(isConfigured(getMediaProvider("video", "fal"))).toBe(true);
  });
});

describe("resolveDefaultProvider fallback behavior", () => {
  test("returns a provider from the active registry", () => {
    const registered = listMediaProviders("image");
    const p = resolveDefaultProvider("image");

    expect(p).not.toBeNull();
    expect(registered).toContain(p?.id);
  });

  test("prefers a configured provider", () => {
    process.env.FAL_KEY = "fal-test";
    const p = resolveDefaultProvider("video");
    expect(p?.id).toBe("fal");
    expect(isConfigured(p!)).toBe(true);
  });

  test("never throws for any kind", () => {
    for (const kind of ["image", "video", "music"] as const) {
      expect(() => resolveDefaultProvider(kind)).not.toThrow();
      expect(resolveDefaultProvider(kind)).not.toBeNull();
    }
  });
});
