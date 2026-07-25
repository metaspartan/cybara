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

export function resolveLatestAssistantAuthor(
  messages: readonly AgentHandoffMessage[]
): InheritedAgentAuthor | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const agentId = normalized(message.agent_id);
    if (!agentId) return undefined;
    return {
      agentId,
      agentName: normalized(message.agent_name) || agentId,
      model: normalized(message.model) || undefined,
    };
  }
  return undefined;
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
  const latest = resolveLatestAssistantAuthor(messages);
  const latestLine =
    latest && latest.agentId !== normalized(activeAgentId)
      ? `The most recent assistant turn was written by ${describeAuthor(latest)}, so "continue" refers to that agent's work.`
      : "";
  return [
    `Some earlier assistant turns in this conversation were written by other agents: ${roster}.`,
    `Those turns start with an author tag like "${AGENT_ATTRIBUTION_PREFIX_EXAMPLE}" so you can tell who wrote what. Untagged assistant turns are your own. Never write that tag yourself.`,
    latestLine,
    "You are the active agent now and you inherited that work as shared context.",
    "Build on it and treat its decisions as already made. Do not claim you personally produced it, do not re-introduce yourself, and do not redo or re-plan work that is already complete.",
    "If an earlier turn described a limitation, re-check it against your own tools before repeating it.",
  ]
    .filter(Boolean)
    .join("\n");
}

export const AGENT_ATTRIBUTION_PREFIX_EXAMPLE = "[written by Mini (MiniMax-M3)]";

export function agentAttributionPrefix(message: AgentHandoffMessage): string | undefined {
  const agentName = normalized(message.agent_name);
  if (!agentName) return undefined;
  const model = normalized(message.model);
  return model ? `[written by ${agentName} (${model})]` : `[written by ${agentName}]`;
}

/**
 * Tag assistant turns that a different agent wrote so the active agent can
 * attribute earlier work without guessing or searching for it.
 */
export function attributeInheritedAssistantContent(
  message: AgentHandoffMessage & { content: string },
  activeAgentId?: string
): string {
  const activeId = normalized(activeAgentId);
  const agentId = normalized(message.agent_id);
  if (message.role !== "assistant" || !activeId || !agentId || agentId === activeId) {
    return message.content;
  }
  const prefix = agentAttributionPrefix(message);
  return prefix ? `${prefix}\n${message.content}` : message.content;
}
