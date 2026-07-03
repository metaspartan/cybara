import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const providerState = {
  byId: new Map<string, Record<string, unknown>>(),
};

const configState = {
  speech: {
    tts: {
      provider: "auto",
      providerId: "",
      model: "",
      voice: "",
      outputFormat: "mp3",
      speed: 1,
      maxTextLength: 8000,
      fallbackToSystem: false,
    },
    stt: {
      provider: "auto",
      providerId: "",
      model: "",
      language: "",
    },
  },
};

mock.module("../../src/core/config", () => ({
  config: {
    getSpeechSettings: () => configState.speech,
  },
}));

mock.module("../../src/core/providers", () => ({
  providers: {
    elevenlabs: {
      name: "ElevenLabs",
      baseUrl: "https://api.elevenlabs.io/v1",
      api: "elevenlabs-speech",
      authType: "api_key",
      models: [],
    },
    openai: {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      api: "openai-responses",
      authType: "api_key",
      models: [],
    },
  },
  resolveProviderType: (value?: string) => {
    if (value === "elevenlabs" || value === "openai" || value === "openai-codex") return value;
    return undefined;
  },
  providerManager: {
    list: () =>
      Array.from(providerState.byId.values()).map((provider) => ({
        ...provider,
        api_key: undefined,
        access_token: undefined,
      })),
    getWithCredentials: (id: string) => providerState.byId.get(id),
  },
}));

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const tempHome = mkdtempSync(join(tmpdir(), "cybara-speech-test-"));
const speech = require("../../src/core/speech") as typeof import("../../src/core/speech");

beforeEach(() => {
  providerState.byId.clear();
  configState.speech.tts = {
    provider: "auto",
    providerId: "",
    model: "",
    voice: "",
    outputFormat: "mp3",
    speed: 1,
    maxTextLength: 8000,
    fallbackToSystem: false,
  };
  process.env.HOME = tempHome;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("speech TTS provider selection", () => {
  test("auto mode prefers configured ElevenLabs before OpenAI", () => {
    providerState.byId.set("openai-1", {
      id: "openai-1",
      provider: "openai",
      name: "OpenAI",
      api_key: "sk-test",
      is_default: true,
    });
    providerState.byId.set("eleven-1", {
      id: "eleven-1",
      provider: "elevenlabs",
      name: "ElevenLabs",
      api_key: "eleven-test",
      is_default: false,
    });

    const resolved = speech.resolveSpeechTtsProvider({});
    expect(resolved?.type).toBe("elevenlabs");
    expect(resolved?.provider.id).toBe("eleven-1");
  });

  test("explicit providerId must point at a speech-capable provider", () => {
    providerState.byId.set("anthropic-1", {
      id: "anthropic-1",
      provider: "anthropic",
      name: "Anthropic",
      api_key: "ant-test",
      is_default: false,
    });

    expect(() => speech.resolveSpeechTtsProvider({ providerId: "anthropic-1" })).toThrow(
      /ElevenLabs, OpenAI, or OpenAI Codex/
    );
  });
});

describe("speech synthesis requests", () => {
  test("synthesizeSpeech builds ElevenLabs TTS requests and writes private audio", async () => {
    providerState.byId.set("eleven-1", {
      id: "eleven-1",
      provider: "elevenlabs",
      name: "ElevenLabs",
      base_url: "https://api.elevenlabs.io/v1",
      api_key: "eleven-test",
      is_default: true,
    });
    configState.speech.tts.voice = "voice-abc";
    configState.speech.tts.model = "eleven_flash_v2_5";
    configState.speech.tts.speed = 1.2;

    const fetchCalls: Array<{ url: string; body?: string; headers: HeadersInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: init?.headers || {},
      });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;

    const result = await speech.synthesizeSpeech({ text: "Hello Cybara" });
    expect(result.provider).toBe("elevenlabs");
    expect(result.voice).toBe("voice-abc");
    expect(result.model).toBe("eleven_flash_v2_5");
    expect(result.audioPath).toContain(join(tempHome, ".cybara", "media"));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toContain("/text-to-speech/voice-abc");
    const headers = new Headers(fetchCalls[0]?.headers);
    expect(headers.get("xi-api-key")).toBe("eleven-test");
    const body = JSON.parse(fetchCalls[0]?.body || "{}") as Record<string, unknown>;
    expect(body.text).toBe("Hello Cybara");
    expect(body.model_id).toBe("eleven_flash_v2_5");
    expect((body.voice_settings as Record<string, unknown>).speed).toBe(1.2);
  });

  test("synthesizeSpeech builds OpenAI audio speech requests", async () => {
    providerState.byId.set("openai-1", {
      id: "openai-1",
      provider: "openai",
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-test",
      is_default: true,
    });
    configState.speech.tts.provider = "openai";
    configState.speech.tts.model = "gpt-4o-mini-tts";
    configState.speech.tts.voice = "nova";

    const fetchCalls: Array<{ url: string; body?: string; headers: HeadersInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: init?.headers || {},
      });
      return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    }) as typeof fetch;

    const result = await speech.synthesizeSpeech({ text: "Hello OpenAI", format: "wav" });
    expect(result.provider).toBe("openai");
    expect(result.voice).toBe("nova");
    expect(result.format).toBe("wav");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://api.openai.com/v1/audio/speech");
    const headers = new Headers(fetchCalls[0]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(fetchCalls[0]?.body || "{}") as Record<string, unknown>;
    expect(body.input).toBe("Hello OpenAI");
    expect(body.model).toBe("gpt-4o-mini-tts");
    expect(body.voice).toBe("nova");
    expect(body.response_format).toBe("wav");
  });
});
