import { afterEach, describe, expect, test } from "bun:test";
import { config, DEFAULT_SPEECH_SETTINGS } from "../../src/core/config";
import { tables } from "../../src/core/database";
import {
  createRealtimeVoiceSession,
  getRealtimeVoiceStatus,
  normalizeRealtimeServerUrl,
  testRealtimeVoiceConnection,
} from "../../src/core/realtime-voice";

const providerIds: string[] = [];

function createProvider(provider: string, apiKey: string): string {
  const id = `realtime-voice-${crypto.randomUUID()}`;
  tables.providers.create({
    id,
    provider,
    name: `Realtime ${provider}`,
    api_key: apiKey,
    is_default: false,
  });
  providerIds.push(id);
  return id;
}

function setRealtime(realtime: Partial<(typeof DEFAULT_SPEECH_SETTINGS)["realtime"]>): void {
  config.setSpeechSettings({
    ...DEFAULT_SPEECH_SETTINGS,
    realtime: { ...DEFAULT_SPEECH_SETTINGS.realtime, ...realtime },
  });
}

afterEach(() => {
  for (const id of providerIds.splice(0)) tables.providers.delete(id);
  config.setSpeechSettings(DEFAULT_SPEECH_SETTINGS);
});

describe("realtime voice", () => {
  test("reports managed hands-free mode as ready without credentials", () => {
    expect(getRealtimeVoiceStatus(DEFAULT_SPEECH_SETTINGS.realtime)).toEqual({
      provider: "managed",
      ready: true,
      transport: "managed",
      model: "",
      voice: "",
      serverUrl: null,
      error: null,
    });
  });

  test("validates self-hosted server URLs without embedded credentials", () => {
    expect(normalizeRealtimeServerUrl("wss://voice.example.test/live/")).toBe(
      "wss://voice.example.test/live"
    );
    expect(() => normalizeRealtimeServerUrl("ftp://voice.example.test")).toThrow();
    expect(() => normalizeRealtimeServerUrl("https://user:secret@voice.example.test")).toThrow();
  });

  test("mints an OpenAI client secret without returning the provider key", async () => {
    const providerId = createProvider("openai", "sk-long-lived-secret");
    setRealtime({ provider: "openai", providerId, model: "gpt-realtime", voice: "marin" });
    let authorization = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return Response.json({ value: "ek-short-lived", expires_at: 1_900_000_000 });
    };

    const session = await createRealtimeVoiceSession(fetchImpl);

    expect(authorization).toBe("Bearer sk-long-lived-secret");
    expect(session.credential).toBe("ek-short-lived");
    expect(JSON.stringify(session)).not.toContain("sk-long-lived-secret");
    expect(session.transport).toBe("webrtc");
  });

  test("mints a constrained Gemini Live token", async () => {
    const providerId = createProvider("google", "gemini-long-lived-secret");
    setRealtime({ provider: "gemini", providerId, model: "gemini-live", voice: "Aoede" });
    let requestBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >;
      return Response.json({ name: "auth_tokens/short-lived" });
    };

    const session = await createRealtimeVoiceSession(fetchImpl);

    expect(session.credential).toBe("auth_tokens/short-lived");
    expect(session.transport).toBe("websocket");
    expect(JSON.stringify(requestBody)).toContain("gemini-live");
    expect(JSON.stringify(session)).not.toContain("gemini-long-lived-secret");
  });

  test("tests a Moshi-compatible server without requiring a provider", async () => {
    setRealtime({ provider: "moshi", serverUrl: "https://voice.example.test" });
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 });

    const result = await testRealtimeVoiceConnection(fetchImpl);

    expect(result.provider).toBe("moshi");
    expect(result.detail).toContain("voice.example.test");
  });
});
