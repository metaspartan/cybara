import type { Agent } from "../core/database";
import { normalizeExplicitAgentTools } from "../core/agent-tool-normalization";
import { resolveAgentToolSelection } from "../core/agent-tool-selection";
import { config } from "../core/config";
import { getSandboxPromptInfo } from "../core/sandbox";
import { createEligibilityContext, filterEligibleSkills, loadAllSkills } from "../core/skills";
import { buildSystemPrompt, AGENT_TYPE_PROMPTS } from "../core/system-prompt";
import { getToolSchemasForLLM, isToolEnabledForAgent } from "../core/tools/index";

type AgentPromptData = Pick<Agent, "id" | "name" | "model" | "tools" | "config" | "system_prompt">;

interface ChatAgentPromptMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

interface ChatAgentPromptSession {
  agentId: string;
  messages: ChatAgentPromptMessage[];
  updatedAt: string;
  workspaceDir?: string | null;
}

function isGeneratedAgentPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return true;
  if (Object.values(AGENT_TYPE_PROMPTS).some((defaultPrompt) => defaultPrompt.trim() === trimmed)) {
    return true;
  }
  return (
    trimmed.includes("## Tooling") ||
    trimmed.includes("Tool availability (filtered by policy):") ||
    trimmed.includes("### Wallet Tool")
  );
}

function chatAgentToolNames(agent: Pick<Agent, "tools">): string[] {
  const selection = resolveAgentToolSelection(agent.tools);
  if (selection.kind === "malformed") return [];
  if (selection.kind === "explicit") {
    return normalizeExplicitAgentTools(selection.tools)
      .filter((tool) => isToolEnabledForAgent(tool.name))
      .map((tool) => tool.name);
  }
  return getToolSchemasForLLM().map((tool) => tool.name);
}

export async function activeAgentSystemPrompt(
  agent: AgentPromptData,
  workspaceDir?: string | null
): Promise<string> {
  const homeDir = workspaceDir || config.getDefaultWorkspaceDir();
  let skills: Awaited<ReturnType<typeof filterEligibleSkills>> = [];
  try {
    skills = filterEligibleSkills(
      await loadAllSkills({ workspaceDir: homeDir }),
      createEligibilityContext()
    );
  } catch {
    skills = [];
  }
  const storedPrompt =
    typeof agent.system_prompt === "string" && agent.system_prompt.trim()
      ? agent.system_prompt.trim()
      : "";
  return buildSystemPrompt({
    workspaceDir: homeDir,
    agentData: { name: agent.name, config: agent.config as string | undefined },
    config: {},
    modelDisplay: agent.model || "MiniMax-M2.5",
    tools: chatAgentToolNames(agent),
    skills,
    sandboxInfo: getSandboxPromptInfo(homeDir),
    extraSystemPrompt:
      storedPrompt && !isGeneratedAgentPrompt(storedPrompt) ? storedPrompt : undefined,
  });
}

export async function applyActiveAgentToSession(
  session: ChatAgentPromptSession,
  agent: AgentPromptData
): Promise<void> {
  session.agentId = agent.id;
  const prompt = await activeAgentSystemPrompt(agent, session.workspaceDir);
  const firstMessage = session.messages[0];
  if (firstMessage?.role === "system") {
    firstMessage.content = prompt;
    firstMessage.timestamp = firstMessage.timestamp || new Date().toISOString();
  } else {
    session.messages.unshift({
      role: "system",
      content: prompt,
      timestamp: new Date().toISOString(),
    });
  }
  session.updatedAt = new Date().toISOString();
}

export async function refreshSessionAgentSystemPromptIfNeeded(
  session: ChatAgentPromptSession,
  agent: AgentPromptData
): Promise<void> {
  const firstMessage = session.messages[0];
  if (firstMessage?.role !== "system") {
    await applyActiveAgentToSession(session, agent);
    return;
  }
  const toolNames = chatAgentToolNames(agent);
  const expectsWallet = toolNames.includes("wallet");
  const hasWalletPrompt = firstMessage.content.includes("### Wallet Tool");
  if (!firstMessage.content.includes("## Tooling") || expectsWallet !== hasWalletPrompt) {
    await applyActiveAgentToSession(session, agent);
  }
}
