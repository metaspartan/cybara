export interface McpRpcResult {
  result?: unknown;
  error?: { code?: number; message?: string };
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
      } catch {
        /* skip non-JSON data frames */
      }
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
