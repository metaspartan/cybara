import { clearActiveContextUsage } from "../core/llm/session-active-context";
import {
  AGENT_TRANSITION_AUTHORITY,
  type AgentInstructionUpdate,
  collapseInstructionLedger,
} from "../core/agent-instruction-update";
import { getBootstrapContextFiles } from "../core/bootstrap-files";
import { config } from "../core/config";
import db, { type Agent } from "../core/database";
import { hostPythonTooling } from "../core/python-tooling";
import { getSandboxPromptInfo } from "../core/sandbox";
import { createEligibilityContext, filterEligibleSkills, loadAllSkills } from "../core/skills";
import { AGENT_TYPE_PROMPTS, buildSystemPrompt } from "../core/system-prompt";
import { resolveAgentToolPolicy } from "../core/toolsets";

type AgentPromptData = Pick<
  Agent,
  "id" | "name" | "type" | "model" | "provider_id" | "tools" | "config" | "system_prompt"
>;

interface ChatAgentPromptMessage {
  instructionUpdate?: AgentInstructionUpdate;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

interface ChatAgentPromptSession {
  id?: string;
  agentId: string;
  messages: ChatAgentPromptMessage[];
  updatedAt: string;
  workspaceDir?: string | null;
}

interface ChatAgentPromptOptions {
  useTools?: boolean;
  runtimeChannel?: string;
  pendingTransition?: boolean;
}

export function sessionPromptUsesTools(messages: ChatAgentPromptMessage[]): boolean {
  const latest = messages.filter((message) => message.role === "system").at(-1);
  return latest?.content.match(/(?:^|\n)## Tooling\nAvailable tools: ([^\n]*)/)?.[1] !== "none";
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
    trimmed.includes("## Tool Use\nUse available tools when they improve accuracy") ||
    trimmed.includes("TOOLS - USE THEM!")
  );
}

function chatAgentToolNames(
  agent: Pick<Agent, "id" | "tools" | "config">,
  _messages: ChatAgentPromptMessage[] = [],
  options: ChatAgentPromptOptions = {}
): string[] {
  if (options.useTools === false) return [];
  return resolveAgentToolPolicy(agent).offeredTools.map((tool) => tool.name);
}

export function promptMatchesActiveAgent(prompt: string, agentId: string): boolean {
  const runtimeLine = prompt.split("\n").find((line) => line.startsWith("Runtime: ")) || "";
  const promptAgentId = runtimeLine.match(/(?:^Runtime: | \| )agent=([^|]+)/)?.[1]?.trim();
  return !promptAgentId || promptAgentId === agentId;
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
  const tools = chatAgentToolNames(agent, messages, options);
  const sandboxInfo = getSandboxPromptInfo(homeDir);
  return (
    AGENT_TRANSITION_AUTHORITY +
    "\n\n" +
    buildSystemPrompt({
      workspaceDir: homeDir,
      agentData: {
        name: agent.name,
        config: agent.config as string | undefined,
      },
      config: {},
      modelDisplay: agent.model || "MiniMax-M2.5",
      tools,
      executionMode: agent.type === "planner" ? "plan" : "execute",
      skills,
      contextFiles: getBootstrapContextFiles(homeDir),
      sandboxInfo,
      runtimeInfo: {
        agentId: agent.id,
        model: agent.model,
        channel: options.runtimeChannel,
        python: sandboxInfo.enabled || !tools.includes("exec") ? undefined : hostPythonTooling(),
      },
      extraSystemPrompt:
        storedPrompt && !isGeneratedAgentPrompt(storedPrompt) ? storedPrompt : undefined,
    })
  );
}

const INSTRUCTION_UPDATE = "## Active agent instruction update";

export async function applyActiveAgentToSession(
  session: ChatAgentPromptSession,
  agent: AgentPromptData,
  messages?: ChatAgentPromptMessage[],
  options: ChatAgentPromptOptions = {}
): Promise<void> {
  if (session.id && session.agentId !== agent.id) clearActiveContextUsage(session.id);
  const prompt = await activeAgentSystemPrompt(
    agent,
    session.workspaceDir,
    messages || session.messages,
    options
  );
  const latest = session.messages.filter((message) => message.role === "system").at(-1);
  const transition = `${INSTRUCTION_UPDATE}
This trusted update supersedes earlier agent-specific identity, instructions, and tool availability. Preserve all platform safety instructions. Follow the latest update when agent-specific instructions conflict.

${prompt}`;
  const content = session.messages[0]?.role === "system" ? transition : prompt;
  const unchanged = latest?.content === prompt || latest?.content === transition;
  const historyOffset = session.messages.filter((message) => message.role !== "system").length;
  const retainedMessages = collapseInstructionLedger(session.messages).filter(
    (message, index) =>
      index === 0 ||
      message.role !== "system" ||
      message.instructionUpdate?.pending !== true ||
      message.instructionUpdate.historyOffset !== historyOffset
  );
  const nextMessages = collapseInstructionLedger(
    unchanged
      ? session.messages.map((message) =>
          !options.pendingTransition && message.instructionUpdate?.pending
            ? {
                ...message,
                instructionUpdate: {
                  ...message.instructionUpdate,
                  pending: false,
                },
              }
            : message
        )
      : session.messages[0]?.role === "system"
        ? [
            ...retainedMessages,
            {
              role: "system" as const,
              content,
              instructionUpdate: {
                kind: "agent-transition" as const,
                agentId: agent.id,
                historyOffset,
                ...(options.pendingTransition ? { pending: true } : {}),
              },
              timestamp: new Date().toISOString(),
            },
          ]
        : [
            {
              role: "system" as const,
              content,
              timestamp: new Date().toISOString(),
            },
            ...session.messages,
          ]
  );

  if (session.id) {
    db.prepare(
      `UPDATE chat_sessions SET agent_id = ?,
      context_state = json_set(COALESCE(context_state, '{}'), '$.instructions', json(?)),
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(
      agent.id,
      JSON.stringify(nextMessages.filter((message) => message.role === "system")),
      session.id
    );
  }
  session.messages = nextMessages;
  session.agentId = agent.id;
  if (!unchanged) session.updatedAt = new Date().toISOString();
}

export async function refreshSessionAgentSystemPromptIfNeeded(
  session: ChatAgentPromptSession,
  agent: AgentPromptData,
  messages?: ChatAgentPromptMessage[],
  options: ChatAgentPromptOptions = {}
): Promise<void> {
  await applyActiveAgentToSession(session, agent, messages, options);
}
