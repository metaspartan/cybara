import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { getMediaProvider } from "../../src/core/media-generation";
import { registerMuapiProviders } from "../../src/core/media-providers";

const originalApiKey = process.env.MUAPI_API_KEY;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockImmediateTimers() {
  return spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
    if (typeof handler === "function") handler();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
}

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.MUAPI_API_KEY;
  else process.env.MUAPI_API_KEY = originalApiKey;
});

describe("MuAPI media provider", () => {
  test("submits an image and polls the creation response result URL", async () => {
    process.env.MUAPI_API_KEY = "muapi-test-key";
    registerMuapiProviders();
    const resultUrl = "https://api.muapi.ai/api/v1/predictions/image-1/result?source=creation";
    const responses = [
      jsonResponse({
        request_id: "image-1",
        status: "processing",
        output: { urls: { get: resultUrl } },
      }),
      jsonResponse({ status: "completed", outputs: ["https://cdn.example.test/image.png"] }),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push([input, init]);
      const response = responses.shift();
      if (!response) throw new Error("unexpected MuAPI request");
      return response;
    });
    const timerSpy = mockImmediateTimers();

    try {
      const result = await getMediaProvider("image", "muapi").generate({
        provider: "muapi",
        model: "nano-banana",
        prompt: "a cinematic mountain lake",
        aspectRatio: "16:9",
        timeoutMs: 1000,
      });

      expect(result).toEqual({
        assets: [{ url: "https://cdn.example.test/image.png", mimeType: "image/png" }],
        model: "nano-banana",
      });
      expect(calls).toHaveLength(2);
      expect(String(calls[0]?.[0])).toBe("https://api.muapi.ai/api/v1/nano-banana");
      expect(String(calls[1]?.[0])).toBe(resultUrl);
      const submitInit = calls[0]?.[1];
      expect(new Headers(submitInit?.headers).get("x-api-key")).toBe("muapi-test-key");
      expect(new Headers(calls[1]?.[1]?.headers).get("x-api-key")).toBe("muapi-test-key");
      expect(JSON.parse(String(submitInit?.body))).toEqual({
        prompt: "a cinematic mountain lake",
        aspect_ratio: "16:9",
      });
    } finally {
      timerSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  test("uses the documented prediction endpoint when the creation response omits urls", async () => {
    process.env.MUAPI_API_KEY = "muapi-test-key";
    registerMuapiProviders();
    const calls: string[] = [];
    const responses = [
      jsonResponse({ request_id: "video-1", status: "processing" }),
      jsonResponse({
        status: "completed",
        output: { video: { url: "https://cdn.example.test/video.mp4" } },
      }),
    ];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls.push(String(input));
      const response = responses.shift();
      if (!response) throw new Error("unexpected MuAPI request");
      return response;
    });
    const timerSpy = mockImmediateTimers();

    try {
      const result = await getMediaProvider("video", "muapi").generate({
        provider: "muapi",
        model: "wan3.0-text-to-video",
        prompt: "a slow camera move through a forest",
        durationSeconds: 5,
        audio: true,
        providerOptions: { resolution: "720p", aspect_ratio: "16:9" },
        timeoutMs: 1000,
      });

      expect(result.assets).toEqual([
        { url: "https://cdn.example.test/video.mp4", mimeType: "video/mp4" },
      ]);
      expect(calls).toEqual([
        "https://api.muapi.ai/api/v1/wan3.0-text-to-video",
        "https://api.muapi.ai/api/v1/predictions/video-1/result",
      ]);
    } finally {
      timerSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  test("maps music fields and returns an audio asset", async () => {
    process.env.MUAPI_API_KEY = "muapi-test-key";
    registerMuapiProviders();
    const responses = [
      jsonResponse({
        request_id: "music-1",
        status: "completed",
        outputs: ["https://cdn.example.test/song.mp3"],
      }),
    ];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected MuAPI request");
      return response;
    });

    try {
      const result = await getMediaProvider("music", "muapi").generate({
        provider: "muapi",
        prompt: "an upbeat synth-pop anthem",
        lyrics: "[Verse] Walking through the city lights",
        instrumental: false,
        timeoutMs: 1000,
      });

      expect(result.assets).toEqual([
        { url: "https://cdn.example.test/song.mp3", mimeType: "audio/mpeg" },
      ]);
      const init = fetchSpy.mock.calls[0]?.[1];
      expect(JSON.parse(String(init?.body))).toEqual({
        prompt: "an upbeat synth-pop anthem",
        lyrics: "[Verse] Walking through the city lights",
        is_instrumental: false,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("rejects a result URL that would send the API key to another origin", async () => {
    process.env.MUAPI_API_KEY = "muapi-test-key";
    registerMuapiProviders();
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        request_id: "unsafe-1",
        status: "processing",
        output: { urls: { get: "https://example.test/steal-key" } },
      })
    );

    try {
      await expect(
        getMediaProvider("image", "muapi").generate({
          provider: "muapi",
          prompt: "test",
          timeoutMs: 1000,
        })
      ).rejects.toThrow("invalid result URL");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
