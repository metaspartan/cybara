import {
  connectorBoundedText,
  connectorFetch,
  connectorLimit,
  connectorRecord,
  connectorRequiredString,
  connectorText,
  parseConnectorJson,
} from "./request";
import { getAccountConnectorAccessToken } from "./tokens";

const NOTION_BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

async function notionRequest<T>(path: string, init?: RequestInit, write = false): Promise<T> {
  const token = await getAccountConnectorAccessToken("notion", write);
  const response = await connectorFetch(`${NOTION_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      Accept: "application/json",
      ...init?.headers,
    },
  });
  return parseConnectorJson<T>(response);
}

export async function notionSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = connectorText(args.query);
  const limit = connectorLimit(args.limit);
  const value = await notionRequest<{
    results?: unknown[];
    has_more?: unknown;
    next_cursor?: unknown;
  }>("/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(query ? { query: query.slice(0, 500) } : {}),
      page_size: limit,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    }),
  });
  return {
    connector: "notion",
    service: "workspace",
    untrustedExternalContent: true,
    results: (value.results || []).slice(0, limit),
    hasMore: value.has_more === true,
    nextCursor: connectorText(value.next_cursor),
  };
}

export async function notionRead(args: Record<string, unknown>): Promise<unknown> {
  const pageId = connectorRequiredString(args.pageId, "pageId");
  const encoded = encodeURIComponent(pageId);
  const [page, markdown] = await Promise.all([
    notionRequest<Record<string, unknown>>(`/pages/${encoded}`),
    notionRequest<{
      markdown?: unknown;
      truncated?: unknown;
      unknown_block_ids?: unknown;
    }>(`/pages/${encoded}/markdown`),
  ]);
  return {
    connector: "notion",
    service: "workspace",
    untrustedExternalContent: true,
    page,
    markdown: connectorBoundedText(markdown.markdown, 512 * 1024),
    truncated: markdown.truncated === true,
    unknownBlockIds: Array.isArray(markdown.unknown_block_ids)
      ? markdown.unknown_block_ids.slice(0, 100)
      : [],
  };
}

export async function notionCreatePage(args: Record<string, unknown>): Promise<unknown> {
  const parentPageId = connectorRequiredString(args.parentPageId, "parentPageId");
  const title = connectorRequiredString(args.title, "title").slice(0, 2_000);
  const content = connectorText(args.content)?.slice(0, 10_000);
  const page = await notionRequest<Record<string, unknown>>(
    "/pages",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parent: { type: "page_id", page_id: parentPageId },
        properties: { title: { title: [{ type: "text", text: { content: title } }] } },
        ...(content ? { markdown: content } : {}),
      }),
    },
    true
  );
  return {
    connector: "notion",
    service: "workspace",
    created: true,
    page: connectorRecord(page),
  };
}
