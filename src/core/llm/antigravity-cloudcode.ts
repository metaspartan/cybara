export const ANTIGRAVITY_CLOUDCODE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_LOAD_CODE_ASSIST_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const LEGACY_ANTIGRAVITY_HOSTS = new Set(["generativelanguage.googleapis.com"]);
const ANTIGRAVITY_PROVIDER_TYPES = new Set(["antigravity", "google-antigravity"]);
const PROJECT_CACHE_LIMIT = 32;

const projectCache = new Map<string, string>();

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isAntigravityCloudCodeBaseUrl(baseUrl: string): boolean {
  const host = hostOf(baseUrl);
  if (!host) return false;
  return host === "cloudcode-pa.googleapis.com" || host.endsWith("-cloudcode-pa.googleapis.com");
}

export function antigravityTransportBaseUrl(providerType: string, baseUrl: string): string {
  if (!ANTIGRAVITY_PROVIDER_TYPES.has(providerType.trim().toLowerCase())) return baseUrl;
  const host = hostOf(baseUrl);
  if (!baseUrl.trim() || (host && LEGACY_ANTIGRAVITY_HOSTS.has(host))) {
    return ANTIGRAVITY_CLOUDCODE_BASE_URL;
  }
  return baseUrl;
}

export function antigravityGenerateContentUrl(baseUrl: string): string {
  return `${new URL(baseUrl).origin}/v1internal:generateContent`;
}

export function antigravityProjectIdFrom(body: unknown): string | undefined {
  const record = asRecord(body);
  const project =
    record?.cloudaicompanionProject ??
    record?.cloudAiCompanionProject ??
    record?.project ??
    record?.projectId ??
    record?.project_id;
  if (typeof project === "string" && project.trim()) return project.trim();
  const projectRecord = asRecord(project);
  const value = projectRecord?.id ?? projectRecord?.projectId ?? projectRecord?.project_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function wrapAntigravityRequest(
  project: string,
  model: string,
  request: Record<string, unknown>
): Record<string, unknown> {
  return {
    project,
    model,
    request,
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${crypto.randomUUID()}`,
  };
}

export function unwrapAntigravityResponse(body: unknown): unknown {
  const record = asRecord(body);
  const inner = asRecord(record?.response);
  return inner ?? body;
}

export function bearerTokenFromHeaders(headers: Record<string, string>): string | undefined {
  const value = headers.Authorization ?? headers.authorization;
  const match = typeof value === "string" ? value.match(/^Bearer\s+(.+)$/i) : null;
  const token = match?.[1]?.trim();
  return token || undefined;
}

function cacheKeyFor(token: string): string {
  return String(Bun.hash(token));
}

export async function resolveAntigravityProject(
  token: string,
  fetcher: FetchLike = fetch
): Promise<string> {
  const key = cacheKeyFor(token);
  const cached = projectCache.get(key);
  if (cached) return cached;
  const response = await fetcher(ANTIGRAVITY_LOAD_CODE_ASSIST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "antigravity",
    },
    body: JSON.stringify({
      metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Antigravity account setup failed: ${response.status} - ${(await response.text()).slice(0, 300)}`
    );
  }
  const project = antigravityProjectIdFrom(await response.json());
  if (!project) {
    throw new Error("Antigravity account has no Cloud Code project; sign in to Antigravity first.");
  }
  if (projectCache.size >= PROJECT_CACHE_LIMIT) {
    const oldest = projectCache.keys().next().value;
    if (oldest !== undefined) projectCache.delete(oldest);
  }
  projectCache.set(key, project);
  return project;
}
