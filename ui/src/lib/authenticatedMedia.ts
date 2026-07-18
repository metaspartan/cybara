import { apiFetch } from "@/lib/auth";

export interface LoadedAuthenticatedMediaSource {
  src: string;
  revoke?: () => void;
}

export function requiresAuthenticatedMediaFetch(source: string): boolean {
  try {
    const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
    const url = new URL(source, base);
    const currentOrigin =
      typeof window === "undefined" ? new URL(base).origin : window.location.origin;
    return url.origin === currentOrigin && /\/api\/media$/.test(url.pathname);
  } catch {
    return false;
  }
}

export async function loadAuthenticatedMediaSource(
  source: string,
  expectedContentTypePrefix: string,
  fetcher: typeof apiFetch = apiFetch,
  createObjectUrl: (blob: Blob) => string = URL.createObjectURL,
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL,
  resourceName = "Media"
): Promise<LoadedAuthenticatedMediaSource> {
  if (!requiresAuthenticatedMediaFetch(source)) return { src: source };
  const response = await fetcher(source);
  if (!response.ok) throw new Error(`${resourceName} request failed (${response.status})`);
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith(expectedContentTypePrefix.toLowerCase())) {
    throw new Error(`${resourceName} request returned unsupported content`);
  }
  const objectUrl = createObjectUrl(await response.blob());
  return { src: objectUrl, revoke: () => revokeObjectUrl(objectUrl) };
}

export function loadAuthenticatedAudioSource(
  source: string
): Promise<LoadedAuthenticatedMediaSource> {
  return loadAuthenticatedMediaSource(
    source,
    "audio/",
    apiFetch,
    URL.createObjectURL,
    URL.revokeObjectURL,
    "Audio"
  );
}
