import { existsSync, statSync } from "fs";
import { basename } from "path";
import { assertReadablePath } from "../path-policy";
import { validateUrl } from "../../../api/security";
import { config } from "../../config";
import { providerManager, providers, resolveProviderType } from "../../providers";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type TranscribeBackend = "groq" | "openai" | "openai-codex";

export interface TranscribeResponse {
  text: string;
  provider: TranscribeBackend;
  model: string;
  tookMs: number;
}

interface BackendConfig {
  backend: TranscribeBackend;
  endpoint: string;
  apiKey: string;
  model: string;
  providerId?: string;
}

export function selectTranscribeBackend(
  env: Record<string, string | undefined>
): { backend: TranscribeBackend; model: string } | null {
  if (env.GROQ_API_KEY) return { backend: "groq", model: "whisper-large-v3" };
  if (env.OPENAI_API_KEY) return { backend: "openai", model: "whisper-1" };
  return null;
}

function resolveConfiguredProviderBackend(
  args: Record<string, unknown>,
  modelOverride?: string
): BackendConfig | null {
  const speech = config.getSpeechSettings();
  const providerId =
    typeof args.providerId === "string" && args.providerId.trim()
      ? args.providerId.trim()
      : speech.stt.providerId;
  if (!providerId) return null;

  const provider = providerManager.getWithCredentials(providerId);
  if (!provider) {
    throw new Error("Requested transcription provider ID is invalid");
  }
  const providerType = resolveProviderType(provider.provider);
  if (providerType !== "openai" && providerType !== "openai-codex") {
    throw new Error("Requested transcription provider must be OpenAI or OpenAI Codex");
  }
  const apiKey = provider.api_key || provider.access_token;
  if (!apiKey) {
    throw new Error("Requested transcription provider has no API credentials");
  }
  const providerInfo = providers[providerType];
  const baseUrl = (
    provider.base_url ||
    providerInfo?.baseUrl ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  return {
    backend: providerType,
    endpoint: `${baseUrl}/audio/transcriptions`,
    apiKey,
    model: modelOverride || speech.stt.model || "gpt-4o-mini-transcribe",
    providerId: provider.id,
  };
}

function resolveBackend(args: Record<string, unknown>, modelOverride?: string): BackendConfig {
  const configured = resolveConfiguredProviderBackend(args, modelOverride);
  if (configured) return configured;

  const selected = selectTranscribeBackend(process.env);
  if (!selected) {
    throw new Error(
      "Transcription requires a saved OpenAI/OpenAI Codex speech provider, GROQ_API_KEY, or OPENAI_API_KEY."
    );
  }
  const model = modelOverride || selected.model;
  if (selected.backend === "groq") {
    return { backend: "groq", endpoint: GROQ_ENDPOINT, apiKey: process.env.GROQ_API_KEY!, model };
  }
  return {
    backend: "openai",
    endpoint: OPENAI_ENDPOINT,
    apiKey: process.env.OPENAI_API_KEY!,
    model,
  };
}

async function loadAudio(args: Record<string, unknown>): Promise<{ blob: Blob; filename: string }> {
  const path = typeof args.audioPath === "string" ? args.audioPath.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";

  if (path) {
    assertReadablePath(path);
    if (!existsSync(path)) throw new Error(`Audio file not found: ${path}`);
    if (statSync(path).size > MAX_AUDIO_BYTES) {
      throw new Error(`Audio file exceeds 25MB limit: ${path}`);
    }
    const file = Bun.file(path);
    return { blob: await file.arrayBuffer().then((b) => new Blob([b])), filename: basename(path) };
  }

  if (url) {
    let current = url;
    let res: Response | undefined;
    for (let hop = 0; hop < 5; hop++) {
      const verdict = await validateUrl(current);
      if (!verdict.valid) {
        throw new Error(`Refusing to fetch audio URL: ${verdict.error || "blocked by URL policy"}`);
      }
      res = await fetch(current, { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        current = new URL(location, current).toString();
        continue;
      }
      break;
    }
    if (!res || (res.status >= 300 && res.status < 400)) {
      throw new Error("Failed to fetch audio: too many redirects");
    }
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_AUDIO_BYTES) throw new Error("Fetched audio exceeds 25MB limit.");
    return { blob: new Blob([buf]), filename: basename(new URL(current).pathname) || "audio" };
  }

  throw new Error("Provide either audioPath (local file) or url.");
}

export async function handleTranscribe(args: Record<string, unknown>): Promise<TranscribeResponse> {
  const config = resolveBackend(args, typeof args.model === "string" ? args.model : undefined);
  const { blob, filename } = await loadAudio(args);

  const form = new FormData();
  form.append("file", blob, filename || "audio.m4a");
  form.append("model", config.model);
  form.append("response_format", "json");
  if (typeof args.language === "string" && args.language.trim()) {
    form.append("language", args.language.trim());
  }
  if (typeof args.prompt === "string" && args.prompt.trim()) {
    form.append("prompt", args.prompt.trim());
  }

  const start = Date.now();
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `${config.backend} transcription error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`
    );
  }

  const data = (await response.json()) as { text?: string };
  return {
    text: data.text || "",
    provider: config.backend,
    model: config.model,
    tookMs: Date.now() - start,
  };
}
