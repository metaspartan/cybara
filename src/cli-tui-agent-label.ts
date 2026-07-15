export interface TUIAgentLabelSource {
  id?: string;
  name?: string;
  model?: string;
}

export function formatTUIAgentLabel(agent: TUIAgentLabelSource): string {
  const name = agent.name?.trim() || agent.id?.trim() || "";
  const model = agent.model?.trim() || "";
  return [name, model].filter(Boolean).join(" · ") || "Unnamed agent";
}
