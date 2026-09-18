import { mcpManager } from "../../mcp";
import type { ExternalWebSearchResult } from "./web-research-providers";
import {
  WEB_SEARCH_MCP_COUNT_ARG_ENV,
  WEB_SEARCH_MCP_QUERY_ARG_ENV,
  WEB_SEARCH_MCP_SERVER_ENV,
  WEB_SEARCH_MCP_TOOL_ENV,
} from "./web-search-backends";

const ROW_CONTAINER_KEYS = [
  "results",
  "items",
  "data",
  "organic",
  "organic_results",
  "web",
  "hits",
  "documents",
  "sources",
];
const URL_KEYS = ["url", "link", "href", "uri", "source"];
const TITLE_KEYS = ["title", "name", "heading"];
const DESCRIPTION_KEYS = ["description", "snippet", "content", "text", "summary", "body"];
const MAX_DESCRIPTION_CHARS = 600;
const MAX_ROW_SEARCH_DEPTH = 3;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS);
}

function rowToResult(row: unknown): ExternalWebSearchResult | null {
  if (!isRecord(row)) return null;
  const url = firstString(row, URL_KEYS);
  if (!isHttpUrl(url)) return null;
  return {
    title: firstString(row, TITLE_KEYS) || hostname(url) || url,
    url,
    description: collapse(firstString(row, DESCRIPTION_KEYS)),
    siteName: hostname(url),
  };
}

function findRows(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value) || depth >= MAX_ROW_SEARCH_DEPTH) return [];
  for (const key of ROW_CONTAINER_KEYS) {
    const rows = findRows(value[key], depth + 1);
    if (rows.some((row) => rowToResult(row))) return rows;
  }
  return [];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function resultsFromText(text: string): ExternalWebSearchResult[] {
  const results: ExternalWebSearchResult[] = [];
  for (const line of text.split(/\r?\n/)) {
    const markdown = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(line);
    const bare = /https?:\/\/[^\s<>"')\]]+/.exec(line);
    const url = markdown?.[2] ?? bare?.[0];
    if (!url || !isHttpUrl(url)) continue;
    const remainder = line
      .replace(markdown?.[0] ?? url, "")
      .replace(/^[\s\-*\d.:)|]+/, "")
      .trim();
    results.push({
      title: markdown?.[1]?.trim() || hostname(url) || url,
      url,
      description: collapse(remainder),
      siteName: hostname(url),
    });
  }
  return results;
}

function textBlocks(result: JsonRecord): string[] {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.flatMap((item) =>
    isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []
  );
}

function resourceRows(result: JsonRecord): unknown[] {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (item.type === "resource_link") return [item];
    if (item.type === "resource" && isRecord(item.resource)) return [item.resource];
    return [];
  });
}

function dedupe(results: ExternalWebSearchResult[], count: number): ExternalWebSearchResult[] {
  const seen = new Set<string>();
  const unique: ExternalWebSearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    unique.push(result);
    if (unique.length >= count) break;
  }
  return unique;
}

export function normalizeMcpSearchResults(
  result: unknown,
  count: number
): ExternalWebSearchResult[] {
  if (!isRecord(result)) {
    const rows = findRows(result).flatMap((row) => rowToResult(row) ?? []);
    return dedupe(rows, count);
  }
  const texts = textBlocks(result);
  if (result.isError === true) {
    throw new Error(collapse(texts.join(" ")) || "MCP search tool reported an error");
  }

  const structured = [result.structuredContent, result, ...texts.map(parseJson)];
  for (const candidate of structured) {
    const rows = findRows(candidate).flatMap((row) => rowToResult(row) ?? []);
    if (rows.length > 0) return dedupe(rows, count);
  }

  const resources = resourceRows(result).flatMap((row) => rowToResult(row) ?? []);
  if (resources.length > 0) return dedupe(resources, count);

  return dedupe(texts.flatMap(resultsFromText), count);
}

export function buildMcpSearchArguments(
  query: string,
  count: number,
  env: Record<string, string | undefined>
): Record<string, unknown> {
  const queryArg = env[WEB_SEARCH_MCP_QUERY_ARG_ENV]?.trim() || "query";
  const countArg = env[WEB_SEARCH_MCP_COUNT_ARG_ENV]?.trim();
  return countArg ? { [queryArg]: query, [countArg]: count } : { [queryArg]: query };
}

export async function searchWithMcp(
  query: string,
  count: number,
  env: Record<string, string | undefined>
): Promise<ExternalWebSearchResult[]> {
  const server = env[WEB_SEARCH_MCP_SERVER_ENV]?.trim();
  const toolName = env[WEB_SEARCH_MCP_TOOL_ENV]?.trim();
  if (!server || !toolName) throw new Error("MCP search tool is not configured");
  const tool = mcpManager
    .getAllTools()
    .find(
      (candidate) =>
        (candidate.serverId === server || candidate.serverName === server) &&
        candidate.name === toolName
    );
  if (!tool) {
    throw new Error(`MCP server "${server}" is not running or does not expose "${toolName}"`);
  }
  const result = await mcpManager.callTool(
    tool.serverId,
    tool.name,
    buildMcpSearchArguments(query, count, env)
  );
  return normalizeMcpSearchResults(result, count);
}
