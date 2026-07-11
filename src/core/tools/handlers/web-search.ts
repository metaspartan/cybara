import { filterWebSearchResultsByAllowlist } from "./web-policy";
import {
  firecrawlConfigured,
  parallelConfigured,
  searchFirecrawl,
  searchParallel,
} from "./web-research-providers";

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

interface DuckDuckGoAnchor {
  href: string;
  text: string;
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

  const results = await parseDuckDuckGoSearchResults(await response.text(), count);
  return {
    query,
    provider: "duckduckgo",
    count: results.length,
    tookMs: Date.now() - start,
    results,
  };
}

function decodeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://html.duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.toString();
  } catch {
    return rawUrl;
  }
}

function createDuckDuckGoAnchorCollector(
  anchors: DuckDuckGoAnchor[]
): HTMLRewriterTypes.HTMLRewriterElementContentHandlers {
  let current: DuckDuckGoAnchor | null = null;
  return {
    element(element): void {
      current = { href: element.getAttribute("href") || "", text: "" };
      element.onEndTag(() => {
        if (current) anchors.push(current);
        current = null;
      });
    },
    text(chunk): void {
      if (current) current.text += chunk.text;
    },
  };
}

export async function parseDuckDuckGoSearchResults(
  html: string,
  count: number
): Promise<SearchResult[]> {
  const titles: DuckDuckGoAnchor[] = [];
  const snippets: DuckDuckGoAnchor[] = [];
  const transformed = new HTMLRewriter()
    .on("a.result__a", createDuckDuckGoAnchorCollector(titles))
    .on("a.result__snippet", createDuckDuckGoAnchorCollector(snippets))
    .transform(new Response(html));
  await transformed.text();

  const snippetsByUrl = new Map(
    snippets.map((entry) => [decodeDuckDuckGoUrl(entry.href), entry.text.trim()])
  );
  const results: SearchResult[] = [];
  for (const entry of titles) {
    const url = decodeDuckDuckGoUrl(entry.href);
    const title = entry.text.replace(/\s+/g, " ").trim();
    if (!url.startsWith("http") || !title || url.includes("duckduckgo.com")) continue;
    results.push({
      title,
      url,
      description: (snippetsByUrl.get(url) || "").replace(/\s+/g, " ").trim(),
      siteName: safeHostname(url),
    });
    if (results.length >= count) break;
  }
  return results;
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

export type WebSearchBackend =
  | "firecrawl"
  | "parallel"
  | "tavily"
  | "exa"
  | "brave"
  | "searxng"
  | "duckduckgo";

export function selectSearchBackends(env: Record<string, string | undefined>): WebSearchBackend[] {
  const order: WebSearchBackend[] = [];
  if (firecrawlConfigured(env)) order.push("firecrawl");
  if (parallelConfigured(env)) order.push("parallel");
  if (env.TAVILY_API_KEY) order.push("tavily");
  if (env.EXA_API_KEY) order.push("exa");
  if (env.BRAVE_API_KEY) order.push("brave");
  if (env.SEARXNG_URL || env.SEARXNG_BASE_URL) order.push("searxng");
  order.push("duckduckgo");
  return order;
}

function backendIsConfigured(
  backend: WebSearchBackend,
  env: Record<string, string | undefined>
): boolean {
  if (backend === "duckduckgo") return true;
  if (backend === "firecrawl") return firecrawlConfigured(env);
  if (backend === "parallel") return parallelConfigured(env);
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
  env: Record<string, string | undefined>,
  args: Record<string, unknown>
): Promise<SearchResponse> {
  const start = Date.now();
  switch (backend) {
    case "firecrawl":
      return searchFirecrawl(query, count, env, {
        categories: stringList(args.categories),
        includeDomains: stringList(args.includeDomains),
        excludeDomains: stringList(args.excludeDomains),
        timeRange: optionalString(args.timeRange),
        location: optionalString(args.location),
        country: optionalString(args.country),
      }).then((results) => ({
        query,
        provider: "firecrawl",
        count: results.length,
        tookMs: Date.now() - start,
        results,
      }));
    case "parallel": {
      const apiKey = env.PARALLEL_API_KEY;
      if (!apiKey) return Promise.reject(new Error("PARALLEL_API_KEY is not configured"));
      return searchParallel(query, count, apiKey).then((results) => ({
        query,
        provider: "parallel",
        count: results.length,
        tookMs: Date.now() - start,
        results,
      }));
    }
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : []
  );
  return values.length > 0 ? values : undefined;
}

function requestedBackend(value: unknown): WebSearchBackend | undefined {
  const supported = new Set<WebSearchBackend>([
    "firecrawl",
    "parallel",
    "tavily",
    "exa",
    "brave",
    "searxng",
    "duckduckgo",
  ]);
  return typeof value === "string" && supported.has(value as WebSearchBackend)
    ? (value as WebSearchBackend)
    : undefined;
}

function normalizedDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed.replace(/^\*\./, "");
  }
}

function matchesDomain(url: string, domain: string): boolean {
  const expected = normalizedDomain(domain);
  if (!expected) return false;
  try {
    const actual = new URL(url).hostname.toLowerCase();
    return actual === expected || actual.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

function filterByRequestedDomains(
  results: SearchResult[],
  includeDomains: string[] | undefined,
  excludeDomains: string[] | undefined
): SearchResult[] {
  return results.filter((result) => {
    if (
      includeDomains?.length &&
      !includeDomains.some((domain) => matchesDomain(result.url, domain))
    ) {
      return false;
    }
    return !excludeDomains?.some((domain) => matchesDomain(result.url, domain));
  });
}

export async function handleWebSearch(args: Record<string, unknown>): Promise<SearchResponse> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const count = Math.min(
    Math.max(1, (args.count as number) || DEFAULT_SEARCH_COUNT),
    MAX_SEARCH_COUNT
  );

  if (!query) {
    throw new Error("query is required");
  }
  if (query.length > 500) throw new Error("query must be 500 characters or fewer");

  const includeDomains = stringList(args.includeDomains);
  const excludeDomains = stringList(args.excludeDomains);
  if (includeDomains?.length && excludeDomains?.length) {
    throw new Error("includeDomains and excludeDomains cannot be used together");
  }

  const requested = requestedBackend(args.provider);
  const cacheKey = `${getCacheKey(query, count)}:${requested || "auto"}:${JSON.stringify({
    categories: stringList(args.categories),
    includeDomains,
    excludeDomains,
    timeRange: optionalString(args.timeRange),
    location: optionalString(args.location),
    country: optionalString(args.country),
  })}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const backends = resolveSearchBackends(requested, process.env);

  const errors: string[] = [];
  for (const backend of backends) {
    try {
      const result = await runBackend(backend, query, count, process.env, args);
      result.results = filterByRequestedDomains(result.results, includeDomains, excludeDomains);
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
