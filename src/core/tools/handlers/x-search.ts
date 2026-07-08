/**
 * X / Twitter search via xAI Grok "Live Search". Grok can search X (Twitter) in
 * real time through the chat-completions API with `search_parameters` scoped to
 * the `x` source. Requires XAI_API_KEY (the xAI/Grok provider key).
 */

const XAI_CHAT_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4-fast";
const DEFAULT_MAX_RESULTS = 15;

export interface XSearchRequestOptions {
  query: string;
  model?: string;
  maxResults?: number;
  fromHandles?: string[];
  excludeHandles?: string[];
  fromDate?: string; // ISO yyyy-mm-dd
  toDate?: string;
}

export interface XSearchCitation {
  url: string;
}

export interface XSearchResponse {
  query: string;
  provider: "xai";
  model: string;
  answer: string;
  citations: string[];
  tookMs: number;
}

/**
 * Build the xAI Live Search request body. Pure so the source/parameter shaping
 * is unit-testable without hitting the network.
 */
export function buildXSearchBody(options: XSearchRequestOptions): Record<string, unknown> {
  const maxResults = Math.min(Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS), 30);
  const xSource: Record<string, unknown> = { type: "x" };
  if (options.fromHandles?.length) {
    xSource.included_x_handles = options.fromHandles.map(stripAt).slice(0, 10);
  }
  if (options.excludeHandles?.length) {
    xSource.excluded_x_handles = options.excludeHandles.map(stripAt).slice(0, 10);
  }

  const searchParameters: Record<string, unknown> = {
    mode: "on", // force live search rather than letting the model decide
    sources: [xSource],
    max_search_results: maxResults,
    return_citations: true,
  };
  if (options.fromDate) searchParameters.from_date = options.fromDate;
  if (options.toDate) searchParameters.to_date = options.toDate;

  return {
    model: options.model || DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You search X (Twitter) and summarize what people are actually posting. Cite specific posts and accounts. Be concise and factual; do not speculate beyond the search results.",
      },
      { role: "user", content: options.query },
    ],
    search_parameters: searchParameters,
  };
}

export function extractCitations(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  // xAI returns citations either at the top level or under the message.
  const top = record.citations;
  if (Array.isArray(top)) {
    return top.filter((c): c is string => typeof c === "string");
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const message = (choices[0] as Record<string, unknown>).message as
      | Record<string, unknown>
      | undefined;
    const msgCitations = message?.citations;
    if (Array.isArray(msgCitations)) {
      return msgCitations.filter((c): c is string => typeof c === "string");
    }
  }
  return [];
}

function stripAt(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

export async function handleXSearch(args: Record<string, unknown>): Promise<XSearchResponse> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("query is required");
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "X search requires an xAI/Grok API key. Set XAI_API_KEY (the xAI provider key)."
    );
  }

  const model = typeof args.model === "string" ? args.model : DEFAULT_MODEL;
  const body = buildXSearchBody({
    query,
    model,
    maxResults: typeof args.count === "number" ? args.count : undefined,
    fromHandles: Array.isArray(args.fromHandles)
      ? (args.fromHandles as unknown[]).filter((h): h is string => typeof h === "string")
      : undefined,
    excludeHandles: Array.isArray(args.excludeHandles)
      ? (args.excludeHandles as unknown[]).filter((h): h is string => typeof h === "string")
      : undefined,
    fromDate: typeof args.fromDate === "string" ? args.fromDate : undefined,
    toDate: typeof args.toDate === "string" ? args.toDate : undefined,
  });

  const start = Date.now();
  const response = await fetch(XAI_CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `xAI search error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = data.choices?.[0]?.message?.content || "";

  return {
    query,
    provider: "xai",
    model,
    answer,
    citations: extractCitations(data),
    tookMs: Date.now() - start,
  };
}
