import { agentManager } from "../core/agent";
import {
  estimateSessionContextUsage,
  type SessionContextUsage,
  summarizeSessionTokenUsage,
  type SessionTokenUsage,
} from "../core/session-context";
import { resolveTurnContextWindow } from "./chat-turn-context";

export interface SessionUsageSubject {
  id: string;
  agentId?: string;
  compactionCount?: number;
}

export function sessionAgentContextWindowTokens(
  agentId: string | undefined,
  model: string | undefined
): number | undefined {
  if (!agentId) return undefined;
  const agent = agentManager.get(agentId);
  if (!agent) return undefined;
  return resolveTurnContextWindow(agent, model).contextWindowTokens;
}

export function buildSessionUsageFields(
  session: SessionUsageSubject,
  messages: Array<{ role: string; content: string }>,
  model?: string
): { contextUsage: SessionContextUsage; tokenUsage: SessionTokenUsage } {
  return {
    contextUsage: estimateSessionContextUsage(
      messages as Parameters<typeof estimateSessionContextUsage>[0],
      model,
      {
        sessionId: session.id,
        compactionCount: session.compactionCount || 0,
        contextWindowTokens: sessionAgentContextWindowTokens(session.agentId, model),
      }
    ),
    tokenUsage: summarizeSessionTokenUsage(session.id),
  };
}
