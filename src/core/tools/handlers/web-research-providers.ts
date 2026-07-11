const FIRECRAWL_CLOUD_BASE_URL = "https://api.firecrawl.dev";
const PARALLEL_BASE_URL = "https://api.parallel.ai";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface ExternalWebSearchResult {
  title: string;
  url: string;
  description: string;
  siteName?: string;
  published?: string;
}

export interface ExternalWebExtractResult {
  content: string;
  url: string;
  title?: string;
  provider: "firecrawl" | "parallel";
}

export interface FirecrawlSearchOptions {
  categories?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: string;
  location?: string;
  country?: string;
}

function configured(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function endpoint(baseUrl: string, path: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Web research provider URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Web research provider URL cannot contain credentials");
  }
  parsed.search = "";
  parsed.hash = "";
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = normalizedPath.endsWith("/v2") ? `${normalizedPath}${path}` : `/v2${path}`;
  return parsed.toString();
}

async function readJsonResponse(
  response: Response,
  label: string
): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  const text = new TextDecoder().decode(bytes);
  if (!response.ok) {
    let detail = response.statusText || "request failed";
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      if (typeof payload.error === "string") detail = payload.error;
      if (typeof payload.message === "string") detail = payload.message;
    } catch {}
    throw new Error(`${label} error: ${response.status} ${detail}`);
  }
  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("response was not an object");
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}`);
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  label: string
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return readJsonResponse(response, label);
}

function hostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

function stringValue(record: Record<string, unknown> | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firecrawlHeaders(env: Record<string, string | undefined>): Record<string, string> {
  return configured(env.FIRECRAWL_API_KEY)
    ? { Authorization: `Bearer ${env.FIRECRAWL_API_KEY.trim()}` }
    : {};
}

function firecrawlBaseUrl(env: Record<string, string | undefined>): string {
  return configured(env.FIRECRAWL_API_URL)
    ? env.FIRECRAWL_API_URL.trim()
    : FIRECRAWL_CLOUD_BASE_URL;
}

export function firecrawlConfigured(env: Record<string, string | undefined>): boolean {
  return configured(env.FIRECRAWL_API_KEY) || configured(env.FIRECRAWL_API_URL);
}

export function parallelConfigured(env: Record<string, string | undefined>): boolean {
  return configured(env.PARALLEL_API_KEY);
}

export async function searchFirecrawl(
  query: string,
  count: number,
  env: Record<string, string | undefined>,
  options: FirecrawlSearchOptions = {}
): Promise<ExternalWebSearchResult[]> {
  const body: Record<string, unknown> = { query, limit: count, sources: ["web"] };
  if (options.categories?.length) body.categories = options.categories;
  if (options.includeDomains?.length) body.includeDomains = options.includeDomains;
  if (options.excludeDomains?.length) body.excludeDomains = options.excludeDomains;
  if (options.timeRange) body.tbs = options.timeRange;
  if (options.location) body.location = options.location;
  if (options.country) body.country = options.country;
  const payload = await postJson(
    endpoint(firecrawlBaseUrl(env), "/search"),
    firecrawlHeaders(env),
    body,
    "Firecrawl Search"
  );
  if (payload.success === false) {
    throw new Error(`Firecrawl Search error: ${stringValue(payload, ["error", "message"])}`);
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : undefined;
  const dataRecord = data as Record<string, unknown> | undefined;
  const candidates = [dataRecord?.web, dataRecord?.results, payload.results, payload.data];
  const rows = candidates.find(Array.isArray);
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, count).flatMap((value): ExternalWebSearchResult[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : undefined;
    const url =
      stringValue(row, ["url", "sourceURL", "sourceUrl"]) ||
      stringValue(metadata, ["sourceURL", "url"]);
    if (!url) return [];
    const description = stringValue(row, ["description", "snippet", "summary", "markdown"]);
    return [
      {
        title: stringValue(row, ["title"]) || stringValue(metadata, ["title"]),
        url,
        description: description.replace(/\s+/g, " ").slice(0, 800),
        siteName: hostname(url),
        published:
          stringValue(row, ["publishedDate", "published"]) ||
          stringValue(metadata, ["publishedTime", "publishedDate"]) ||
          undefined,
      },
    ];
  });
}

export async function searchParallel(
  query: string,
  count: number,
  apiKey: string
): Promise<ExternalWebSearchResult[]> {
  const payload = await postJson(
    `${PARALLEL_BASE_URL}/v1/search`,
    { "x-api-key": apiKey.trim() },
    { objective: query, search_queries: [query], max_results: count },
    "Parallel Search"
  );
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.slice(0, count).flatMap((value): ExternalWebSearchResult[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const url = stringValue(row, ["url"]);
    if (!url) return [];
    const excerpts = Array.isArray(row.excerpts)
      ? row.excerpts.filter((item): item is string => typeof item === "string")
      : [];
    return [
      {
        title: stringValue(row, ["title"]),
        url,
        description: excerpts.join("\n\n").replace(/\s+/g, " ").slice(0, 800),
        siteName: hostname(url),
        published: stringValue(row, ["publish_date"]) || undefined,
      },
    ];
  });
}

export async function extractFirecrawl(
  url: string,
  extractMode: "markdown" | "text",
  maxChars: number,
  env: Record<string, string | undefined>
): Promise<ExternalWebExtractResult> {
  const payload = await postJson(
    endpoint(firecrawlBaseUrl(env), "/scrape"),
    firecrawlHeaders(env),
    { url, formats: ["markdown"], onlyMainContent: true },
    "Firecrawl Scrape"
  );
  if (payload.success === false) {
    throw new Error(`Firecrawl Scrape error: ${stringValue(payload, ["error", "message"])}`);
  }
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : payload;
  const metadata =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : undefined;
  let content = stringValue(data, ["markdown", "content"]);
  if (!content) throw new Error("Firecrawl Scrape returned no content");
  if (extractMode === "text") content = content.replace(/[#*_`>\[\]]/g, "");
  return {
    content: content.slice(0, maxChars),
    url: stringValue(metadata, ["sourceURL", "url"]) || url,
    title: stringValue(metadata, ["title"]) || undefined,
    provider: "firecrawl",
  };
}

export async function extractParallel(
  url: string,
  maxChars: number,
  apiKey: string,
  objective?: string
): Promise<ExternalWebExtractResult> {
  const payload = await postJson(
    `${PARALLEL_BASE_URL}/v1/extract`,
    { "x-api-key": apiKey.trim() },
    {
      urls: [url],
      objective: objective || "Extract the main readable content from this page.",
      max_chars_total: maxChars,
    },
    "Parallel Extract"
  );
  const row = Array.isArray(payload.results) ? payload.results[0] : undefined;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    const error = Array.isArray(payload.errors) ? payload.errors[0] : undefined;
    const detail =
      error && typeof error === "object" && !Array.isArray(error)
        ? stringValue(error as Record<string, unknown>, ["content", "error_type"])
        : "no content returned";
    throw new Error(`Parallel Extract error: ${detail}`);
  }
  const record = row as Record<string, unknown>;
  const excerpts = Array.isArray(record.excerpts)
    ? record.excerpts.filter((item): item is string => typeof item === "string")
    : [];
  const content = stringValue(record, ["full_content"]) || excerpts.join("\n\n");
  if (!content) throw new Error("Parallel Extract returned no content");
  return {
    content: content.slice(0, maxChars),
    url: stringValue(record, ["url"]) || url,
    title: stringValue(record, ["title"]) || undefined,
    provider: "parallel",
  };
}
