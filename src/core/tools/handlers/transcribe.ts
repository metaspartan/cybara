/**
 * Speech-to-text (transcription). Sends an audio file to a Whisper-compatible
 * endpoint. Groq (whisper-large-v3, fast) is preferred when configured, then
 * OpenAI (whisper-1). Both use the OpenAI /audio/transcriptions multipart API.
 */
import { existsSync, statSync } from "fs";
import { basename } from "path";
import { assertReadablePath } from "../path-policy";
import { validateUrl } from "../../../api/security";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB (Whisper API limit)

export type TranscribeBackend = "groq" | "openai";

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
}

/**
 * Resolve which transcription backend to use. Pure for unit testing. Returns
 * null when no key is configured.
 */
export function selectTranscribeBackend(
  env: Record<string, string | undefined>
): { backend: TranscribeBackend; model: string } | null {
  if (env.GROQ_API_KEY) return { backend: "groq", model: "whisper-large-v3" };
  if (env.OPENAI_API_KEY) return { backend: "openai", model: "whisper-1" };
  return null;
}

function resolveBackend(modelOverride?: string): BackendConfig {
  const selected = selectTranscribeBackend(process.env);
  if (!selected) {
    throw new Error(
      "Transcription requires GROQ_API_KEY (whisper-large-v3) or OPENAI_API_KEY (whisper-1)."
    );
  }
  const model = modelOverride || selected.model;
  if (selected.backend === "groq") {
    return { backend: "groq", endpoint: GROQ_ENDPOINT, apiKey: process.env.GROQ_API_KEY!, model };
  }
  return { backend: "openai", endpoint: OPENAI_ENDPOINT, apiKey: process.env.OPENAI_API_KEY!, model };
}

async function loadAudio(args: Record<string, unknown>): Promise<{ blob: Blob; filename: string }> {
  const path = typeof args.audioPath === "string" ? args.audioPath.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";

  if (path) {
    assertReadablePath(path); // blocks secret files / traversal
    if (!existsSync(path)) throw new Error(`Audio file not found: ${path}`);
    if (statSync(path).size > MAX_AUDIO_BYTES) {
      throw new Error(`Audio file exceeds 25MB limit: ${path}`);
    }
    const file = Bun.file(path);
    return { blob: await file.arrayBuffer().then((b) => new Blob([b])), filename: basename(path) };
  }

  if (url) {
    const verdict = await validateUrl(url); // SSRF guard (private/loopback/metadata)
    if (!verdict.valid) {
      throw new Error(`Refusing to fetch audio URL: ${verdict.error || "blocked by URL policy"}`);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_AUDIO_BYTES) throw new Error("Fetched audio exceeds 25MB limit.");
    return { blob: new Blob([buf]), filename: basename(new URL(url).pathname) || "audio" };
  }

  throw new Error("Provide either audioPath (local file) or url.");
}

export async function handleTranscribe(args: Record<string, unknown>): Promise<TranscribeResponse> {
  const config = resolveBackend(typeof args.model === "string" ? args.model : undefined);
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
