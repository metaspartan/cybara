import { validatePublicHttpUrl, validatePublicHttpUrlShape } from "./outbound-url-policy";

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
}

export function checkPublicHttpUrl(rawUrl: string): UrlGuardResult {
  const result = validatePublicHttpUrlShape(rawUrl);
  return result.valid ? { ok: true } : { ok: false, reason: result.error };
}

export function assertPublicHttpUrl(rawUrl: string, label = "URL"): string {
  const result = checkPublicHttpUrl(rawUrl);
  if (!result.ok) throw new Error(`Validation error: ${label} ${result.reason}`);
  return String(rawUrl).trim();
}

export async function assertResolvedPublicHttpUrl(rawUrl: string, label = "URL"): Promise<string> {
  const result = await validatePublicHttpUrl(rawUrl);
  if (!result.valid) throw new Error(`Validation error: ${label} ${result.error}`);
  return String(rawUrl).trim();
}
