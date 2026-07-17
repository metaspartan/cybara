import { readFileSync } from "fs";
import { join } from "path";
import { resolveCybaraHome } from "../core/cybara-home";

export const CLI_API_BASE = process.env.CYBARA_API || "http://localhost:4269";

export const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode ===
      "function",
};

export function resolveCliApiKey(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDir: string = resolveCybaraHome().dir
): string | null {
  const envKey = environment.CYBARA_API_KEY?.trim();
  if (envKey) return envKey;

  try {
    const keyPath = join(homeDir, "api_key");
    return readFileSync(keyPath, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export const CLI_API_KEY = resolveCliApiKey();

export function resolveCliGatewayPassword(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | null {
  return environment.CYBARA_GATEWAY_PASSWORD?.trim() || null;
}

export const CLI_GATEWAY_PASSWORD = resolveCliGatewayPassword();

export function buildCliAuthHeaders(
  apiKey: string | null,
  headers?: RequestInit["headers"],
  ensureJsonContentType = false,
  gatewayPassword: string | null = null
): Headers {
  const merged = new Headers(headers);
  if (ensureJsonContentType && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  if (apiKey && !merged.has("Authorization")) {
    merged.set("Authorization", `Bearer ${apiKey}`);
  }
  if (gatewayPassword && !merged.has("X-Cybara-Gateway-Password")) {
    merged.set("X-Cybara-Gateway-Password", gatewayPassword);
  }
  return merged;
}

export function withCliAuthHeaders(
  headers?: RequestInit["headers"],
  ensureJsonContentType = false
): Headers {
  return buildCliAuthHeaders(CLI_API_KEY, headers, ensureJsonContentType, CLI_GATEWAY_PASSWORD);
}

export async function fetchCliAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${CLI_API_BASE}${endpoint}`, {
      ...options,
      headers: withCliAuthHeaders(options?.headers, true),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      console.error(`ERROR: Cannot connect to Cybara at ${CLI_API_BASE}`);
      console.error("Is the server running? Start it with: cybara start");
    } else if (message.includes("HTTP 401")) {
      console.error("ERROR: Unauthorized API request (401)");
      console.error("Set CYBARA_API_KEY or create ~/.cybara/api_key");
    } else if (message.includes("HTTP 403")) {
      console.error("ERROR: Gateway access denied (403)");
      console.error("Set CYBARA_GATEWAY_PASSWORD when the remote gateway requires one");
    }
    return null;
  }
}
