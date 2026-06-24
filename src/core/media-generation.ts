/**
 * Media-generation provider registry (image / video / music).
 *
 * A single swappable-provider pattern (ported from openclaw) for all three
 * media domains. Providers implement a small interface and register themselves;
 * the runtime dispatch resolves config/fallbacks and calls the provider. This
 * keeps the model-facing tools (`image_generate`, `video_generate`,
 * `music_generate`) decoupled from concrete APIs (fal, openai, elevenlabs, …).
 *
 * Auth/env plumbing lives separately from the capability — providers read their
 * own env keys in `isConfigured`.
 */

import { registerOpenAIImageProvider, registerFalProviders } from "./media-providers";

type MediaKind = "image" | "video" | "music";

export interface GeneratedAsset {
  /** Base64 (no data: prefix) OR a remote URL the host can fetch. */
  buffer?: string;
  url?: string;
  mimeType: string;
  fileName?: string;
  revisedPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface BaseGenerationRequest {
  provider: string;
  model?: string;
  prompt: string;
  timeoutMs?: number;
  count?: number;
  providerOptions?: Record<string, unknown>;
}

export interface ImageGenerationRequest extends BaseGenerationRequest {
  size?: string;
  aspectRatio?: string;
  quality?: "standard" | "hd";
  outputFormat?: "png" | "jpeg" | "webp";
  /** Reference images for editing (base64 buffers). */
  inputImages?: Array<{ buffer: string; mimeType: string }>;
}

export interface VideoGenerationRequest extends BaseGenerationRequest {
  durationSeconds?: number;
  audio?: boolean;
  /** First frame / reference image (base64). */
  inputImages?: Array<{ buffer: string; mimeType: string; role?: string }>;
}

export interface MusicGenerationRequest extends BaseGenerationRequest {
  lyrics?: string;
  instrumental?: boolean;
  durationSeconds?: number;
  format?: "mp3" | "wav";
}

export interface GenerationResult {
  assets: GeneratedAsset[];
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderConfiguredContext {
  env?: Record<string, string | undefined>;
}

export interface ImageGenerationProvider {
  id: string;
  aliases?: string[];
  label?: string;
  models?: string[];
  isConfigured?: (ctx: ProviderConfiguredContext) => boolean;
  generate: (req: ImageGenerationRequest) => Promise<GenerationResult>;
}

export interface VideoGenerationProvider {
  id: string;
  aliases?: string[];
  label?: string;
  models?: string[];
  isConfigured?: (ctx: ProviderConfiguredContext) => boolean;
  generate: (req: VideoGenerationRequest) => Promise<GenerationResult>;
}

export interface MusicGenerationProvider {
  id: string;
  aliases?: string[];
  label?: string;
  models?: string[];
  isConfigured?: (ctx: ProviderConfiguredContext) => boolean;
  generate: (req: MusicGenerationRequest) => Promise<GenerationResult>;
}

type AnyProvider = ImageGenerationProvider | VideoGenerationProvider | MusicGenerationProvider;

const registries: Record<MediaKind, Map<string, AnyProvider>> = {
  image: new Map(),
  video: new Map(),
  music: new Map(),
};

const aliasIndex: Record<MediaKind, Map<string, string>> = {
  image: new Map(),
  video: new Map(),
  music: new Map(),
};

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

export function registerImageProvider(provider: ImageGenerationProvider): void {
  register("image", provider);
}
export function registerVideoProvider(provider: VideoGenerationProvider): void {
  register("video", provider);
}
export function registerMusicProvider(provider: MusicGenerationProvider): void {
  register("music", provider);
}

function register(kind: MediaKind, provider: AnyProvider): void {
  const canonical = normalizeId(provider.id);
  registries[kind].set(canonical, provider);
  aliasIndex[kind].set(canonical, canonical);
  for (const alias of provider.aliases ?? []) {
    aliasIndex[kind].set(normalizeId(alias), canonical);
  }
}

export function listMediaProviders(kind: MediaKind): string[] {
  return [...registries[kind].keys()];
}

export function getMediaProvider<K extends MediaKind>(
  kind: K,
  id: string
): K extends "image"
  ? ImageGenerationProvider
  : K extends "video"
    ? VideoGenerationProvider
    : MusicGenerationProvider {
  const canonical = aliasIndex[kind].get(normalizeId(id)) ?? normalizeId(id);
  const provider = registries[kind].get(canonical);
  if (!provider) {
    throw new Error(
      `Unknown ${kind} generation provider "${id}". Registered: ${listMediaProviders(kind).join(", ") || "(none)"}.`
    );
  }
  return provider as never;
}

function envContext(): ProviderConfiguredContext {
  return { env: process.env as Record<string, string | undefined> };
}

/** Return the first configured provider for a kind, or the first registered. */
export function resolveDefaultProvider(kind: MediaKind): AnyProvider | null {
  const providers = [...registries[kind].values()];
  const configured = providers.find((p) => p.isConfigured?.(envContext()) ?? true);
  return configured ?? providers[0] ?? null;
}

export function isConfigured(provider: AnyProvider): boolean {
  return provider.isConfigured?.(envContext()) ?? true;
}

// ---------------------------------------------------------------------------
// Built-in providers — auto-registered at import time.
// (The provider implementations live in ./media-providers and register
// themselves by calling registerImageProvider/registerVideoProvider/...)
// ---------------------------------------------------------------------------

registerOpenAIImageProvider();
registerFalProviders();
