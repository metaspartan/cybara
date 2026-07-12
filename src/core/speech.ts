import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { platform } from "os";
import { join } from "path";
import { config, type SpeechSettings, type SpeechTtsProviderPreference } from "./config";
import { resolveCybaraHome } from "./cybara-home";
import type { Provider } from "./database";
import { providerManager, providers, resolveProviderType } from "./providers";

export const SPEECH_TTS_PROVIDER_TYPES = ["elevenlabs", "openai", "openai-codex"] as const;
export type SpeechTtsProviderType = (typeof SPEECH_TTS_PROVIDER_TYPES)[number];

export interface SpeechSynthesisArgs {
  text: string;
  provider?: SpeechTtsProviderPreference | "openai-codex";
  providerId?: string;
  model?: string;
  voice?: string;
  format?: string;
  speed?: number;
  rate?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  fallbackToSystem?: boolean;
}

export interface SpeechSynthesisResult {
  audioPath: string;
  text: string;
  voice?: string;
  format: string;
  provider: "system" | SpeechTtsProviderType;
  providerId?: string;
  model?: string;
}

export interface ResolvedSpeechProvider {
  provider: Provider;
  type: SpeechTtsProviderType;
}

const OPENAI_SPEECH_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
]);

function normalizeProviderType(value: string | undefined): SpeechTtsProviderType | null {
  const resolved = resolveProviderType(value);
  const normalized = resolved || value?.trim().toLowerCase();
  if (normalized === "elevenlabs" || normalized === "openai" || normalized === "openai-codex") {
    return normalized;
  }
  return null;
}

function providerHasCredentials(provider: Provider): boolean {
  return !!(provider.api_key || provider.access_token);
}

export function resolveSpeechTtsProvider(input: {
  provider?: string;
  providerId?: string;
  settings?: SpeechSettings;
}): ResolvedSpeechProvider | null {
  const settings = input.settings || config.getSpeechSettings();
  const requestedProviderId = input.providerId?.trim() || settings.tts.providerId;
  if (requestedProviderId) {
    const provider = providerManager.getWithCredentials(requestedProviderId);
    if (!provider) {
      throw new Error("Requested TTS provider ID is invalid");
    }
    const type = normalizeProviderType(provider.provider);
    if (!type) {
      throw new Error("Requested TTS provider must be ElevenLabs, OpenAI, or OpenAI Codex");
    }
    if (!providerHasCredentials(provider)) {
      throw new Error("Requested TTS provider has no API credentials");
    }
    return { provider, type };
  }

  const requestedProvider = input.provider?.trim() || settings.tts.provider;
  const requestedType =
    requestedProvider && requestedProvider !== "auto" && requestedProvider !== "system"
      ? normalizeProviderType(requestedProvider)
      : null;
  const preference: SpeechTtsProviderType[] = requestedType
    ? [requestedType]
    : ["elevenlabs", "openai", "openai-codex"];

  const providerRows = providerManager
    .list()
    .map((provider) => providerManager.getWithCredentials(provider.id))
    .filter((provider): provider is Provider => !!provider && providerHasCredentials(provider));

  for (const type of preference) {
    const preferredDefault = providerRows.find(
      (provider) => normalizeProviderType(provider.provider) === type && provider.is_default
    );
    if (preferredDefault) return { provider: preferredDefault, type };

    const firstMatch = providerRows.find(
      (provider) => normalizeProviderType(provider.provider) === type
    );
    if (firstMatch) return { provider: firstMatch, type };
  }

  return null;
}

function resolveOutputFormat(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "mp3" ||
    normalized === "m4a" ||
    normalized === "wav" ||
    normalized === "aiff" ||
    normalized === "opus" ||
    normalized === "aac"
  ) {
    return normalized;
  }
  return fallback;
}

function mediaDir(): string {
  const dir = join(resolveCybaraHome().dir, "media");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writeAudioFile(bytes: Uint8Array, extension: string): string {
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const audioPath = join(mediaDir(), `tts-${stamp}.${extension}`);
  writeFileSync(audioPath, bytes, { mode: 0o600 });
  try {
    chmodSync(audioPath, 0o600);
  } catch {
    // Best-effort on platforms that do not support POSIX permissions.
  }
  return audioPath;
}

function jsonNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Number(value.toFixed(3))));
}

function providerBaseUrl(provider: Provider, fallback: string): string {
  const providerInfo =
    providers[
      (resolveProviderType(provider.provider) || provider.provider) as keyof typeof providers
    ];
  return (provider.base_url || providerInfo?.baseUrl || fallback).replace(/\/+$/, "");
}

async function resolveElevenLabsVoiceId(
  baseUrl: string,
  apiKey: string,
  requestedVoice?: string
): Promise<string> {
  const voice = requestedVoice?.trim();
  if (voice) return voice;

  const response = await fetch(`${baseUrl}/voices`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `ElevenLabs voice lookup failed: HTTP ${response.status}${text ? ` - ${text}` : ""}`
    );
  }
  const data = (await response.json()) as { voices?: Array<{ voice_id?: string }> };
  const firstVoice = data.voices?.find((entry) => typeof entry.voice_id === "string")?.voice_id;
  if (!firstVoice) {
    throw new Error(
      "ElevenLabs TTS requires a voice ID; no voices were returned for this account."
    );
  }
  return firstVoice;
}

function elevenLabsOutputFormat(format: string): { query: string; extension: string } {
  if (format === "wav") return { query: "pcm_44100", extension: "wav" };
  if (format === "opus") return { query: "opus_48000_64", extension: "opus" };
  return { query: "mp3_44100_128", extension: "mp3" };
}

async function synthesizeWithElevenLabs(
  provider: Provider,
  args: SpeechSynthesisArgs,
  settings: SpeechSettings
): Promise<SpeechSynthesisResult> {
  const apiKey = provider.api_key || provider.access_token;
  if (!apiKey) throw new Error("ElevenLabs TTS provider is missing an API key");

  const baseUrl = providerBaseUrl(provider, "https://api.elevenlabs.io/v1");
  const output = elevenLabsOutputFormat(
    resolveOutputFormat(args.format, settings.tts.outputFormat)
  );
  const voiceId = await resolveElevenLabsVoiceId(baseUrl, apiKey, args.voice || settings.tts.voice);
  const modelId = args.model?.trim() || settings.tts.model || "eleven_multilingual_v2";
  const speed = jsonNumber(args.speed ?? settings.tts.speed, 0.5, 2);
  const stability = jsonNumber(args.stability, 0, 1);
  const similarity = jsonNumber(args.similarity, 0, 1);
  const style = jsonNumber(args.style, 0, 1);
  const voiceSettings: Record<string, unknown> = {};
  if (speed !== undefined) voiceSettings.speed = speed;
  if (stability !== undefined) voiceSettings.stability = stability;
  if (similarity !== undefined) voiceSettings.similarity_boost = similarity;
  if (style !== undefined) voiceSettings.style = style;

  const response = await fetch(
    `${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(output.query)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: args.text,
        model_id: modelId,
        ...(Object.keys(voiceSettings).length > 0 ? { voice_settings: voiceSettings } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`ElevenLabs TTS failed: HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    audioPath: writeAudioFile(bytes, output.extension),
    text: args.text,
    voice: voiceId,
    format: output.extension,
    provider: "elevenlabs",
    providerId: provider.id,
    model: modelId,
  };
}

function openAiOutputFormat(format: string): string {
  if (format === "wav" || format === "opus" || format === "aac" || format === "mp3") {
    return format;
  }
  if (format === "m4a") return "aac";
  return "mp3";
}

function normalizeOpenAiVoice(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && OPENAI_SPEECH_VOICES.has(normalized) ? normalized : "alloy";
}

async function synthesizeWithOpenAI(
  provider: Provider,
  args: SpeechSynthesisArgs,
  settings: SpeechSettings
): Promise<SpeechSynthesisResult> {
  const apiKey = provider.api_key || provider.access_token;
  if (!apiKey) throw new Error("OpenAI TTS provider is missing API credentials");

  const baseUrl = providerBaseUrl(provider, "https://api.openai.com/v1");
  const responseFormat = openAiOutputFormat(
    resolveOutputFormat(args.format, settings.tts.outputFormat)
  );
  const extension = responseFormat === "aac" && args.format === "m4a" ? "m4a" : responseFormat;
  const model = args.model?.trim() || settings.tts.model || "gpt-4o-mini-tts";
  const voice = normalizeOpenAiVoice(args.voice || settings.tts.voice);
  const speed = jsonNumber(args.speed ?? settings.tts.speed, 0.25, 4);

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: args.text,
      response_format: responseFormat,
      ...(speed !== undefined ? { speed } : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`OpenAI TTS failed: HTTP ${response.status}${text ? ` - ${text}` : ""}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    audioPath: writeAudioFile(bytes, extension),
    text: args.text,
    voice,
    format: extension,
    provider: normalizeProviderType(provider.provider) || "openai",
    providerId: provider.id,
    model,
  };
}

export async function synthesizeSpeech(args: SpeechSynthesisArgs): Promise<SpeechSynthesisResult> {
  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text) throw new Error("text is required");

  const settings = config.getSpeechSettings();
  const maxTextLength = settings.tts.maxTextLength;
  if (text.length > maxTextLength) {
    throw new Error(`TTS text exceeds configured ${maxTextLength} character limit`);
  }

  const providerPreference = args.provider?.trim() || settings.tts.provider;
  const fallbackToSystem = args.fallbackToSystem ?? settings.tts.fallbackToSystem;
  if (providerPreference !== "system") {
    try {
      const resolved = resolveSpeechTtsProvider({
        provider: providerPreference,
        providerId: args.providerId,
        settings,
      });

      if (resolved?.type === "elevenlabs") {
        return await synthesizeWithElevenLabs(resolved.provider, { ...args, text }, settings);
      }
      if (resolved?.type === "openai" || resolved?.type === "openai-codex") {
        return await synthesizeWithOpenAI(resolved.provider, { ...args, text }, settings);
      }

      throw new Error("No cloud TTS provider is configured");
    } catch (error) {
      if (!fallbackToSystem || platform() !== "darwin") throw error;
    }
  }

  return await synthesizeWithSystemVoice({ ...args, text }, settings);
}

export async function synthesizeWithSystemVoice(
  args: SpeechSynthesisArgs,
  settings = config.getSpeechSettings()
): Promise<SpeechSynthesisResult> {
  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text) throw new Error("text is required");

  if (platform() !== "darwin") {
    throw new Error(
      "tts uses the macOS 'say' synthesizer and is only available on macOS. " +
        "Configure an external TTS provider for other platforms."
    );
  }

  const which = Bun.spawnSync(["which", "say"]);
  if (which.exitCode !== 0) {
    throw new Error("The macOS 'say' command was not found.");
  }

  const voice = args.voice?.trim() || settings.tts.voice || undefined;
  const rate =
    typeof args.rate === "number" && Number.isFinite(args.rate)
      ? Math.max(80, Math.min(500, Math.floor(args.rate)))
      : typeof args.speed === "number" && Number.isFinite(args.speed)
        ? Math.max(80, Math.min(500, Math.round(args.speed * 175)))
        : undefined;
  const outputFormat = resolveOutputFormat(args.format, settings.tts.outputFormat);
  const requestedFormat =
    outputFormat === "aiff" || outputFormat === "m4a" || outputFormat === "wav"
      ? outputFormat
      : "wav";

  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const dir = mediaDir();
  const aiffPath = join(dir, `tts-${stamp}.aiff`);

  const sayArgs: string[] = [];
  if (voice) sayArgs.push("-v", voice);
  if (rate) sayArgs.push("-r", String(rate));
  sayArgs.push("-o", aiffPath, "--", text);

  const said = Bun.spawnSync(["say", ...sayArgs]);
  if (said.exitCode !== 0) {
    throw new Error(said.stderr.toString().trim() || "macOS 'say' synthesis failed.");
  }
  try {
    chmodSync(aiffPath, 0o600);
  } catch {
    // Best-effort on platforms and volumes that do not support POSIX permissions.
  }

  let audioPath = aiffPath;
  let format = "aiff";
  if (requestedFormat !== "aiff") {
    const outPath = join(dir, `tts-${stamp}.${requestedFormat}`);
    const fmtFlag =
      requestedFormat === "m4a" ? ["-f", "m4af", "-d", "aac"] : ["-f", "WAVE", "-d", "LEI16"];
    const converted = Bun.spawnSync(["afconvert", aiffPath, outPath, ...fmtFlag]);
    if (converted.exitCode === 0 && existsSync(outPath)) {
      try {
        chmodSync(outPath, 0o600);
      } catch {
        // Best-effort on platforms and volumes that do not support POSIX permissions.
      }
      audioPath = outPath;
      format = requestedFormat;
    }
  }

  return {
    audioPath,
    text,
    voice,
    format,
    provider: "system",
  };
}
