export interface SessionAgentSelectionSource {
  agentId: string;
  useModelRouter?: unknown;
  pendingAgentId?: unknown;
  pendingUseModelRouter?: unknown;
}

export interface SessionAgentSelectionView {
  agentId: string;
  useModelRouter: boolean;
  agentSwitchPending: boolean;
}

export function resolveSessionAgentSelectionView(
  session: SessionAgentSelectionSource
): SessionAgentSelectionView {
  const pendingAgentId =
    typeof session.pendingAgentId === "string" && session.pendingAgentId.trim()
      ? session.pendingAgentId.trim()
      : "";
  const pendingUseModelRouter =
    typeof session.pendingUseModelRouter === "boolean" ? session.pendingUseModelRouter : undefined;
  return {
    agentId: pendingAgentId || session.agentId,
    useModelRouter: pendingUseModelRouter ?? session.useModelRouter === true,
    agentSwitchPending: pendingAgentId.length > 0 || pendingUseModelRouter !== undefined,
  };
}
