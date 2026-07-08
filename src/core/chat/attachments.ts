import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve, sep, extname } from "path";
import { randomUUID } from "crypto";
import { cybaraDir } from "../paths";
import type { AgentImage } from "../llm/image-blocks";

const ATTACHMENTS_ROOT = resolve(cybaraDir, "attachments");
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface PersistedAttachment {
  kind: "image";
  path?: string;
  url?: string;
  mimeType?: string;
}

function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId) && !sessionId.includes("..");
}

function sessionDirFor(sessionId: string): string | null {
  if (!isSafeSessionId(sessionId)) return null;
  const dir = resolve(ATTACHMENTS_ROOT, sessionId);
  if (dir !== ATTACHMENTS_ROOT && !dir.startsWith(ATTACHMENTS_ROOT + sep)) return null;
  return dir;
}

export function persistImageAttachments(
  sessionId: string,
  images: AgentImage[]
): PersistedAttachment[] {
  const dir = sessionDirFor(sessionId);
  if (!dir) return [];

  const refs: PersistedAttachment[] = [];
  let ensured = false;

  for (const image of images) {
    const mimeType = typeof image.mimeType === "string" ? image.mimeType : "image/png";

    if (typeof image.data === "string" && image.data.length > 0) {
      const buffer = Buffer.from(image.data, "base64");
      if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_BYTES) continue;
      if (!ensured) {
        mkdirSync(dir, { recursive: true });
        try {
          chmodSync(ATTACHMENTS_ROOT, 0o700);
          chmodSync(dir, 0o700);
        } catch {
          void 0;
        }
        ensured = true;
      }
      const name = `${randomUUID()}.${MIME_TO_EXT[mimeType] || "png"}`;
      writeFileSync(join(dir, name), buffer, { mode: 0o600 });
      refs.push({ kind: "image", path: `attachments/${sessionId}/${name}`, mimeType });
    } else if (typeof image.url === "string" && image.url.length > 0) {
      refs.push({ kind: "image", url: image.url, mimeType });
    }
  }

  return refs;
}

export function attachmentsToImages(value: unknown): AgentImage[] {
  if (!Array.isArray(value)) return [];
  const images: AgentImage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : undefined;
    const path = typeof record.path === "string" ? record.path : undefined;
    const url = typeof record.url === "string" ? record.url : undefined;
    if (path) images.push({ path, mimeType });
    else if (url) images.push({ url, mimeType });
  }
  return images;
}

function resolveAttachmentFile(relPath: string): string | null {
  if (relPath.includes("\0")) return null;
  const target = resolve(cybaraDir, relPath.replace(/^\/+/, ""));
  if (target !== ATTACHMENTS_ROOT && !target.startsWith(ATTACHMENTS_ROOT + sep)) return null;
  return target;
}

export function hydrateImageDataFromPath(image: AgentImage): AgentImage {
  if (image.data || !image.path) return image;
  const target = resolveAttachmentFile(image.path);
  if (!target || !existsSync(target) || statSync(target).isDirectory()) return image;
  try {
    const data = readFileSync(target).toString("base64");
    const mimeType = image.mimeType || EXT_TO_MIME[extname(target).toLowerCase()] || "image/png";
    return { ...image, data, mimeType };
  } catch {
    return image;
  }
}
