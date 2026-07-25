import type { SessionMessageSummary } from "../lib/api";

function trimmed(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

export function mobileTranscriptHasMixedAuthors(
  messages: readonly SessionMessageSummary[]
): boolean {
  const authors = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const agentId = trimmed(message.agentId);
    if (agentId) authors.add(agentId);
    if (authors.size > 1) return true;
  }
  return false;
}

export function mobileMessageAuthorLabel(message: SessionMessageSummary): string | null {
  if (message.role !== "assistant") return null;
  const agentName = trimmed(message.agentName);
  const model = trimmed(message.model);
  if (!agentName) return model || null;
  return model ? `${agentName} · ${model}` : agentName;
}
