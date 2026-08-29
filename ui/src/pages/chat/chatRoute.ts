export interface InitialChatRoute {
  agentId: string | null;
  sessionId: string | null;
  workspaceDir: string | null;
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
    workspaceDir: normalizedParam(params, "workspace"),
    startFresh: params.get("fresh") === "1",
  };
}

export function buildAgentChatPath(agentId: string): string {
  const params = new URLSearchParams({ agent: agentId.trim(), fresh: "1" });
  return `/chat?${params.toString()}`;
}

export function buildSessionChatPath(sessionId: string): string {
  const params = new URLSearchParams({ session: sessionId.trim() });
  return `/chat?${params.toString()}`;
}

export function buildFreshChatPath(workspaceDir?: string | null, requestId?: string): string {
  const params = new URLSearchParams({
    fresh: "1",
    request: requestId?.trim() || crypto.randomUUID(),
  });
  const workspace = workspaceDir?.trim();
  if (workspace) params.set("workspace", workspace);
  return `/chat?${params.toString()}`;
}
