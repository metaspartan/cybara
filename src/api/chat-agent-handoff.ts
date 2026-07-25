export interface AgentHandoffMessage {
  role: "user" | "assistant" | "system";
  agent_id?: string;
  agent_name?: string;
  model?: string;
}

export interface InheritedAgentAuthor {
  agentId: string;
  agentName: string;
  model?: string;
}

const MAX_LISTED_AUTHORS = 4;

function normalized(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveInheritedAgentAuthors(
  messages: readonly AgentHandoffMessage[],
  activeAgentId?: string
): InheritedAgentAuthor[] {
  const activeId = normalized(activeAgentId);
  if (!activeId) return [];
  const authors = new Map<string, InheritedAgentAuthor>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const agentId = normalized(message.agent_id);
    if (!agentId || agentId === activeId || authors.has(agentId)) continue;
    authors.set(agentId, {
      agentId,
      agentName: normalized(message.agent_name) || agentId,
      model: normalized(message.model) || undefined,
    });
  }
  return [...authors.values()];
}

function describeAuthor(author: InheritedAgentAuthor): string {
  return author.model ? `${author.agentName} (${author.model})` : author.agentName;
}

export function buildAgentHandoffInstruction(
  messages: readonly AgentHandoffMessage[],
  activeAgentId?: string
): string | undefined {
  const authors = resolveInheritedAgentAuthors(messages, activeAgentId);
  if (authors.length === 0) return undefined;
  const listed = authors.slice(0, MAX_LISTED_AUTHORS).map(describeAuthor).join(", ");
  const remaining = authors.length - Math.min(authors.length, MAX_LISTED_AUTHORS);
  const roster = remaining > 0 ? `${listed}, and ${remaining} more` : listed;
  return [
    `Some earlier assistant turns in this conversation were written by other agents: ${roster}.`,
    "You are the active agent now and you inherited that work as shared context.",
    "Build on it and treat its decisions as already made. Do not claim you personally produced it, do not re-introduce yourself, and do not redo or re-plan work that is already complete.",
    "If an earlier turn described a limitation, re-check it against your own tools before repeating it.",
  ].join("\n");
}
