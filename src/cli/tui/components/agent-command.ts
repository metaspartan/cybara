import { resolveAgentIdentifier } from "../../commands/agent-resolution";
import { agentLine, type AgentSummary, isRecord } from "../interactive-chat-data";
import type { TUIFetchAPI } from "./chat";

export interface AgentCommandContext {
  argument: string;
  agents: AgentSummary[];
  localSessionId: string | null;
  loadControlPlane: () => Promise<{ agents: AgentSummary[] }>;
  fetchAPI: TUIFetchAPI;
  setUseModelRouter: (value: boolean) => void;
  setSelectedAgentId: (value: string) => void;
  setNotice: (message: string) => void;
}

export async function handleAgentCommand(context: AgentCommandContext): Promise<boolean> {
  const {
    argument,
    agents,
    localSessionId,
    loadControlPlane,
    fetchAPI,
    setUseModelRouter,
    setSelectedAgentId,
    setNotice,
  } = context;
  if (!argument) {
    setNotice("Usage: /agent <id|name|default|router>");
    return true;
  }
  const availableAgents = agents.length ? agents : (await loadControlPlane()).agents;
  if (argument === "router") {
    setUseModelRouter(true);
    setNotice("Model router selected for future sends.");
    return true;
  }
  if (argument === "default") {
    setUseModelRouter(false);
    setSelectedAgentId("");
    setNotice("Gateway default selected for new sessions.");
    return true;
  }
  const agentId = resolveAgentIdentifier(argument, availableAgents);
  if (!agentId) {
    setNotice("Agent not found. Use /agents to list available agents.");
    return true;
  }
  setUseModelRouter(false);
  setSelectedAgentId(agentId);
  const nextAgent = availableAgents.find((agent) => agent.id === agentId);
  if (localSessionId) {
    const response = await fetchAPI<unknown>(
      `/api/sessions/${encodeURIComponent(localSessionId)}/agent`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      }
    );
    if (isRecord(response) && response.success === false) {
      setNotice(
        typeof response.error === "string" ? response.error : "Failed to update session agent."
      );
      return true;
    }
    if (isRecord(response) && response.appliesNextTurn === true) {
      setNotice(
        `Agent selected: ${nextAgent ? agentLine(nextAgent) : agentId} (takes effect on your next message)`
      );
      return true;
    }
  }
  setNotice(`Agent selected: ${nextAgent ? agentLine(nextAgent) : agentId}`);
  return true;
}
