import { existsSync, statSync, readFileSync } from "fs";
import { resolve, sep, extname } from "path";
import { cybaraDir } from "../paths";

const MEDIA_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

const ALLOWED_SUBDIRS = ["screenshots", "attachments"] as const;

function allowedRoots(): string[] {
  return ALLOWED_SUBDIRS.map((dir) => resolve(cybaraDir, dir));
}

export interface MediaFileResult {
  status: number;
  contentType?: string;
  bytes?: Buffer;
  error?: string;
}

export function resolveMediaFile(relPath: string): MediaFileResult {
  if (!relPath || typeof relPath !== "string") return { status: 400, error: "path required" };
  if (relPath.includes("\0")) return { status: 400, error: "invalid path" };

  const target = resolve(cybaraDir, relPath.replace(/^\/+/, ""));
  const roots = allowedRoots();
  const contained = roots.some((root) => target === root || target.startsWith(root + sep));
  if (!contained) return { status: 403, error: "forbidden" };

  const contentType = MEDIA_MIME[extname(target).toLowerCase()];
  if (!contentType) return { status: 415, error: "unsupported media type" };

  if (!existsSync(target) || statSync(target).isDirectory())
    return { status: 404, error: "not found" };

  try {
    return { status: 200, contentType, bytes: readFileSync(target) };
  } catch {
    return { status: 500, error: "read error" };
  }
}
