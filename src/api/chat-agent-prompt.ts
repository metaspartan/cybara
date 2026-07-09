import type { Agent } from "../core/database";
import {
  isLegacyBuiltinSnapshot,
  normalizeExplicitAgentTools,
} from "../core/agent-tool-normalization";
import { selectBuiltinToolNamesForIntent } from "../core/agent-tool-intent";
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

interface ChatAgentPromptOptions {
  useTools?: boolean;
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
    trimmed.includes("### Wallet Tool") ||
    trimmed.includes("TOOLS - USE THEM!")
  );
}

function chatAgentToolNames(
  agent: Pick<Agent, "tools">,
  messages: ChatAgentPromptMessage[] = [],
  options: ChatAgentPromptOptions = {}
): string[] {
  if (options.useTools === false) return [];
  const selection = resolveAgentToolSelection(agent.tools);
  if (selection.kind === "malformed") return [];
  if (selection.kind === "explicit") {
    if (isLegacyBuiltinSnapshot(selection.tools)) {
      const selected = selectBuiltinToolNamesForIntent(messages);
      if (selected.size === 0) return [];
      return getToolSchemasForLLM()
        .map((tool) => tool.name)
        .filter((name) => selected.has(name));
    }
    return normalizeExplicitAgentTools(selection.tools)
      .filter((tool) => isToolEnabledForAgent(tool.name))
      .map((tool) => tool.name);
  }
  const selected = selectBuiltinToolNamesForIntent(messages);
  if (selected.size === 0) return [];
  return getToolSchemasForLLM()
    .map((tool) => tool.name)
    .filter((name) => selected.has(name));
}

export async function activeAgentSystemPrompt(
  agent: AgentPromptData,
  workspaceDir?: string | null,
  messages: ChatAgentPromptMessage[] = [],
  options: ChatAgentPromptOptions = {}
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
    tools: chatAgentToolNames(agent, messages, options),
    skills,
    sandboxInfo: getSandboxPromptInfo(homeDir),
    extraSystemPrompt:
      storedPrompt && !isGeneratedAgentPrompt(storedPrompt) ? storedPrompt : undefined,
  });
}

export async function applyActiveAgentToSession(
  session: ChatAgentPromptSession,
  agent: AgentPromptData,
  messages?: ChatAgentPromptMessage[],
  options: ChatAgentPromptOptions = {}
): Promise<void> {
  session.agentId = agent.id;
  const prompt = await activeAgentSystemPrompt(
    agent,
    session.workspaceDir,
    messages || session.messages,
    options
  );
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
  agent: AgentPromptData,
  messages?: ChatAgentPromptMessage[],
  options: ChatAgentPromptOptions = {}
): Promise<void> {
  const firstMessage = session.messages[0];
  if (firstMessage?.role !== "system") {
    await applyActiveAgentToSession(session, agent, messages, options);
    return;
  }
  const toolNames = chatAgentToolNames(agent, messages || session.messages, options);
  const expectsWallet = toolNames.includes("wallet");
  const hasWalletPrompt = firstMessage.content.includes("### Wallet Tool");
  const isBuiltinSelection = resolveAgentToolSelection(agent.tools).kind === "builtins";
  if (
    isBuiltinSelection ||
    options.useTools === false ||
    !firstMessage.content.includes("## Tooling") ||
    expectsWallet !== hasWalletPrompt
  ) {
    await applyActiveAgentToSession(session, agent, messages, options);
  }
}
