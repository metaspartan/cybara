import {
  type GenerationResult,
  type ImageGenerationRequest,
  type MusicGenerationRequest,
  registerImageProvider,
  registerMusicProvider,
  registerVideoProvider,
  type VideoGenerationRequest,
} from "./media-generation";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_OP_TIMEOUT_MS = 120_000;

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function openaiApiKey(): string | undefined {
  return getEnv("OPENAI_API_KEY") || getEnv("CODEX_API_KEY");
}

function falApiKey(): string | undefined {
  return getEnv("FAL_KEY") || getEnv("FAL_API_KEY");
}

const MUAPI_API_BASE = "https://api.muapi.ai/api/v1";
const MUAPI_API_ORIGIN = new URL(MUAPI_API_BASE).origin;
const MUAPI_POLL_INTERVAL_MS = 5000;
const MUAPI_DEFAULT_TIMEOUT_MS = 120_000;
const MUAPI_IMAGE_MODELS = ["nano-banana", "nano-banana-pro"];
const MUAPI_VIDEO_MODELS = [
  "wan3.0-text-to-video",
  "wan3.0-prime-text-to-video",
  "seedance-2.5-text-to-video",
];
const MUAPI_MUSIC_MODELS = ["minimax-music-3.0"];

type JsonObject = Record<string, unknown>;

function muapiApiKey(): string | undefined {
  return getEnv("MUAPI_API_KEY");
}

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function muapiRecords(response: JsonObject): JsonObject[] {
  const records = [response];
  for (const key of ["data", "output", "result"]) {
    const nested = asJsonObject(response[key]);
    if (nested && !records.includes(nested)) records.push(nested);
  }
  return records;
}

function muapiValue(response: JsonObject, keys: string[]): unknown {
  for (const record of muapiRecords(response)) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

function muapiString(response: JsonObject, keys: string[]): string | undefined {
  const value = muapiValue(response, keys);
  return typeof value === "string" && value ? value : undefined;
}

function muapiHeaders(key: string, includeJson = false): Record<string, string> {
  return {
    "x-api-key": key,
    Accept: "application/json",
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}

function muapiError(response: JsonObject): string {
  const value = muapiValue(response, ["error", "message", "detail"]);
  return typeof value === "string" && value ? value.slice(0, 500) : "request failed";
}

function muapiResultUrl(response: JsonObject, requestId: string): string {
  for (const record of muapiRecords(response)) {
    const urls = asJsonObject(record.urls);
    const candidate = urls?.get;
    if (candidate === undefined) continue;
    if (typeof candidate !== "string" || !candidate) {
      throw new Error("MuAPI returned an invalid result URL");
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" || parsed.origin !== MUAPI_API_ORIGIN) {
        throw new Error("invalid origin");
      }
    } catch {
      throw new Error("MuAPI returned an invalid result URL");
    }
    return candidate;
  }

  return `${MUAPI_API_BASE}/predictions/${encodeURIComponent(requestId)}/result`;
}

function muapiMediaUrls(value: unknown): string[] {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(muapiMediaUrls);

  const object = asJsonObject(value);
  if (!object) return [];
  return [
    "url",
    "image_url",
    "video_url",
    "audio_url",
    "outputs",
    "images",
    "videos",
    "media",
  ].flatMap((key) => muapiMediaUrls(object[key]));
}

function muapiOutputUrls(response: JsonObject): string[] {
  const urls = muapiRecords(response).flatMap((record) =>
    ["outputs", "output", "media", "image", "video", "audio"].flatMap((key) =>
      muapiMediaUrls(record[key])
    )
  );
  return [...new Set(urls)];
}

async function muapiJson(url: string, init: RequestInit, operation: string): Promise<JsonObject> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`MuAPI ${operation} failed: ${response.status} ${await safeText(response)}`);
  }
  const data: unknown = await response.json();
  const object = asJsonObject(data);
  if (!object) throw new Error(`MuAPI ${operation} returned an invalid response`);
  return object;
}

function muapiTimeout(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : MUAPI_DEFAULT_TIMEOUT_MS;
}

async function waitForMuapiResult(
  creation: JsonObject,
  requestId: string,
  key: string,
  timeoutMs: number
): Promise<JsonObject> {
  const resultUrl = muapiResultUrl(creation, requestId);
  const deadline = Date.now() + timeoutMs;
  let current = creation;

  while (true) {
    const status = String(muapiValue(current, ["status"]) || "").toLowerCase();
    if (["completed", "succeeded", "success"].includes(status)) return current;
    if (["failed", "error", "timeout", "canceled", "cancelled"].includes(status)) {
      throw new Error(`MuAPI generation ${status}: ${muapiError(current)}`);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("MuAPI generation timed out while polling");
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(MUAPI_POLL_INTERVAL_MS, remaining))
    );
    current = await muapiJson(
      resultUrl,
      {
        headers: muapiHeaders(key),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      },
      "result polling"
    );
  }
}

async function generateWithMuapi(
  model: string,
  payload: JsonObject,
  mimeType: string,
  timeoutMs: number | undefined
): Promise<GenerationResult> {
  const key = muapiApiKey();
  if (!key) throw new Error("MUAPI_API_KEY is not configured for media generation.");
  const timeout = muapiTimeout(timeoutMs);
  const creation = await muapiJson(
    `${MUAPI_API_BASE}/${model}`,
    {
      method: "POST",
      headers: muapiHeaders(key, true),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    },
    "generation submission"
  );
  const requestId = muapiString(creation, ["request_id", "id"]);
  if (!requestId) throw new Error("MuAPI did not return a request ID");

  const completed = await waitForMuapiResult(creation, requestId, key, timeout);
  const urls = muapiOutputUrls(completed);
  if (!urls.length) throw new Error("MuAPI completed without a media output URL");

  return {
    assets: urls.map((url) => ({ url, mimeType })),
    model,
  };
}

export function registerOpenAIImageProvider(): void {
  registerImageProvider({
    id: "openai",
    aliases: ["dall-e", "gpt-image"],
    label: "OpenAI Images",
    models: ["gpt-image-1", "dall-e-3"],
    isConfigured: (ctx) => !!openaiApiKey() || !!ctx.env?.OPENAI_API_KEY,
    generate: async (req: ImageGenerationRequest): Promise<GenerationResult> => {
      const apiKey = openaiApiKey();
      if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for image generation.");
      const model = req.model || "gpt-image-1";
      const baseUrl = getEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        n: req.count ?? 1,
        size: req.size || "1024x1024",
        quality: req.quality || "standard",
      };
      const endpoint = req.inputImages?.length
        ? `${baseUrl}/images/edits`
        : `${baseUrl}/images/generations`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
      });
      if (!response.ok) {
        throw new Error(
          `OpenAI image generation failed: ${response.status} ${await safeText(response)}`
        );
      }
      const data = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      };
      return {
        assets: (data.data ?? []).map((d) => ({
          buffer: d.b64_json,
          url: d.url,
          mimeType: d.b64_json ? "image/png" : "image/png",
          revisedPrompt: d.revised_prompt,
        })),
        model,
      };
    },
  });
}

function falHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

async function waitForFalQueue(
  statusUrl: string,
  responseUrl: string,
  key: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = await fetch(statusUrl, { headers: falHeaders(key) });
    if (!poll.ok) throw new Error(`fal queue poll failed: ${poll.status}`);
    const state = (await poll.json()) as { status?: string };
    if (state.status === "COMPLETED") {
      const result = await fetch(responseUrl, { headers: falHeaders(key) });
      if (!result.ok) throw new Error(`fal result fetch failed: ${result.status}`);
      return (await result.json()) as Record<string, unknown>;
    }
    if (["FAILED", "ERROR"].includes(state.status ?? "")) {
      throw new Error(`fal generation failed: ${JSON.stringify(state)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("fal generation timed out");
}

export function registerFalProviders(): void {
  const key = () => falApiKey();

  registerImageProvider({
    id: "fal",
    label: "fal.ai",
    isConfigured: (ctx) => !!falApiKey() || !!ctx.env?.FAL_KEY || !!ctx.env?.FAL_API_KEY,
    generate: async (req: ImageGenerationRequest): Promise<GenerationResult> => {
      const k = key();
      if (!k) throw new Error("FAL_KEY or FAL_API_KEY is not configured.");
      const model = req.model || "fal-ai/flux/schnell";
      const response = await fetch(`https://fal.run/${model}`, {
        method: "POST",
        headers: falHeaders(k),
        body: JSON.stringify({
          prompt: req.prompt,
          image_size: req.size || "landscape_4_3",
          num_images: req.count ?? 1,
          ...(req.providerOptions ?? {}),
        }),
      });
      if (!response.ok)
        throw new Error(`fal image failed: ${response.status} ${await safeText(response)}`);
      const data = (await response.json()) as {
        images?: Array<{ url?: string; content_type?: string }>;
      };
      return {
        assets: (data.images ?? []).map((img) => ({
          url: img.url,
          mimeType: img.content_type || "image/png",
        })),
        model,
      };
    },
  });

  registerVideoProvider({
    id: "fal",
    label: "fal.ai",
    models: ["fal-ai/minimax/video-01", "fal-ai/kling-video", "fal-ai/veo3"],
    isConfigured: (ctx) => !!falApiKey() || !!ctx.env?.FAL_KEY || !!ctx.env?.FAL_API_KEY,
    generate: async (req: VideoGenerationRequest): Promise<GenerationResult> => {
      const k = key();
      if (!k) throw new Error("FAL_KEY or FAL_API_KEY is not configured.");
      const model = req.model || "fal-ai/minimax/video-01";
      const queueBase = "https://queue.fal.run";
      const submit = await fetch(`${queueBase}/${model}`, {
        method: "POST",
        headers: falHeaders(k),
        body: JSON.stringify({
          prompt: req.prompt,
          duration: req.durationSeconds ? `${req.durationSeconds}` : undefined,
          ...(req.providerOptions ?? {}),
        }),
      });
      if (!submit.ok)
        throw new Error(`fal video submit failed: ${submit.status} ${await safeText(submit)}`);
      const job = (await submit.json()) as {
        status?: string;
        request_id?: string;
        status_url?: string;
        response_url?: string;
      };
      if (!job.response_url || !job.status_url) {
        throw new Error(`fal video did not return a queue handle: ${JSON.stringify(job)}`);
      }
      const result = (await waitForFalQueue(
        job.status_url,
        job.response_url,
        k,
        req.timeoutMs ?? DEFAULT_OP_TIMEOUT_MS
      )) as { video?: { url?: string; content_type?: string } };
      return {
        assets: result.video?.url
          ? [{ url: result.video.url, mimeType: result.video.content_type || "video/mp4" }]
          : [],
        model,
      };
    },
  });

  registerMusicProvider({
    id: "fal",
    label: "fal.ai",
    models: [
      "fal-ai/minimax-music/v2.6",
      "fal-ai/ace-step/prompt-to-audio",
      "fal-ai/stable-audio-25/text-to-audio",
    ],
    isConfigured: (ctx) => !!falApiKey() || !!ctx.env?.FAL_KEY || !!ctx.env?.FAL_API_KEY,
    generate: async (req: MusicGenerationRequest): Promise<GenerationResult> => {
      const k = key();
      if (!k) throw new Error("FAL_KEY or FAL_API_KEY is not configured.");
      const model = req.model || "fal-ai/minimax-music/v2.6";
      const response = await fetch(`https://fal.run/${model}`, {
        method: "POST",
        headers: falHeaders(k),
        body: JSON.stringify({
          prompt: req.prompt,
          lyrics: req.lyrics,
          duration: req.durationSeconds,
          ...(req.providerOptions ?? {}),
        }),
      });
      if (!response.ok)
        throw new Error(`fal music failed: ${response.status} ${await safeText(response)}`);
      const data = (await response.json()) as {
        audio?: { url?: string; content_type?: string };
        tracks?: Array<{ url?: string; content_type?: string }>;
      };
      const tracks = data.tracks ?? (data.audio?.url ? [data.audio] : []);
      return {
        assets: tracks.map((t) => ({ url: t.url, mimeType: t.content_type || "audio/mpeg" })),
        model,
      };
    },
  });
}

export function registerMuapiProviders(): void {
  const isConfigured = (ctx: { env?: Record<string, string | undefined> }) =>
    !!muapiApiKey() || !!ctx.env?.MUAPI_API_KEY;

  registerImageProvider({
    id: "muapi",
    label: "MuAPI",
    models: MUAPI_IMAGE_MODELS,
    isConfigured,
    generate: (req: ImageGenerationRequest): Promise<GenerationResult> =>
      generateWithMuapi(
        req.model || MUAPI_IMAGE_MODELS[0],
        {
          prompt: req.prompt,
          ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
          ...(req.providerOptions ?? {}),
        },
        "image/png",
        req.timeoutMs
      ),
  });

  registerVideoProvider({
    id: "muapi",
    label: "MuAPI",
    models: MUAPI_VIDEO_MODELS,
    isConfigured,
    generate: (req: VideoGenerationRequest): Promise<GenerationResult> =>
      generateWithMuapi(
        req.model || MUAPI_VIDEO_MODELS[0],
        {
          prompt: req.prompt,
          ...(req.durationSeconds !== undefined ? { duration: req.durationSeconds } : {}),
          ...(req.audio !== undefined ? { enable_audio: req.audio } : {}),
          ...(req.providerOptions ?? {}),
        },
        "video/mp4",
        req.timeoutMs
      ),
  });

  registerMusicProvider({
    id: "muapi",
    label: "MuAPI",
    models: MUAPI_MUSIC_MODELS,
    isConfigured,
    generate: (req: MusicGenerationRequest): Promise<GenerationResult> =>
      generateWithMuapi(
        req.model || MUAPI_MUSIC_MODELS[0],
        {
          prompt: req.prompt,
          ...(req.lyrics ? { lyrics: req.lyrics } : {}),
          ...(req.instrumental !== undefined ? { is_instrumental: req.instrumental } : {}),
          ...(req.providerOptions ?? {}),
        },
        "audio/mpeg",
        req.timeoutMs
      ),
  });
}
