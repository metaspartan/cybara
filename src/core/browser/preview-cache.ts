import { createHash } from "node:crypto";
import * as pwManager from "./pw-manager";

export interface BrowserPreviewFrame {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
  revision: string;
}

export interface BrowserPreviewRequest {
  format?: unknown;
  fresh?: unknown;
  fullPage?: unknown;
  quality?: unknown;
  viewportHeight?: unknown;
  viewportWidth?: unknown;
}

interface CachedBrowserPreview extends BrowserPreviewFrame {
  capturedAt: number;
  generation: string;
}

const PREVIEW_CACHE_MS = 350;
const MAX_CACHED_PREVIEWS = 16;
const previewCache = new Map<string, CachedBrowserPreview>();
const pendingCaptures = new Map<string, Promise<CachedBrowserPreview>>();
const pageGenerations = new Map<string, number>();
let globalGeneration = 0;

function viewportDimension(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(320, Math.round(parsed))) : fallback;
}

function screenshotQuality(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(90, Math.max(40, Math.round(parsed))) : 72;
}

function pageGeneration(pageId: string): number {
  return pageGenerations.get(pageId) ?? 0;
}

function captureGeneration(pageId: string): string {
  return `${globalGeneration}:${pageGeneration(pageId)}`;
}

function removePageEntries(pageId: string): void {
  for (const key of previewCache.keys()) {
    if (key.startsWith(`${pageId}:`)) previewCache.delete(key);
  }
}

export function invalidateBrowserPreview(pageId?: string): void {
  if (!pageId) {
    previewCache.clear();
    pageGenerations.clear();
    globalGeneration += 1;
    return;
  }
  pageGenerations.set(pageId, pageGeneration(pageId) + 1);
  removePageEntries(pageId);
}

function cacheFrame(key: string, frame: CachedBrowserPreview): void {
  previewCache.delete(key);
  previewCache.set(key, frame);
  while (previewCache.size > MAX_CACHED_PREVIEWS) {
    const oldest = previewCache.keys().next().value;
    if (typeof oldest !== "string") break;
    previewCache.delete(oldest);
  }
}

export async function captureBrowserPreview(
  pageId: string,
  request: BrowserPreviewRequest
): Promise<BrowserPreviewFrame> {
  if (request.fresh === "true" || request.fresh === true) invalidateBrowserPreview(pageId);
  const generation = captureGeneration(pageId);
  const width = viewportDimension(request.viewportWidth, 1280, 2560);
  const height = viewportDimension(request.viewportHeight, 800, 1600);
  const format = request.format === "jpeg" ? "jpeg" : "png";
  const quality = format === "jpeg" ? screenshotQuality(request.quality) : 0;
  const fullPage = request.fullPage !== "false";
  const key = `${pageId}:${generation}:${width}:${height}:${format}:${quality}:${fullPage}`;
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.capturedAt <= PREVIEW_CACHE_MS) return cached;
  const pending = pendingCaptures.get(key);
  if (pending) return await pending;
  const capture = (async (): Promise<CachedBrowserPreview> => {
    await pwManager.resize(pageId, width, height);
    const bytes = await pwManager.screenshot(pageId, {
      fullPage,
      type: format,
      ...(format === "jpeg" ? { quality } : {}),
    });
    const frame: CachedBrowserPreview = {
      bytes,
      capturedAt: Date.now(),
      contentType: format === "jpeg" ? "image/jpeg" : "image/png",
      generation,
      revision: createHash("sha256").update(bytes).digest("base64url").slice(0, 16),
    };
    if (captureGeneration(pageId) === generation) cacheFrame(key, frame);
    return frame;
  })().finally(() => pendingCaptures.delete(key));
  pendingCaptures.set(key, capture);
  return await capture;
}
