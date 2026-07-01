/**
 * Built-in media-generation providers.
 *
 * - OpenAI image generation (DALL-E 3 / gpt-image-1) via the Images API.
 * - fal image / video / music generation (synchronous and async-queue models).
 *
 * Each provider reads its own env keys for `isConfigured` and implements a
 * single `generate(req)` method. Auth/env plumbing is intentionally separate
 * from the capability.
 */
import {
  registerImageProvider,
  registerVideoProvider,
  registerMusicProvider,
  type GenerationResult,
  type ImageGenerationRequest,
  type VideoGenerationRequest,
  type MusicGenerationRequest,
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

// ----------------------------- OpenAI image -------------------------------

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
      // Editing mode when reference images are provided.
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

// ------------------------------- fal (all) --------------------------------

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

/** Poll a fal queue status_url until COMPLETED, then fetch the response_url. */
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
    isConfigured: (ctx) => !!falApiKey() || !!ctx.env?.FAL_KEY,
    generate: async (req: ImageGenerationRequest): Promise<GenerationResult> => {
      const k = key();
      if (!k) throw new Error("FAL_KEY is not configured.");
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
    isConfigured: (ctx) => !!falApiKey() || !!ctx.env?.FAL_KEY,
    generate: async (req: VideoGenerationRequest): Promise<GenerationResult> => {
      const k = key();
      if (!k) throw new Error("FAL_KEY is not configured.");
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
    isConfigured: (ctx) => !!falApiKey() || !!ctx.env?.FAL_KEY,
    generate: async (req: MusicGenerationRequest): Promise<GenerationResult> => {
      const k = key();
      if (!k) throw new Error("FAL_KEY is not configured.");
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
