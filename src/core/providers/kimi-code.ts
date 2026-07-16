import { randomUUID } from "crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs";
import { arch, hostname, release, type } from "os";
import { join } from "path";
import { getAppVersion } from "../build-info";
import { secureDir } from "../paths";

export const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";
export const KIMI_CODE_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
export const KIMI_CODE_DEVICE_CODE_URL = "https://auth.kimi.com/api/oauth/device_authorization";
export const KIMI_CODE_TOKEN_URL = "https://auth.kimi.com/api/oauth/token";

export const kimiCodeModels = [
  {
    id: "k3",
    name: "Kimi K3",
    context: 1_048_576,
    maxTokens: 32_768,
    reasoning: true,
    input: ["text"] as const,
  },
  {
    id: "kimi-for-coding",
    name: "Kimi K2.7 Code",
    context: 262_144,
    maxTokens: 32_768,
    reasoning: true,
    input: ["text", "image"] as const,
  },
  {
    id: "kimi-for-coding-highspeed",
    name: "Kimi K2.7 Code High Speed",
    context: 262_144,
    maxTokens: 32_768,
    reasoning: true,
    input: ["text", "image"] as const,
  },
] as const;

const deviceIdPath = join(secureDir, "kimi-code-device-id");
let inMemoryDeviceId: string | undefined;

function asciiHeader(value: string, fallback: string): string {
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join("")
    .trim();
  return cleaned || fallback;
}

function readDeviceId(): string | undefined {
  if (inMemoryDeviceId) return inMemoryDeviceId;
  try {
    const value = readFileSync(deviceIdPath, "utf8").trim();
    if (value) {
      inMemoryDeviceId = value;
      return value;
    }
  } catch {}
  return undefined;
}

function createDeviceId(): string {
  const existing = readDeviceId();
  if (existing) return existing;
  const created = randomUUID();
  if (process.env.NODE_ENV === "test") {
    inMemoryDeviceId = created;
    return created;
  }
  try {
    writeFileSync(deviceIdPath, created, { mode: 0o600, flag: "wx" });
    chmodSync(deviceIdPath, 0o600);
    inMemoryDeviceId = created;
    return created;
  } catch {
    if (existsSync(deviceIdPath)) {
      const raced = readDeviceId();
      if (raced) return raced;
    }
    inMemoryDeviceId = created;
    return created;
  }
}

export function kimiCodeIdentityHeaders(): Record<string, string> {
  const version = asciiHeader(getAppVersion(), "unknown");
  return {
    "User-Agent": `Cybara/${version}`,
    "X-Msh-Platform": "kimi_code_cli",
    "X-Msh-Version": version,
    "X-Msh-Device-Name": asciiHeader(hostname(), "unknown"),
    "X-Msh-Device-Model": asciiHeader(`${type()} ${release()} ${arch()}`, "unknown"),
    "X-Msh-Os-Version": asciiHeader(release(), "unknown"),
    "X-Msh-Device-Id": createDeviceId(),
  };
}

export function isKimiCodeProvider(providerType: string): boolean {
  return providerType === "kimi-code" || providerType === "kimi-code-oauth";
}
