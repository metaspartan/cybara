export interface InitialChatRoute {
  agentId: string | null;
  sessionId: string | null;
  startFresh: boolean;
}

function normalizedParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value || null;
}

export function parseInitialChatRoute(search: string): InitialChatRoute {
  const params = new URLSearchParams(search);
  return {
    agentId: normalizedParam(params, "agent"),
    sessionId: normalizedParam(params, "session"),
    startFresh: params.get("fresh") === "1",
  };
}

export function buildAgentChatPath(agentId: string): string {
  const params = new URLSearchParams({ agent: agentId.trim(), fresh: "1" });
  return `/chat?${params.toString()}`;
}
