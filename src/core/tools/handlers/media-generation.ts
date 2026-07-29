import { basename, join } from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { validateUrl } from "../../../api/security";
import {
  getMediaProvider,
  resolveDefaultProvider,
  type ImageGenerationRequest,
  type VideoGenerationRequest,
  type MusicGenerationRequest,
} from "../../media-generation";
import { fetchPublicHttpUrl, type PublicHttpFetcher } from "../../outbound-url-policy";
import type { ToolContext } from "../index";

function workspaceOutDir(context?: ToolContext): string {
  const base = context?.workspaceDir || process.cwd();
  const dir = join(base, ".cybara", "media");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function extFor(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}

function safeAssetFileName(fileName: string | undefined, fallback: string): string {
  if (!fileName) return fallback;
  const leaf = basename(fileName).trim();
  return leaf && leaf !== "." && leaf !== ".." ? leaf : fallback;
}

async function fetchValidatedAssetUrl(
  url: string,
  redirects = 0,
  fetchUrl: PublicHttpFetcher = fetchPublicHttpUrl
): Promise<ArrayBuffer> {
  if (redirects > 5) {
    throw new Error("Media asset download failed: too many redirects");
  }

  const validation = await validateUrl(url);
  if (!validation.valid) {
    throw new Error(`Validation error: media asset URL blocked: ${validation.error}`);
  }

  const response = await fetchUrl(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Media asset download failed: HTTP ${response.status}`);
    }
    return fetchValidatedAssetUrl(new URL(location, url).toString(), redirects + 1, fetchUrl);
  }

  if (!response.ok) {
    throw new Error(`Media asset download failed: HTTP ${response.status}`);
  }

  return response.arrayBuffer();
}

async function persistAssets(
  assets: Array<{ buffer?: string; url?: string; mimeType: string; fileName?: string }>,
  prefix: string,
  context?: ToolContext,
  fetchUrl: PublicHttpFetcher = fetchPublicHttpUrl
): Promise<Array<{ path: string; url?: string; mimeType: string }>> {
  const dir = workspaceOutDir(context);
  const slug = timestampSlug();
  const out: Array<{ path: string; url?: string; mimeType: string }> = [];
  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i];
    const ext = extFor(asset.mimeType);
    const fileName = safeAssetFileName(asset.fileName, `${prefix}-${slug}-${i + 1}.${ext}`);
    const filePath = join(dir, fileName);
    if (asset.buffer) {
      writeFileSync(filePath, Buffer.from(asset.buffer, "base64"));
    } else if (asset.url) {
      const buf = Buffer.from(await fetchValidatedAssetUrl(asset.url, 0, fetchUrl));
      writeFileSync(filePath, buf);
    }
    out.push({ path: filePath, url: asset.url, mimeType: asset.mimeType });
  }
  return out;
}

export async function handleImageGenerate(
  args: Record<string, unknown>,
  context?: ToolContext,
  fetchUrl: PublicHttpFetcher = fetchPublicHttpUrl
): Promise<{
  provider: string;
  model?: string;
  assets: Array<{ path: string; url?: string; mimeType: string }>;
}> {
  const providerId = typeof args.provider === "string" ? args.provider : "";
  const provider = providerId
    ? getMediaProvider("image", providerId)
    : resolveDefaultProvider("image");
  if (!provider)
    throw new Error(
      "No image generation provider is configured (set OPENAI_API_KEY or FAL_KEY/FAL_API_KEY)."
    );
  const req: ImageGenerationRequest = {
    provider: provider.id,
    model: typeof args.model === "string" ? args.model : undefined,
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    size: typeof args.size === "string" ? args.size : undefined,
    quality: args.quality === "hd" ? "hd" : "standard",
    count: typeof args.count === "number" ? args.count : undefined,
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    providerOptions:
      args.providerOptions && typeof args.providerOptions === "object"
        ? (args.providerOptions as Record<string, unknown>)
        : undefined,
  };
  if (!req.prompt) throw new Error("Validation error: 'prompt' is required.");
  const result = await provider.generate(req);
  const assets = await persistAssets(result.assets, "image", context, fetchUrl);
  return { provider: provider.id, model: result.model, assets };
}

export async function handleVideoGenerate(
  args: Record<string, unknown>,
  context?: ToolContext,
  fetchUrl: PublicHttpFetcher = fetchPublicHttpUrl
): Promise<{
  provider: string;
  model?: string;
  assets: Array<{ path: string; url?: string; mimeType: string }>;
}> {
  const providerId = typeof args.provider === "string" ? args.provider : "";
  const provider = providerId
    ? getMediaProvider("video", providerId)
    : resolveDefaultProvider("video");
  if (!provider)
    throw new Error("No video generation provider is configured (set FAL_KEY/FAL_API_KEY).");
  const req: VideoGenerationRequest = {
    provider: provider.id,
    model: typeof args.model === "string" ? args.model : undefined,
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    durationSeconds: typeof args.durationSeconds === "number" ? args.durationSeconds : undefined,
    audio: args.audio === true,
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    providerOptions:
      args.providerOptions && typeof args.providerOptions === "object"
        ? (args.providerOptions as Record<string, unknown>)
        : undefined,
  };
  if (!req.prompt) throw new Error("Validation error: 'prompt' is required.");
  const result = await provider.generate(req);
  const assets = await persistAssets(result.assets, "video", context, fetchUrl);
  return { provider: provider.id, model: result.model, assets };
}

export async function handleMusicGenerate(
  args: Record<string, unknown>,
  context?: ToolContext,
  fetchUrl: PublicHttpFetcher = fetchPublicHttpUrl
): Promise<{
  provider: string;
  model?: string;
  assets: Array<{ path: string; url?: string; mimeType: string }>;
}> {
  const providerId = typeof args.provider === "string" ? args.provider : "";
  const provider = providerId
    ? getMediaProvider("music", providerId)
    : resolveDefaultProvider("music");
  if (!provider)
    throw new Error("No music generation provider is configured (set FAL_KEY/FAL_API_KEY).");
  const req: MusicGenerationRequest = {
    provider: provider.id,
    model: typeof args.model === "string" ? args.model : undefined,
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    lyrics: typeof args.lyrics === "string" ? args.lyrics : undefined,
    instrumental: args.instrumental === true,
    durationSeconds: typeof args.durationSeconds === "number" ? args.durationSeconds : undefined,
    format: args.format === "wav" ? "wav" : "mp3",
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    providerOptions:
      args.providerOptions && typeof args.providerOptions === "object"
        ? (args.providerOptions as Record<string, unknown>)
        : undefined,
  };
  if (!req.prompt) throw new Error("Validation error: 'prompt' is required.");
  const result = await provider.generate(req);
  const assets = await persistAssets(result.assets, "music", context, fetchUrl);
  return { provider: provider.id, model: result.model, assets };
}
