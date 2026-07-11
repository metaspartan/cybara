import { filterWebSearchResultsByAllowlist } from "./web-policy";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const searchCache = new Map<string, { results: unknown; timestamp: number }>();

interface SearchResult {
  title: string;
  url: string;
  description: string;
  siteName?: string;
}

interface SearchResponse {
  query: string;
  provider: string;
  count: number;
  tookMs: number;
  results: SearchResult[];
  cached?: boolean;
  error?: string;
}

function getCacheKey(query: string, count: number): string {
  return `${query.toLowerCase().trim()}:${count}`;
}

function getFromCache(key: string): SearchResponse | null {
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...(cached.results as SearchResponse), cached: true };
  }
  return null;
}

function setCache(key: string, results: SearchResponse): void {
  searchCache.set(key, { results, timestamp: Date.now() });
  if (searchCache.size > 100) {
    const oldest = Array.from(searchCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 50);
    oldest.forEach(([k]) => searchCache.delete(k));
  }
}

async function searchWithBrave(
  query: string,
  count: number,
  apiKey: string
): Promise<SearchResponse> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const start = Date.now();
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  const results: SearchResult[] = (data.web?.results || []).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.description || "",
    siteName: r.url ? new URL(r.url).hostname : undefined,
  }));

  return {
    query,
    provider: "brave",
    count: results.length,
    tookMs: Date.now() - start,
    results,
  };
}

async function searchWithDDG(query: string, count: number): Promise<SearchResponse> {
  const start = Date.now();

  const response = await fetch(DDG_HTML_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `q=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search error: ${response.status}`);
  }

  const html = await response.text();

  const results: SearchResult[] = [];
  const resultPattern =
    /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*)<\/a>/g;

  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < count) {
    const url = match[1];
    const title = match[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const description = match[3].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

    if (url && title) {
      let cleanUrl = url;
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        cleanUrl = decodeURIComponent(uddgMatch[1]);
      }

      results.push({
        title,
        url: cleanUrl,
        description,
        siteName: cleanUrl ? new URL(cleanUrl).hostname : undefined,
      });
    }
  }

  if (results.length === 0) {
    const linkPattern = /href="(https?:\/\/[^"]+)"[^>]*>([^<]+)/g;
    while ((match = linkPattern.exec(html)) !== null && results.length < count) {
      const url = match[1];
      const title = match[2];
      if (url && !url.includes("duckduckgo.com") && title.length > 5) {
        results.push({
          title: title.trim(),
          url,
          description: "",
          siteName: new URL(url).hostname,
        });
      }
    }
  }

  return {
    query,
    provider: "duckduckgo",
    count: results.length,
    tookMs: Date.now() - start,
    results,
  };
}

async function searchWithTavily(
  query: string,
  count: number,
  apiKey: string
): Promise<SearchResponse> {
  const start = Date.now();
  const response = await fetch(TAVILY_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, max_results: count, search_depth: "basic" }),
  });

  if (!response.ok) {
    throw new Error(`Tavily Search API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const results: SearchResult[] = (data.results || []).slice(0, count).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.content || "",
    siteName: r.url ? safeHostname(r.url) : undefined,
  }));

  return { query, provider: "tavily", count: results.length, tookMs: Date.now() - start, results };
}

async function searchWithExa(
  query: string,
  count: number,
  apiKey: string
): Promise<SearchResponse> {
  const start = Date.now();
  const response = await fetch(EXA_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: count,
      contents: { text: { maxCharacters: 600 } },
    }),
  });

  if (!response.ok) {
    throw new Error(`Exa Search API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string }>;
  };

  const results: SearchResult[] = (data.results || []).slice(0, count).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    description: (r.text || "").replace(/\s+/g, " ").trim().slice(0, 400),
    siteName: r.url ? safeHostname(r.url) : undefined,
  }));

  return { query, provider: "exa", count: results.length, tookMs: Date.now() - start, results };
}

async function searchWithSearxng(
  query: string,
  count: number,
  baseUrl: string
): Promise<SearchResponse> {
  const start = Date.now();
  const url = new URL("/search", baseUrl.replace(/\/+$/, "") + "/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const results: SearchResult[] = (data.results || []).slice(0, count).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.content || "",
    siteName: r.url ? safeHostname(r.url) : undefined,
  }));

  return { query, provider: "searxng", count: results.length, tookMs: Date.now() - start, results };
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export type WebSearchBackend = "tavily" | "exa" | "brave" | "searxng" | "duckduckgo";

/**
 * Resolve which backends to try, in order. Quality backends (Tavily/Exa) are
 * preferred when their key is set, then Brave, then a self-hosted SearXNG, with
 * DuckDuckGo always available as a no-key fallback. Pure for unit testing.
 */
export function selectSearchBackends(env: Record<string, string | undefined>): WebSearchBackend[] {
  const order: WebSearchBackend[] = [];
  if (env.TAVILY_API_KEY) order.push("tavily");
  if (env.EXA_API_KEY) order.push("exa");
  if (env.BRAVE_API_KEY) order.push("brave");
  if (env.SEARXNG_URL || env.SEARXNG_BASE_URL) order.push("searxng");
  order.push("duckduckgo"); // always-available fallback
  return order;
}

function backendIsConfigured(
  backend: WebSearchBackend,
  env: Record<string, string | undefined>
): boolean {
  if (backend === "duckduckgo") return true;
  if (backend === "tavily") return Boolean(env.TAVILY_API_KEY);
  if (backend === "exa") return Boolean(env.EXA_API_KEY);
  if (backend === "brave") return Boolean(env.BRAVE_API_KEY);
  return Boolean(env.SEARXNG_URL || env.SEARXNG_BASE_URL);
}

export function resolveSearchBackends(
  requested: WebSearchBackend | undefined,
  env: Record<string, string | undefined>
): WebSearchBackend[] {
  const automatic = selectSearchBackends(env);
  if (!requested || !backendIsConfigured(requested, env)) return automatic;
  return [requested, ...automatic.filter((backend) => backend !== requested)];
}

function runBackend(
  backend: WebSearchBackend,
  query: string,
  count: number,
  env: Record<string, string | undefined>
): Promise<SearchResponse> {
  switch (backend) {
    case "tavily":
      return searchWithTavily(query, count, env.TAVILY_API_KEY!);
    case "exa":
      return searchWithExa(query, count, env.EXA_API_KEY!);
    case "brave":
      return searchWithBrave(query, count, env.BRAVE_API_KEY!);
    case "searxng":
      return searchWithSearxng(query, count, (env.SEARXNG_URL || env.SEARXNG_BASE_URL)!);
    case "duckduckgo":
      return searchWithDDG(query, count);
  }
}

export async function handleWebSearch(args: Record<string, unknown>): Promise<SearchResponse> {
  const query = args.query as string;
  const count = Math.min(
    Math.max(1, (args.count as number) || DEFAULT_SEARCH_COUNT),
    MAX_SEARCH_COUNT
  );

  if (!query) {
    throw new Error("query is required");
  }

  const cacheKey = getCacheKey(query, count);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Allow forcing a specific backend; otherwise try them in resolved precedence,
  // falling through to the next on failure (DuckDuckGo is the final no-key path).
  const requested =
    typeof args.provider === "string" ? (args.provider as WebSearchBackend) : undefined;
  const backends = resolveSearchBackends(requested, process.env);

  const errors: string[] = [];
  for (const backend of backends) {
    try {
      const result = await runBackend(backend, query, count, process.env);
      result.results = filterWebSearchResultsByAllowlist(result.results);
      result.count = result.results.length;
      setCache(cacheKey, result);
      return result;
    } catch (error) {
      errors.push(`${backend}: ${(error as Error).message}`);
    }
  }

  throw new Error(`All search providers failed — ${errors.join("; ")}`);
}
