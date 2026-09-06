import type { AgentSummary } from "@/types";

export interface SessionAgentIdentity {
  name: string;
  isBot: boolean;
}

export function buildSessionAgentIdentities(
  agents: AgentSummary[]
): Map<string, SessionAgentIdentity> {
  return new Map(
    agents.map((agent) => [agent.id, { name: agent.name, isBot: agent.is_bot === true }])
  );
}

export function resolveSessionAgentIdentity(
  identities: Map<string, SessionAgentIdentity>,
  agentId: string
): SessionAgentIdentity {
  return identities.get(agentId) || { name: agentId, isBot: false };
}
