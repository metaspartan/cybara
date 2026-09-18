import { firecrawlConfigured, parallelConfigured } from "./web-research-providers";

export const WEB_SEARCH_BACKEND_IDS = [
  "firecrawl",
  "parallel",
  "tavily",
  "exa",
  "brave",
  "mcp",
  "searxng",
  "duckduckgo",
] as const;

export type WebSearchBackend = (typeof WEB_SEARCH_BACKEND_IDS)[number];

export const WEB_SEARCH_BACKEND_LABELS: Record<WebSearchBackend, string> = {
  firecrawl: "Firecrawl",
  parallel: "Parallel",
  tavily: "Tavily",
  exa: "Exa",
  brave: "Brave Search",
  mcp: "MCP tool",
  searxng: "SearXNG",
  duckduckgo: "DuckDuckGo",
};

export const WEB_SEARCH_ORDER_ENV = "WEB_SEARCH_ORDER";
export const WEB_SEARCH_DISABLED_ENV = "WEB_SEARCH_DISABLED";
export const WEB_SEARCH_MCP_SERVER_ENV = "WEB_SEARCH_MCP_SERVER";
export const WEB_SEARCH_MCP_TOOL_ENV = "WEB_SEARCH_MCP_TOOL";
export const WEB_SEARCH_MCP_QUERY_ARG_ENV = "WEB_SEARCH_MCP_QUERY_ARG";
export const WEB_SEARCH_MCP_COUNT_ARG_ENV = "WEB_SEARCH_MCP_COUNT_ARG";

type Env = Record<string, string | undefined>;

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isWebSearchBackend(value: unknown): value is WebSearchBackend {
  return typeof value === "string" && (WEB_SEARCH_BACKEND_IDS as readonly string[]).includes(value);
}

export function parseBackendList(value: string | undefined): WebSearchBackend[] {
  const seen = new Set<WebSearchBackend>();
  for (const item of (value ?? "").split(",")) {
    const id = item.trim().toLowerCase();
    if (isWebSearchBackend(id)) seen.add(id);
  }
  return [...seen];
}

export function orderedSearchBackends(env: Env): WebSearchBackend[] {
  const preferred = parseBackendList(env[WEB_SEARCH_ORDER_ENV]);
  return [...preferred, ...WEB_SEARCH_BACKEND_IDS.filter((id) => !preferred.includes(id))];
}

export function disabledSearchBackends(env: Env): WebSearchBackend[] {
  return parseBackendList(env[WEB_SEARCH_DISABLED_ENV]);
}

export function backendIsConfigured(backend: WebSearchBackend, env: Env): boolean {
  switch (backend) {
    case "firecrawl":
      return firecrawlConfigured(env);
    case "parallel":
      return parallelConfigured(env);
    case "tavily":
      return present(env.TAVILY_API_KEY);
    case "exa":
      return present(env.EXA_API_KEY);
    case "brave":
      return present(env.BRAVE_API_KEY);
    case "mcp":
      return present(env[WEB_SEARCH_MCP_SERVER_ENV]) && present(env[WEB_SEARCH_MCP_TOOL_ENV]);
    case "searxng":
      return present(env.SEARXNG_URL) || present(env.SEARXNG_BASE_URL);
    case "duckduckgo":
      return true;
  }
}

function backendIsUsable(backend: WebSearchBackend, env: Env): boolean {
  return !disabledSearchBackends(env).includes(backend) && backendIsConfigured(backend, env);
}

export function selectSearchBackends(env: Env): WebSearchBackend[] {
  return orderedSearchBackends(env).filter((backend) => backendIsUsable(backend, env));
}

export function resolveSearchBackends(
  requested: WebSearchBackend | undefined,
  env: Env
): WebSearchBackend[] {
  const automatic = selectSearchBackends(env);
  if (!requested || !backendIsUsable(requested, env)) return automatic;
  return [requested, ...automatic.filter((backend) => backend !== requested)];
}
