interface AssistantAuthorMessage {
  role: string;
  agent_id?: string;
  agent_name?: string;
  model?: string;
}

function trimmed(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

export function hasMixedAssistantAuthors(messages: readonly AssistantAuthorMessage[]): boolean {
  const authors = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const agentId = trimmed(message.agent_id);
    if (agentId) authors.add(agentId);
    if (authors.size > 1) return true;
  }
  return false;
}

export function assistantAuthorLabel(message: AssistantAuthorMessage): string | null {
  if (message.role !== "assistant") return null;
  const agentName = trimmed(message.agent_name);
  const model = trimmed(message.model);
  if (!agentName) return model || null;
  return model ? `${agentName} · ${model}` : agentName;
}
