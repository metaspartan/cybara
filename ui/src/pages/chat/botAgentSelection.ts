import type { AgentSummary } from "@/types";

export function selectableBotBaseAgents(agents: AgentSummary[]): AgentSummary[] {
  return agents.filter((agent) => agent.is_bot !== true);
}

export function resolveBotBaseAgentId(agents: AgentSummary[], requestedId: string): string {
  if (agents.some((agent) => agent.id === requestedId)) return requestedId;
  return agents[0]?.id ?? "";
}
