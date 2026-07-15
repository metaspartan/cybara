export const VERTEX_ANTHROPIC_VERSION = "vertex-2023-10-16";

export function anthropicEndpointPath(modelId: string, vertex: boolean): string {
  return vertex ? `/${modelId}:rawPredict` : "/messages";
}

export function anthropicRequestBase(
  modelId: string,
  messages: unknown,
  maxTokens: number,
  vertex: boolean
): Record<string, unknown> {
  return vertex
    ? { anthropic_version: VERTEX_ANTHROPIC_VERSION, messages, max_tokens: maxTokens }
    : { model: modelId, messages, max_tokens: maxTokens };
}

export function anthropicRequestHeaders(
  auth: string,
  vertex: boolean,
  oauth = false
): Record<string, string> {
  if (vertex) return { "Content-Type": "application/json", Authorization: `Bearer ${auth}` };
  if (oauth) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    };
  }
  return {
    "Content-Type": "application/json",
    "x-api-key": auth,
    "anthropic-version": "2023-06-01",
  };
}
