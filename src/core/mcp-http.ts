export interface McpRpcResult {
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface McpOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  tokenEndpoint: string;
  clientId: string;
  resource: string;
  expiresAt?: number;
}

const MCP_OAUTH_PREFIX = "MCP_OAUTH=";

export function encodeMcpOAuthEnvironment(credential: McpOAuthCredential): string {
  return `${MCP_OAUTH_PREFIX}${Buffer.from(JSON.stringify(credential)).toString("base64url")}`;
}

export function decodeMcpOAuthEnvironment(env: string | undefined): McpOAuthCredential | null {
  const encoded = env
    ?.split(",")
    .find((entry) => entry.trim().startsWith(MCP_OAUTH_PREFIX))
    ?.trim()
    .slice(MCP_OAUTH_PREFIX.length);
  if (!encoded) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.accessToken !== "string" ||
      typeof record.tokenEndpoint !== "string" ||
      typeof record.clientId !== "string" ||
      typeof record.resource !== "string"
    ) {
      return null;
    }
    return value as McpOAuthCredential;
  } catch {
    return null;
  }
}

export function replaceMcpOAuthEnvironment(
  env: string | undefined,
  credential: McpOAuthCredential
): string {
  const encoded = encodeMcpOAuthEnvironment(credential);
  const entries = (env || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith(MCP_OAUTH_PREFIX));
  return [...entries, encoded].join(",");
}

export async function refreshMcpOAuthCredential(
  credential: McpOAuthCredential
): Promise<McpOAuthCredential> {
  if (!credential.refreshToken) throw new Error("MCP authorization has expired");
  const response = await fetch(credential.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: credential.clientId,
      resource: credential.resource,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`MCP authorization refresh failed (${response.status})`);
  const value = (await response.json()) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP authorization refresh returned an invalid response");
  }
  const token = value as Record<string, unknown>;
  if (typeof token.access_token !== "string") {
    throw new Error("MCP authorization refresh is missing an access token");
  }
  return {
    ...credential,
    accessToken: token.access_token,
    refreshToken:
      typeof token.refresh_token === "string" ? token.refresh_token : credential.refreshToken,
    expiresAt:
      typeof token.expires_in === "number"
        ? Date.now() + Math.max(0, token.expires_in - 30) * 1000
        : undefined,
  };
}

export function parseMcpHttpResponse(contentType: string, body: string): McpRpcResult {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/event-stream")) {
    let last: McpRpcResult = {};
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        last = JSON.parse(payload) as McpRpcResult;
      } catch {}
    }
    return last;
  }
  try {
    return JSON.parse(body) as McpRpcResult;
  } catch {
    return {};
  }
}

export function isHttpMcpUrl(url: string | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

export function normalizeRemoteMcpUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Remote MCP URL is required");
  }
  const parsed = new URL(input.trim());
  if (parsed.protocol !== "https:") {
    throw new Error("Remote MCP servers must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Remote MCP URLs cannot contain embedded credentials");
  }
  if (parsed.hash) {
    throw new Error("Remote MCP URLs cannot contain fragments");
  }
  return parsed.toString();
}
