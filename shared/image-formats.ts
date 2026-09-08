export const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export const IMAGE_EXTENSIONS: readonly string[] = Object.keys(IMAGE_MIME_BY_EXTENSION);

export const PROVIDER_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const HEIC_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(IMAGE_MIME_BY_EXTENSION),
  "image/jpg",
  ...HEIC_IMAGE_MIME,
]);

export function imageExtensionOf(path: string): string {
  const withoutQuery = path.replace(/[?#].*$/, "");
  const match = /\.[a-z0-9]+$/i.exec(withoutQuery);
  return match ? match[0].toLowerCase() : "";
}

export function isImagePath(path: string): boolean {
  return imageExtensionOf(path) in IMAGE_MIME_BY_EXTENSION;
}

export function imageMimeForPath(path: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[imageExtensionOf(path)];
}

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function isHeicMimeType(mimeType: string): boolean {
  return HEIC_IMAGE_MIME.has(mimeType.trim().toLowerCase());
}

export function isProviderImageMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return PROVIDER_IMAGE_MIME.has(normalized === "image/jpg" ? "image/jpeg" : normalized);
}
