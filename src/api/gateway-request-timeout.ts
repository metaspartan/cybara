const UNBOUNDED_GATEWAY_REQUESTS = new Set([
  "GET /api/sse/status",
  "POST /api/chat",
  "POST /api/subagents/wait",
]);

export function gatewayRequestIdleTimeoutSeconds(method: string, pathname: string): number | null {
  const key = `${method.trim().toUpperCase()} ${pathname.trim()}`;
  return UNBOUNDED_GATEWAY_REQUESTS.has(key) ? 0 : null;
}
