import { useMemo } from "react";
import type { AgentSummary, BotRosterItem } from "@/types";

export function useCurrentBot(
  botRoster: readonly BotRosterItem[],
  sessionId: string | null
): BotRosterItem | null {
  return useMemo(
    () => botRoster.find((bot) => bot.session_id === sessionId) ?? null,
    [botRoster, sessionId]
  );
}

export function useComposerAgents(
  agents: readonly AgentSummary[],
  currentBot: BotRosterItem | null
): AgentSummary[] {
  return useMemo(
    () =>
      currentBot
        ? agents.filter((agent) => agent.id === currentBot.id)
        : agents.filter((agent) => !agent.is_bot),
    [agents, currentBot]
  );
}
