import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { extname, isAbsolute, resolve, sep } from "path";
import { IMAGE_MIME_BY_EXTENSION, imageMimeForPath } from "../../../shared/image-formats";
import { cybaraDir } from "../paths";
import { snapshotViewedMedia, type ViewedMediaHeicConverter } from "../viewed-media";

const MEDIA_MIME: Record<string, string> = {
  ...IMAGE_MIME_BY_EXTENSION,
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".opus": "audio/ogg",
};

const ALLOWED_SUBDIRS = ["screenshots", "attachments", "media"] as const;

const TRANSCODED_MIME = new Set(["image/heic", "image/heif", "image/tiff"]);

function allowedRoots(): string[] {
  return ALLOWED_SUBDIRS.map((dir) => resolve(cybaraDir, dir));
}

export interface MediaFileResult {
  status: number;
  contentType?: string;
  bytes?: Buffer;
  error?: string;
  path?: string;
}

export async function serveMediaFile(
  relPath: string,
  convertHeic?: ViewedMediaHeicConverter
): Promise<MediaFileResult> {
  const resolved = resolveMediaFile(relPath);
  if (
    resolved.status !== 200 ||
    !resolved.path ||
    !TRANSCODED_MIME.has(resolved.contentType ?? "")
  ) {
    return resolved;
  }
  const snapshot = await snapshotViewedMedia(resolved.path, convertHeic);
  const contentType = snapshot ? imageMimeForPath(snapshot) : undefined;
  if (!snapshot || !contentType) return { status: 415, error: "undecodable image" };
  try {
    return { status: 200, contentType, bytes: readFileSync(snapshot), path: snapshot };
  } catch {
    return { status: 500, error: "read error" };
  }
}

export function resolveMediaFile(relPath: string): MediaFileResult {
  if (!relPath || typeof relPath !== "string") return { status: 400, error: "path required" };
  if (relPath.includes("\0")) return { status: 400, error: "invalid path" };

  const target = isAbsolute(relPath)
    ? resolve(relPath)
    : resolve(cybaraDir, relPath.replace(/^\/+/, ""));
  const roots = allowedRoots();
  const contained = roots.some((root) => target === root || target.startsWith(root + sep));
  if (!contained) return { status: 403, error: "forbidden" };

  const contentType = MEDIA_MIME[extname(target).toLowerCase()];
  if (!contentType) return { status: 415, error: "unsupported media type" };

  if (!existsSync(target) || statSync(target).isDirectory())
    return { status: 404, error: "not found" };

  try {
    const realTarget = realpathSync.native(target);
    const realRoots = roots.map((root) =>
      existsSync(root) ? realpathSync.native(root) : resolve(root)
    );
    const realContained = realRoots.some(
      (root) => realTarget === root || realTarget.startsWith(root + sep)
    );
    if (!realContained) return { status: 403, error: "forbidden" };
    return { status: 200, contentType, bytes: readFileSync(realTarget), path: realTarget };
  } catch {
    return { status: 500, error: "read error" };
  }
}
