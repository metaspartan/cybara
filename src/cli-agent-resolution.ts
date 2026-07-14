export interface AgentIdentifierCandidate {
  id?: string;
  name?: string;
  model?: string;
}

export function resolveAgentIdentifier(
  query: string,
  agents: AgentIdentifierCandidate[]
): string | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const exact = agents.find(
    (agent) =>
      agent.id?.toLowerCase() === needle ||
      agent.name?.trim().toLowerCase() === needle ||
      agent.model?.trim().toLowerCase() === needle
  );
  if (exact?.id) return exact.id;

  const partial = agents.find(
    (agent) =>
      agent.name?.toLowerCase().includes(needle) ||
      agent.model?.toLowerCase().includes(needle) ||
      agent.id?.toLowerCase().startsWith(needle)
  );
  return partial?.id ?? null;
}
