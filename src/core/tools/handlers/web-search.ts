// Tool handlers - web search
// Supports Brave API (if key available) or DuckDuckGo HTML scraping as fallback

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple in-memory cache
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
  // Cleanup old entries
  if (searchCache.size > 100) {
    const oldest = Array.from(searchCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 50);
    oldest.forEach(([k]) => searchCache.delete(k));
  }
}

// Brave Search API
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

// DuckDuckGo HTML scraping (fallback, no API key needed)
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

  // Parse results from HTML
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
      // DDG wraps URLs in their redirect, extract actual URL
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

  // If regex didn't work, try simpler approach
  if (results.length === 0) {
    // Fallback: extract any http/https links
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

export async function handleWebSearch(args: Record<string, unknown>): Promise<SearchResponse> {
  const query = args.query as string;
  const count = Math.min(
    Math.max(1, (args.count as number) || DEFAULT_SEARCH_COUNT),
    MAX_SEARCH_COUNT
  );

  if (!query) {
    throw new Error("query is required");
  }

  // Check cache
  const cacheKey = getCacheKey(query, count);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Try Brave API first (if key available)
  const braveApiKey = process.env.BRAVE_API_KEY;

  try {
    let result: SearchResponse;

    if (braveApiKey) {
      result = await searchWithBrave(query, count, braveApiKey);
    } else {
      // Fallback to DuckDuckGo
      result = await searchWithDDG(query, count);
    }

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    // If Brave fails, try DuckDuckGo
    if (braveApiKey) {
      try {
        const fallback = await searchWithDDG(query, count);
        setCache(cacheKey, fallback);
        return fallback;
      } catch (fallbackError) {
        throw new Error(
          `All search providers failed: ${(error as Error).message}, DDG: ${(fallbackError as Error).message}`
        );
      }
    }
    throw error;
  }
}
