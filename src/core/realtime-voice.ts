import { tables, type Provider } from "./database";
import { config, type SpeechRealtimeProvider, type SpeechRealtimeSettings } from "./config";

export interface RealtimeVoiceStatus {
  provider: SpeechRealtimeProvider;
  ready: boolean;
  transport: "managed" | "webrtc" | "websocket";
  model: string;
  voice: string;
  serverUrl: string | null;
  error: string | null;
}

export interface RealtimeVoiceSession {
  provider: Exclude<SpeechRealtimeProvider, "managed">;
  transport: "webrtc" | "websocket";
  model: string;
  voice: string;
  endpoint: string;
  credential?: string;
  expiresAt?: string;
}

type FetchLike = typeof fetch;

function providerRows(): Provider[] {
  return (tables.providers.all() as Provider[]) || [];
}

function providerMatchesRealtime(provider: Provider, target: SpeechRealtimeProvider): boolean {
  const type = provider.provider.toLowerCase();
  if (target === "openai") return type === "openai" && !!provider.api_key;
  if (target === "gemini") {
    return ["google", "gemini", "google-ai", "google_ai"].includes(type) && !!provider.api_key;
  }
  return false;
}

function resolveCredentialProvider(settings: SpeechRealtimeSettings): Provider | null {
  const rows = providerRows();
  if (settings.providerId) {
    const selected = rows.find((provider) => provider.id === settings.providerId);
    return selected && providerMatchesRealtime(selected, settings.provider) ? selected : null;
  }
  return rows.find((provider) => providerMatchesRealtime(provider, settings.provider)) || null;
}

function realtimeDefaults(settings: SpeechRealtimeSettings): { model: string; voice: string } {
  if (settings.provider === "openai") {
    return { model: settings.model || "gpt-realtime-2", voice: settings.voice || "marin" };
  }
  if (settings.provider === "gemini") {
    return {
      model: settings.model || "gemini-3.1-flash-live-preview",
      voice: settings.voice || "Aoede",
    };
  }
  return { model: settings.model || "moshika", voice: settings.voice || "Moshika" };
}

export function normalizeRealtimeServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A Moshi server URL is required");
  const parsed = new URL(trimmed);
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("Moshi server URL must use HTTP, HTTPS, WS, or WSS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Moshi server URL cannot contain embedded credentials");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function getRealtimeVoiceStatus(
  settings = config.getSpeechSettings().realtime
): RealtimeVoiceStatus {
  const defaults = realtimeDefaults(settings);
  if (settings.provider === "managed") {
    return {
      provider: "managed",
      ready: true,
      transport: "managed",
      model: "",
      voice: "",
      serverUrl: null,
      error: null,
    };
  }
  if (settings.provider === "moshi") {
    try {
      const serverUrl = normalizeRealtimeServerUrl(settings.serverUrl);
      return {
        provider: "moshi",
        ready: true,
        transport: "websocket",
        ...defaults,
        serverUrl,
        error: null,
      };
    } catch (error) {
      return {
        provider: "moshi",
        ready: false,
        transport: "websocket",
        ...defaults,
        serverUrl: null,
        error: error instanceof Error ? error.message : "Invalid Moshi server URL",
      };
    }
  }
  const provider = resolveCredentialProvider(settings);
  return {
    provider: settings.provider,
    ready: !!provider,
    transport: settings.provider === "openai" ? "webrtc" : "websocket",
    ...defaults,
    serverUrl: null,
    error: provider ? null : `No ${settings.provider} API-key provider is configured`,
  };
}

function readErrorPayload(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "";
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value = (await response.json().catch(() => ({}))) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function createOpenAiSession(
  settings: SpeechRealtimeSettings,
  fetchImpl: FetchLike
): Promise<RealtimeVoiceSession> {
  const provider = resolveCredentialProvider(settings);
  if (!provider?.api_key) throw new Error("An OpenAI API-key provider is required");
  const defaults = realtimeDefaults(settings);
  const response = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: defaults.model,
        audio: { output: { voice: defaults.voice } },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await responseJson(response);
  if (!response.ok) {
    throw new Error(readErrorPayload(data) || `OpenAI Realtime returned HTTP ${response.status}`);
  }
  const nested =
    data.client_secret &&
    typeof data.client_secret === "object" &&
    !Array.isArray(data.client_secret)
      ? (data.client_secret as Record<string, unknown>)
      : {};
  const credential =
    typeof data.value === "string"
      ? data.value
      : typeof nested.value === "string"
        ? nested.value
        : "";
  if (!credential) throw new Error("OpenAI Realtime did not return a client secret");
  const expiresAtValue = data.expires_at ?? nested.expires_at;
  return {
    provider: "openai",
    transport: "webrtc",
    ...defaults,
    endpoint: "https://api.openai.com/v1/realtime/calls",
    credential,
    expiresAt:
      typeof expiresAtValue === "number"
        ? new Date(expiresAtValue * 1000).toISOString()
        : undefined,
  };
}

async function createGeminiSession(
  settings: SpeechRealtimeSettings,
  fetchImpl: FetchLike
): Promise<RealtimeVoiceSession> {
  const provider = resolveCredentialProvider(settings);
  if (!provider?.api_key) throw new Error("A Gemini API-key provider is required");
  const defaults = realtimeDefaults(settings);
  const now = Date.now();
  const expireTime = new Date(now + 30 * 60_000).toISOString();
  const newSessionExpireTime = new Date(now + 60_000).toISOString();
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${encodeURIComponent(provider.api_key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authToken: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: defaults.model,
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: defaults.voice } } },
              sessionResumption: {},
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  const data = await responseJson(response);
  if (!response.ok) {
    throw new Error(readErrorPayload(data) || `Gemini Live returned HTTP ${response.status}`);
  }
  const credential = typeof data.name === "string" ? data.name : "";
  if (!credential) throw new Error("Gemini Live did not return an ephemeral token");
  return {
    provider: "gemini",
    transport: "websocket",
    ...defaults,
    endpoint:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained",
    credential,
    expiresAt: typeof data.expireTime === "string" ? data.expireTime : expireTime,
  };
}

export async function createRealtimeVoiceSession(
  fetchImpl: FetchLike = fetch
): Promise<RealtimeVoiceSession> {
  const settings = config.getSpeechSettings().realtime;
  if (settings.provider === "managed") {
    throw new Error("Managed hands-free mode does not require a realtime session");
  }
  if (settings.provider === "openai") return createOpenAiSession(settings, fetchImpl);
  if (settings.provider === "gemini") return createGeminiSession(settings, fetchImpl);
  const defaults = realtimeDefaults(settings);
  return {
    provider: "moshi",
    transport: "websocket",
    ...defaults,
    endpoint: normalizeRealtimeServerUrl(settings.serverUrl),
  };
}

export async function testRealtimeVoiceConnection(
  fetchImpl: FetchLike = fetch
): Promise<{ success: true; provider: SpeechRealtimeProvider; detail: string }> {
  const settings = config.getSpeechSettings().realtime;
  if (settings.provider === "managed") {
    return { success: true, provider: "managed", detail: "Managed hands-free mode is ready" };
  }
  if (settings.provider !== "moshi") {
    const session = await createRealtimeVoiceSession(fetchImpl);
    return { success: true, provider: session.provider, detail: `${session.model} session ready` };
  }
  const serverUrl = normalizeRealtimeServerUrl(settings.serverUrl);
  const probeUrl = serverUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  const response = await fetchImpl(probeUrl, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status >= 500) throw new Error(`Moshi server returned HTTP ${response.status}`);
  return { success: true, provider: "moshi", detail: `Server reachable at ${serverUrl}` };
}
