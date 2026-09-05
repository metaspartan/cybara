export const BOT_PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const BOT_PROFILE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

const BOT_PROFILE_IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const BOT_PROFILE_IMAGE_MAX_BASE64_LENGTH = Math.ceil((BOT_PROFILE_IMAGE_MAX_BYTES * 4) / 3) + 4;

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function matchesImageSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "image/png") {
    return hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") return hasBytes(bytes, 0, [0xff, 0xd8, 0xff]);
  return hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
}

export function normalizeBotProfileImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return "";
  const match = BOT_PROFILE_IMAGE_DATA_URL.exec(normalized);
  const mimeType = match?.[1];
  const base64 = match?.[2];
  if (!mimeType || !base64 || base64.length > BOT_PROFILE_IMAGE_MAX_BASE64_LENGTH) return null;
  try {
    const binary = atob(base64);
    if (binary.length === 0 || binary.length > BOT_PROFILE_IMAGE_MAX_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return matchesImageSignature(mimeType, bytes) ? normalized : null;
  } catch {
    return null;
  }
}
