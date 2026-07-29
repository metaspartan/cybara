import { createInterface } from "readline";
import { limitTUIActivityDetails, presentTUIActivities } from "../tui/activity";
import {
  environmentSnapshotFromDetail,
  formatContextUsageLine,
  formatFileChangeLine,
  formatPlanLine,
  formatSubagentLine,
  formatTaskLine,
  formatTokenUsageLine,
  shortPath,
  subagentsFromResponse,
  tasksFromResponse,
} from "../tui/chat-environment";
import { resolveAgentIdentifier } from "./agent-resolution";
import { getFlagValue } from "./args";
import { createChatInputQueue } from "./chat-input-queue";
import { waitForQueuedAssistantMessage } from "./chat-queued-response";
import { recoverRawAgentResult } from "./raw-agent-recovery";

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;
type WithAuthHeaders = (
  headers?: RequestInit["headers"],
  ensureJsonContentType?: boolean
) => Headers;

interface ChatCliContext {
  apiBase: string;
  fetchAPI: FetchAPI;
  requestAPI?: FetchAPI;
  withAuthHeaders: WithAuthHeaders;
}

interface CliChatOptions {
  agentId?: string;
  modelOverride?: string;
  sessionId?: string;
  showThinking: boolean;
  useModelRouter: boolean;
  workspaceDir?: string;
}

interface CliAgentSummary {
  id: string;
  name?: string;
  model?: string;
  provider_id?: string;
  providerId?: string;
  status?: string;
}

interface CliGatewayConfig {
  default_agent_id?: string;
  defaultAgentId?: string;
  default_workspace_dir?: string;
  defaultWorkspaceDir?: string;
  tool_approval_mode?: string;
  toolApprovalMode?: string;
  follow_up_behavior_enabled?: boolean;
}

interface CliChatSessionSummary {
  id: string;
  title?: string;
  agentId?: string;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  workspaceDir?: string;
  model?: string;
  provider?: string;
  modelMetadata?: {
    provider?: string;
    model?: string;
  };
}

interface CliHistoryMessage {
  role?: string;
  content?: unknown;
  thinking?: string;
  pending_chat_id?: string;
  process_activities?: CliProcessActivity[];
  tool_calls?: CliToolCall[];
  agent_transfers?: CliAgentTransfer[];
}

interface CliAgentTransfer {
  fromAgentName?: string;
  toAgentName?: string;
  reason?: string;
}

interface CliToolCall {
  id?: string;
  name?: string;
  status?: string;
  result?: unknown;
  timeline_index?: number;
}

interface CliProcessActivity {
  id?: string;
  phase?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  timestamp?: number;
  status?: string;
}

interface CliChatResponse {
  sessionId?: string;
  queued?: boolean;
  agent?: { id?: string };
  message?: {
    content?: unknown;
    thinking?: string;
    tool_calls?: CliToolCall[];
    process_activities?: CliProcessActivity[];
  };
  thinking?: string;
  tool_calls?: CliToolCall[];
  processActivities?: CliProcessActivity[];
  pendingMessage?: CliPendingMessage;
  pendingMessages?: CliPendingMessage[];
}

interface CliPendingMessage {
  id: string;
  sessionId?: string;
  content: string;
  mode?: string;
  sequence?: number;
  createdAt?: number;
}

interface CliPendingResponse {
  success?: boolean;
  sessionId?: string;
  queued?: boolean;
  error?: string;
  pendingMessage?: CliPendingMessage;
  pendingMessages?: CliPendingMessage[];
  interruptedMessage?: { role?: string; content?: string; process_activities?: unknown[] };
}

interface CliTurnContext {
  agentId?: string;
  modelOverride?: string;
  workspaceDir?: string;
  useModelRouter?: boolean;
}

let context: ChatCliContext | null = null;

export function configureChatCli(nextContext: ChatCliContext): void {
  context = nextContext;
}

function chatContext(): ChatCliContext {
  if (!context) {
    throw new Error("Chat CLI is not configured");
  }
  return context;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function supportsAnsi(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function ansi(value: string, code: string): string {
  return supportsAnsi() ? `\x1b[${code}m${value}\x1b[0m` : value;
}

function dim(value: string): string {
  return ansi(value, "2");
}

function bold(value: string): string {
  return ansi(value, "1");
}

function formatMarkdownForTerminal(value: string): string {
  const withoutThinkTags = value.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!supportsAnsi()) return withoutThinkTags;
  return withoutThinkTags.replace(/\*\*([^*\n][\s\S]*?)\*\*/g, (_match, text: string) =>
    bold(text)
  );
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("\n").trim();
}

function extractThinkingContent(value: unknown): string {
  if (typeof value === "string") {
    const match = value.match(/<think>([\s\S]*?)<\/think>/);
    return match?.[1]?.trim() || "";
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of value) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "thinking" && typeof record.thinking === "string") {
      parts.push(record.thinking);
    }
  }
  return parts.join("\n").trim();
}

function formatSessionLabel(session: CliChatSessionSummary): string {
  const title = session.title?.trim() || session.id;
  const model =
    session.modelMetadata?.model ||
    session.model ||
    [session.modelMetadata?.provider || session.provider, session.agentId]
      .filter(Boolean)
      .join("/");
  const count = typeof session.messageCount === "number" ? `${session.messageCount} msgs` : "";
  return [title, model, count].filter(Boolean).join(" - ");
}

function formatAgentLine(agent: CliAgentSummary): string {
  const status = agent.status ? ` ${agent.status}` : "";
  const model = agent.model ? ` ${agent.model}` : "";
  const name = agent.name || agent.id;
  return `${agent.id}  ${name}${model}${status}`;
}

async function fetchChatAgents(): Promise<CliAgentSummary[]> {
  const agents = await chatContext().fetchAPI<CliAgentSummary[]>("/api/agents/summary");
  return Array.isArray(agents) ? agents : [];
}

async function resolveAgentId(query: string): Promise<string | undefined> {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const agents = await fetchChatAgents();
  return resolveAgentIdentifier(trimmed, agents) ?? trimmed;
}

function formatPendingLabel(message: CliPendingMessage): string {
  const sequence = message.sequence ? `#${message.sequence}` : "#?";
  const mode = message.mode || "queued";
  return `${sequence} ${mode} ${message.id}: ${message.content}`;
}

function printPendingMessages(messages: CliPendingMessage[] = []): void {
  if (messages.length === 0) {
    console.log("  No pending messages");
    return;
  }
  for (const message of messages) {
    console.log(`  ${formatPendingLabel(message)}`);
  }
}

function collectToolCalls(response: CliChatResponse): CliToolCall[] {
  return [...(response.tool_calls || []), ...(response.message?.tool_calls || [])];
}

function collectActivities(response: CliChatResponse): CliProcessActivity[] {
  return [...(response.processActivities || []), ...(response.message?.process_activities || [])];
}

function printAssistantResponse(response: CliChatResponse, showThinking: boolean): void {
  const activities = collectActivities(response);
  const toolCalls = collectToolCalls(response);
  const activityRows = presentTUIActivities(activities, toolCalls).filter(
    (row) => showThinking || !row.thought
  );
  for (const row of activityRows) {
    console.log(`  ${dim(`${row.icon ? `${row.icon} ` : ""}${row.label}`)}`);
    for (const detail of limitTUIActivityDetails(row.details, 4)) {
      console.log(`    ${dim(detail)}`);
    }
  }

  const thinking =
    response.thinking ||
    response.message?.thinking ||
    extractThinkingContent(response.message?.content || "");
  if (showThinking && thinking && !activityRows.some((row) => row.thought)) {
    console.log(`\n  ${dim("[thinking]")}`);
    console.log(`  ${dim(thinking)}`);
  }

  const content = extractTextContent(response.message?.content || "");
  if (content) {
    console.log(`\n  AI:  ${formatMarkdownForTerminal(content)}\n`);
  } else if (!response.queued) {
    console.log(`\n  ${dim("AI:  (no output)")}\n`);
  }
}

function printChatHelp(): void {
  console.log("  Chat commands");
  console.log("    /help                      Show this help");
  console.log(
    "    /status                    Show active session, agent, model, workspace, permissions"
  );
  console.log("    /sessions                  List sessions");
  console.log("    /new                       Start a new session");
  console.log("    /agents                    List agents");
  console.log("    /agent <id|name|default>   Use another agent for future turns");
  console.log("    /transfer <id|name>        Transfer the active session to another agent");
  console.log("    /model <id|router|default> Use a model override or the model router");
  console.log("    /router on|off             Toggle model-router sends");
  console.log("    /workspace <path>          Use a workspace for future turns");
  console.log("    /permissions ask|always_allow|show");
  console.log("    /followups on|off|show     Toggle queue and steer follow-ups");
  console.log("    /environment               Show workspace, branch, context, plan, diffs, tasks");
  console.log("    /context                   Show context and compaction state");
  console.log("    /usage                     Show token usage for this session");
  console.log("    /plan                      Show latest plan progress");
  console.log("    /diffs                     Show detected file changes");
  console.log("    /tasks                     Show current tasks");
  console.log("    /subagents                 Show current subagents");
  console.log("    /compact                   Show compaction state");
  console.log("    /pending                   Show queued follow-ups");
  console.log("    /queue <message>           Queue a follow-up while a run is active");
  console.log("    /steer <id|#n>             Inject a queued follow-up now");
  console.log("    /edit <id|#n> <message>    Edit a queued follow-up");
  console.log("    /delete <id|#n>            Delete a queued follow-up");
  console.log("    /reorder <id|#n>...        Reorder queued follow-ups");
  console.log("    /stop                      Stop the active run for this session");
  console.log("    /subagent spawn <task>     Delegate a task to an isolated subagent");
  console.log("    /quit                      Exit chat");
}

function chatPendingUsage(): void {
  console.log("Chat Pending Commands:");
  console.log('  cybara chat queue <session> "<message>"');
  console.log("  cybara chat pending <session>");
  console.log("  cybara chat steer <session> <pending-id> [--activity-json JSON]");
  console.log('  cybara chat edit <session> <pending-id> "<message>"');
  console.log("  cybara chat delete <session> <pending-id>");
  console.log("  cybara chat reorder <session> <pending-id>...");
  console.log("  cybara chat stop <session>");
}

function parseActivityJson(rawArgs: string[]): unknown[] | undefined {
  const raw = getFlagValue(rawArgs, "--activity-json");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    console.error("ERROR: --activity-json must be a JSON array");
    process.exit(1);
  }
  console.error("ERROR: --activity-json must be a JSON array");
  process.exit(1);
}

function parseChatOptions(rawArgs: string[]): CliChatOptions {
  const options: CliChatOptions = {
    showThinking: !rawArgs.includes("--no-thinking"),
    useModelRouter: rawArgs.includes("--router"),
  };
  const positional: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--no-thinking") continue;
    if (arg === "--router") continue;
    if (arg === "--session" || arg === "-s") {
      options.sessionId = rawArgs[++i];
      continue;
    }
    if (arg === "--agent" || arg === "-a") {
      options.agentId = rawArgs[++i];
      continue;
    }
    if (arg === "--model" || arg === "-m") {
      options.modelOverride = rawArgs[++i];
      continue;
    }
    if (arg === "--workspace" || arg === "-w") {
      options.workspaceDir = rawArgs[++i];
      continue;
    }
    positional.push(arg);
  }
  if (!options.sessionId && positional[0]) {
    options.sessionId = positional[0];
  }
  return options;
}

function resolvePendingId(
  raw: string | undefined,
  pendingMessages: CliPendingMessage[]
): string | null {
  if (!raw) return null;
  if (raw.startsWith("#")) {
    const sequence = Number(raw.slice(1));
    return pendingMessages.find((message) => message.sequence === sequence)?.id || null;
  }
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) {
    return pendingMessages.find((message) => message.sequence === numeric)?.id || null;
  }
  return raw;
}

async function fetchPendingMessages(sessionId: string): Promise<CliPendingMessage[]> {
  const data = await chatContext().fetchAPI<CliPendingResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending`
  );
  return data?.pendingMessages || [];
}

async function queueMessage(
  sessionId: string,
  message: string,
  turnContext?: CliTurnContext
): Promise<CliChatResponse | null> {
  return await chatContext().fetchAPI<CliChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      message,
      queueMode: "queue",
      agentId: turnContext?.agentId,
      modelOverride: turnContext?.modelOverride,
      workspaceDir: turnContext?.workspaceDir,
      useModelRouter: turnContext?.useModelRouter === true,
    }),
  });
}

async function steerPending(
  sessionId: string,
  pendingId: string
): Promise<CliPendingResponse | null> {
  return await chatContext().fetchAPI<CliPendingResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(
      pendingId
    )}/steer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
}

async function editPending(
  sessionId: string,
  pendingId: string,
  content: string
): Promise<CliPendingResponse | null> {
  return await chatContext().fetchAPI<CliPendingResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(pendingId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
}

async function deletePending(
  sessionId: string,
  pendingId: string
): Promise<CliPendingResponse | null> {
  return await chatContext().fetchAPI<CliPendingResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(pendingId)}`,
    { method: "DELETE" }
  );
}

async function reorderPending(
  sessionId: string,
  pendingMessageIds: string[]
): Promise<CliPendingResponse | null> {
  return await chatContext().fetchAPI<CliPendingResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingMessageIds }),
    }
  );
}

async function stopSession(
  sessionId: string
): Promise<{ success?: boolean; error?: string } | null> {
  return await chatContext().fetchAPI<{ success?: boolean; error?: string }>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/stop`,
    { method: "POST" }
  );
}

export async function rawAgent(rawArgs: string[]): Promise<void> {
  const json = rawArgs.includes("--json");
  let sessionId: string | undefined;
  let agentId: string | undefined;
  let modelOverride: string | undefined;
  let useModelRouter = false;
  let workspaceDir: string | undefined;
  const words: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--json") continue;
    if (arg === "--session" || arg === "-s") {
      sessionId = rawArgs[++i];
      continue;
    }
    if (arg === "--agent" || arg === "-a") {
      agentId = rawArgs[++i];
      continue;
    }
    if (arg === "--model" || arg === "-m") {
      modelOverride = rawArgs[++i];
      continue;
    }
    if (arg === "--router") {
      useModelRouter = true;
      continue;
    }
    if (arg === "--workspace" || arg === "-w") {
      workspaceDir = rawArgs[++i];
      continue;
    }
    words.push(arg);
  }
  let prompt = words.join(" ").trim();
  if (!prompt && !process.stdin.isTTY) {
    prompt = await readStdin();
  }
  if (!prompt) {
    console.error(
      'Usage: cybara agent "<prompt>" [--json] [--session <id>] [--agent <id>] [--model <id>|--router] [--workspace <path>]'
    );
    console.error("       echo '<prompt>' | cybara agent --json");
    process.exit(1);
  }

  if (agentId) {
    agentId = await resolveAgentId(agentId);
  }

  const baselineMessages = sessionId
    ? await chatContext().fetchAPI<CliHistoryMessage[]>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`
      )
    : [];
  const baselineMessageCount = Array.isArray(baselineMessages) ? baselineMessages.length : null;
  sessionId ||= crypto.randomUUID();

  const body: Record<string, unknown> = {
    message: prompt,
    sessionId,
    agentId,
    modelOverride: useModelRouter ? undefined : modelOverride,
    workspaceDir,
    tools: true,
  };
  if (useModelRouter) body.useModelRouter = true;
  const current = chatContext();
  let requestError: unknown;
  let res: CliChatResponse | null = null;
  try {
    res = await (current.requestAPI || current.fetchAPI)<CliChatResponse>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    requestError = error;
  }

  if (!res) {
    const recovered = await recoverRawAgentResult({
      baselineMessageCount,
      fetchAPI: chatContext().fetchAPI,
      sessionId,
    });
    if (recovered) {
      if (json) console.log(JSON.stringify({ sessionId, content: recovered }));
      else console.log(formatMarkdownForTerminal(recovered));
      return;
    }
    if (requestError) {
      console.error(
        `ERROR: ${requestError instanceof Error ? requestError.message : requestError}`
      );
    }
    process.exit(1);
  }

  const content = extractTextContent(res.message?.content || "");
  if (json) {
    console.log(JSON.stringify({ sessionId: res.sessionId, content }));
  } else {
    console.log(formatMarkdownForTerminal(content));
  }
}

async function rawChatPendingCommand(rawArgs: string[]): Promise<boolean> {
  const subcommand = rawArgs[0];
  if (
    !["queue", "pending", "steer", "edit", "delete", "reorder", "stop"].includes(subcommand || "")
  ) {
    return false;
  }

  const sessionId = rawArgs[1];
  if (!sessionId) {
    chatPendingUsage();
    process.exit(1);
  }

  if (subcommand === "queue") {
    const message = rawArgs.slice(2).join(" ").trim();
    if (!message) {
      chatPendingUsage();
      process.exit(1);
    }
    const data = await queueMessage(sessionId, message);
    if (!data) process.exit(1);
    console.log(data.queued ? "Queued pending message" : "Sent message");
    printPendingMessages(
      data.pendingMessages || (data.pendingMessage ? [data.pendingMessage] : [])
    );
    return true;
  }

  if (subcommand === "pending") {
    const messages = await fetchPendingMessages(sessionId);
    printPendingMessages(messages);
    return true;
  }

  if (subcommand === "stop") {
    const data = await stopSession(sessionId);
    if (!data) process.exit(1);
    if (data.success === false) {
      console.error(`ERROR: ${data.error || "Failed to stop session"}`);
      process.exit(1);
    }
    console.log("Stopped active run");
    return true;
  }

  const pendingId = rawArgs[2];
  if (!pendingId) {
    chatPendingUsage();
    process.exit(1);
  }

  if (subcommand === "steer") {
    const processActivities = parseActivityJson(rawArgs);
    const data = await chatContext().fetchAPI<CliPendingResponse>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(
        pendingId
      )}/steer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: processActivities ? JSON.stringify({ processActivities }) : undefined,
      }
    );
    if (!data) process.exit(1);
    if (data.success === false) {
      console.error(`ERROR: ${data.error || "Failed to steer pending message"}`);
      process.exit(1);
    }
    console.log("Steered pending message");
    if (data.interruptedMessage?.process_activities?.length) {
      console.log(
        `Persisted ${data.interruptedMessage.process_activities.length} pre-steer activities`
      );
    }
    printPendingMessages(data.pendingMessages || []);
    return true;
  }

  if (subcommand === "edit") {
    const content = rawArgs.slice(3).join(" ").trim();
    if (!content) {
      chatPendingUsage();
      process.exit(1);
    }
    const data = await editPending(sessionId, pendingId, content);
    if (!data) process.exit(1);
    console.log("Updated pending message");
    printPendingMessages(
      data.pendingMessages || (data.pendingMessage ? [data.pendingMessage] : [])
    );
    return true;
  }

  if (subcommand === "delete") {
    const data = await deletePending(sessionId, pendingId);
    if (!data) process.exit(1);
    console.log("Deleted pending message");
    printPendingMessages(data.pendingMessages || []);
    return true;
  }

  const pendingMessageIds = rawArgs.slice(2);
  if (pendingMessageIds.length === 0) {
    chatPendingUsage();
    process.exit(1);
  }
  const data = await reorderPending(sessionId, pendingMessageIds);
  if (!data) process.exit(1);
  console.log("Reordered pending messages");
  printPendingMessages(data.pendingMessages || []);
  return true;
}

async function pickInitialSession(
  rl: ReturnType<typeof createInterface>
): Promise<string | undefined> {
  const sessions = await chatContext().fetchAPI<CliChatSessionSummary[]>("/api/sessions?limit=10");
  if (!sessions?.length) {
    return undefined;
  }

  console.log("\n  SESSIONS");
  console.log("  ========");
  sessions.slice(0, 10).forEach((session, index) => {
    console.log(`  [${index + 1}] ${formatSessionLabel(session)}`);
  });
  console.log("  [n] New session\n");

  const answer = await new Promise<string>((resolve) => rl.question("  Select session: ", resolve));
  const index = Number.parseInt(answer, 10) - 1;
  if (index >= 0 && index < sessions.length) {
    return sessions[index]?.id;
  }
  return undefined;
}

async function printSessionHistory(sessionId: string): Promise<void> {
  const messages = await chatContext().fetchAPI<CliHistoryMessage[]>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`
  );
  if (!messages?.length) {
    return;
  }
  console.log("\n  --- Session History ---");
  for (const message of messages.slice(-8)) {
    if (message.role === "system") continue;
    for (const transfer of message.agent_transfers || []) {
      if (!transfer.fromAgentName || !transfer.toAgentName) continue;
      console.log(`  ⇄ Transferred from ${transfer.fromAgentName} to ${transfer.toAgentName}`);
    }
    const content = extractTextContent(message.content || "");
    if (!content) continue;
    const prefix = message.role === "user" ? "  You: " : "  AI:  ";
    const preview = content.length > 220 ? `${content.slice(0, 220)}...` : content;
    console.log(`${prefix}${formatMarkdownForTerminal(preview)}`);
  }
  console.log("  ----------------------\n");
}

async function fetchSessionEnvironment(sessionId: string) {
  const detail = await chatContext().fetchAPI<unknown>(
    `/api/sessions/${encodeURIComponent(sessionId)}`
  );
  return environmentSnapshotFromDetail(detail);
}

async function printEnvironment(sessionId: string): Promise<void> {
  const [snapshot, taskResponse, subagentResponse] = await Promise.all([
    fetchSessionEnvironment(sessionId),
    chatContext().fetchAPI<unknown>("/api/tasks"),
    chatContext().fetchAPI<unknown>("/api/subagents"),
  ]);
  const tasks = tasksFromResponse(taskResponse);
  const subagents = subagentsFromResponse(subagentResponse);
  console.log("  Environment");
  console.log(
    `    Workspace: ${snapshot.workspaceDir ? shortPath(snapshot.workspaceDir, 64) : "none"}`
  );
  console.log(`    Branch: ${snapshot.gitBranch || "not loaded"}`);
  console.log(`    ${formatContextUsageLine(snapshot.contextUsage)}`);
  console.log(`    ${formatTokenUsageLine(snapshot.tokenUsage)}`);
  console.log(`    ${formatFileChangeLine(snapshot.fileChanges)}`);
  console.log(`    ${formatPlanLine(snapshot.plan)}`);
  if (tasks.length > 0) {
    console.log("    Tasks:");
    for (const task of tasks.slice(0, 6)) console.log(`      ${formatTaskLine(task)}`);
  }
  if (subagents.length > 0) {
    console.log("    Subagents:");
    for (const subagent of subagents.slice(0, 6)) {
      console.log(`      ${formatSubagentLine(subagent)}`);
    }
  }
}

export async function rawChatCommand(rawArgs: string[]): Promise<void> {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printChatHelp();
    return;
  }
  if (await rawChatPendingCommand(rawArgs)) return;
  await rawChat(parseChatOptions(rawArgs));
}

async function rawChat(options: CliChatOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let sessionId = options.sessionId;
  let agentId = options.agentId;
  let modelOverride = options.modelOverride;
  let useModelRouter = options.useModelRouter;
  let workspaceDir = options.workspaceDir;
  let running = false;
  let followUpBehaviorEnabled = true;
  let pendingMessages: CliPendingMessage[] = [];

  if (agentId) {
    agentId = await resolveAgentId(agentId);
  }

  try {
    const config = await chatContext().fetchAPI<CliGatewayConfig>("/api/config");
    followUpBehaviorEnabled = config?.follow_up_behavior_enabled !== false;
  } catch {
    followUpBehaviorEnabled = true;
  }

  if (!sessionId) {
    sessionId = await pickInitialSession(rl);
  }
  if (sessionId) {
    await printSessionHistory(sessionId);
    pendingMessages = await fetchPendingMessages(sessionId);
    if (pendingMessages.length > 0) {
      console.log("  Pending follow-ups");
      printPendingMessages(pendingMessages);
      console.log("");
    }
  }

  const printStatus = async () => {
    const [agents, config] = await Promise.all([
      fetchChatAgents(),
      chatContext().fetchAPI<CliGatewayConfig>("/api/config"),
    ]);
    const selectedAgent = agents.find((agent) => agent.id === agentId);
    const defaultAgentId = config?.default_agent_id || config?.defaultAgentId;
    const fallbackAgent = agents.find((agent) => agent.id === defaultAgentId) || agents[0];
    const agent = selectedAgent || fallbackAgent;
    const agentLabel = useModelRouter
      ? `Model Router${agent ? ` via ${agent.name || agent.id}` : ""}`
      : agent
        ? `${agent.name || agent.id}${agent.model ? ` (${agent.model})` : ""}`
        : "Gateway default";
    const modelLabel = useModelRouter ? "router" : modelOverride || agent?.model || "agent default";
    const approvalMode = config?.tool_approval_mode || config?.toolApprovalMode || "unknown";
    const activeWorkspace =
      workspaceDir || config?.default_workspace_dir || config?.defaultWorkspaceDir || "default";
    console.log("  Context");
    console.log(`    Session: ${sessionId || "new"}`);
    console.log(`    Agent: ${agentLabel}`);
    console.log(`    Model: ${modelLabel}`);
    console.log(`    Workspace: ${activeWorkspace}`);
    console.log(`    Permissions: ${approvalMode}`);
    console.log(`    Follow-ups: ${followUpBehaviorEnabled ? "queue / steer" : "disabled"}`);
  };

  await printStatus();
  console.log("  Cybara Chat (type /help for commands, Ctrl+C to exit)\n");
  rl.setPrompt("  You: ");
  rl.prompt();

  const refreshPending = async () => {
    if (!sessionId) return;
    pendingMessages = await fetchPendingMessages(sessionId);
  };

  const requireSession = () => {
    if (sessionId) return true;
    console.log("  No session id yet. Send the first turn, then queue or steer follow-ups.");
    return false;
  };

  const waitForQueuedResponse = async (
    targetSessionId: string,
    pendingId: string
  ): Promise<CliHistoryMessage | null> =>
    await waitForQueuedAssistantMessage({
      pendingId,
      loadSnapshot: async () => {
        const [messages, pending] = await Promise.all([
          chatContext().fetchAPI<CliHistoryMessage[]>(
            `/api/chat/sessions/${encodeURIComponent(targetSessionId)}/messages`
          ),
          chatContext().fetchAPI<CliPendingResponse>(
            `/api/chat/sessions/${encodeURIComponent(targetSessionId)}/pending`
          ),
        ]);
        if (!messages || !pending) return null;
        return {
          messages,
          pendingIds: (pending.pendingMessages || []).map((item) => item.id),
        };
      },
    });

  const runTurn = async (message: string) => {
    running = true;
    sessionId ||= crypto.randomUUID();
    console.log(
      `  ${dim("Working. Type a follow-up to queue it, or use /steer <id|#n> to inject one now.")}`
    );
    try {
      const body: Record<string, unknown> = { message, sessionId, tools: true };
      if (agentId) body.agentId = agentId;
      if (modelOverride && !useModelRouter) body.modelOverride = modelOverride;
      if (useModelRouter) body.useModelRouter = true;
      if (workspaceDir) body.workspaceDir = workspaceDir;

      const current = chatContext();
      const data = await (current.requestAPI || current.fetchAPI)<CliChatResponse>("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!data) return;
      if (data.sessionId) {
        sessionId = data.sessionId;
      }
      if (data.agent?.id) {
        agentId = data.agent.id;
      }
      printAssistantResponse(data, options.showThinking);
      pendingMessages = data.pendingMessages || pendingMessages;
      if (pendingMessages.length > 0) {
        console.log("  Pending follow-ups");
        printPendingMessages(pendingMessages);
        console.log("");
      }
      while (sessionId && pendingMessages.length > 0) {
        const pendingId = pendingMessages[0]?.id;
        if (!pendingId) break;
        const queuedAssistant = await waitForQueuedResponse(sessionId, pendingId);
        if (queuedAssistant) {
          printAssistantResponse({ sessionId, message: queuedAssistant }, options.showThinking);
        }
        pendingMessages = await fetchPendingMessages(sessionId);
        if (pendingMessages.length > 0) {
          console.log("  Pending follow-ups");
          printPendingMessages(pendingMessages);
          console.log("");
        }
      }
    } catch (err) {
      console.error(`  Error: ${(err as Error).message}`);
    } finally {
      running = false;
      rl.prompt();
    }
  };

  const handleQueuedInput = async (message: string) => {
    if (!requireSession()) return;
    if (!followUpBehaviorEnabled) {
      console.log("  Queue / Steer follow-ups are disabled. Use /followups on to enable them.");
      return;
    }
    const data = await queueMessage(sessionId as string, message, {
      agentId,
      modelOverride: useModelRouter ? undefined : modelOverride,
      workspaceDir,
      useModelRouter,
    });
    if (!data) return;
    if (data.queued !== true) {
      printAssistantResponse(data, options.showThinking);
      pendingMessages = data.pendingMessages || [];
      return;
    }
    pendingMessages = data.pendingMessages || (data.pendingMessage ? [data.pendingMessage] : []);
    console.log("  Queued follow-up");
    printPendingMessages(pendingMessages);
  };

  const handleCommand = async (input: string): Promise<boolean> => {
    const [command, ...rest] = input.slice(1).split(/\s+/);
    const argument = rest.join(" ").trim();
    if (command === "quit" || command === "exit") {
      rl.close();
      process.exit(0);
    }
    if (command === "help") {
      printChatHelp();
      return true;
    }
    if (command === "status") {
      await printStatus();
      return true;
    }
    if (command === "sessions") {
      const sessions = await chatContext().fetchAPI<CliChatSessionSummary[]>("/api/sessions");
      for (const session of sessions || []) {
        console.log(`  ${session.id}  ${formatSessionLabel(session)}`);
      }
      return true;
    }
    if (command === "agents") {
      const agents = await fetchChatAgents();
      if (agents.length === 0) {
        console.log("  No agents configured");
      } else {
        for (const agent of agents) console.log(`  ${formatAgentLine(agent)}`);
      }
      return true;
    }
    if (command === "new") {
      sessionId = undefined;
      pendingMessages = [];
      console.log("  New session");
      return true;
    }
    if (command === "agent" || command === "transfer") {
      if (!argument) {
        const agents = await fetchChatAgents();
        for (const agent of agents) console.log(`  ${formatAgentLine(agent)}`);
        return true;
      }
      if (["default", "off", "reset"].includes(argument.toLowerCase())) {
        agentId = undefined;
        console.log("  Agent reset to gateway default");
        return true;
      }
      agentId = await resolveAgentId(argument);
      useModelRouter = false;
      if (sessionId && agentId) {
        await chatContext().fetchAPI(`/api/sessions/${encodeURIComponent(sessionId)}/agent`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });
      }
      console.log(agentId ? `  Agent set to ${agentId}` : "  Agent reset to default");
      return true;
    }
    if (command === "model") {
      if (!argument) {
        console.log(`  Model: ${useModelRouter ? "router" : modelOverride || "agent default"}`);
        return true;
      }
      if (["router", "auto"].includes(argument.toLowerCase())) {
        modelOverride = undefined;
        useModelRouter = true;
        console.log("  Model Router enabled for future turns");
        return true;
      }
      if (["default", "off", "reset"].includes(argument.toLowerCase())) {
        modelOverride = undefined;
        useModelRouter = false;
        console.log("  Model reset to active agent default");
        return true;
      }
      modelOverride = argument;
      useModelRouter = false;
      console.log(`  Model override set to ${modelOverride}`);
      return true;
    }
    if (command === "router") {
      const mode = argument.toLowerCase();
      if (["on", "enable", "enabled"].includes(mode)) {
        modelOverride = undefined;
        useModelRouter = true;
        console.log("  Model Router enabled for future turns");
      } else if (["off", "disable", "disabled"].includes(mode)) {
        useModelRouter = false;
        console.log("  Model Router disabled for future turns");
      } else {
        console.log(`  Model Router: ${useModelRouter ? "enabled" : "disabled"}`);
      }
      return true;
    }
    if (command === "permissions" || command === "approval" || command === "approvals") {
      const mode = argument.toLowerCase();
      if (!mode || mode === "show") {
        const config = await chatContext().fetchAPI<CliGatewayConfig>("/api/config");
        console.log(
          `  Permissions: ${config?.tool_approval_mode || config?.toolApprovalMode || "unknown"}`
        );
        return true;
      }
      const normalized =
        mode === "always" || mode === "always_allow" || mode === "allow" ? "always_allow" : mode;
      if (normalized !== "ask" && normalized !== "always_allow") {
        console.log("  Usage: /permissions ask|always_allow|show");
        return true;
      }
      const result = await chatContext().fetchAPI<{ success?: boolean; error?: string }>(
        "/api/config",
        {
          method: "PUT",
          body: JSON.stringify({ tool_approval_mode: normalized }),
        }
      );
      if (result?.success === false) {
        console.log(`  Error: ${result.error || "Failed to update permissions"}`);
      } else {
        console.log(`  Permissions set to ${normalized}`);
      }
      return true;
    }
    if (command === "followups" || command === "followup") {
      const mode = argument.toLowerCase();
      if (!mode || mode === "show") {
        console.log(`  Queue / Steer follow-ups: ${followUpBehaviorEnabled ? "on" : "off"}`);
        return true;
      }
      const enabled = ["on", "enable", "enabled"].includes(mode)
        ? true
        : ["off", "disable", "disabled"].includes(mode)
          ? false
          : null;
      if (enabled === null) {
        console.log("  Usage: /followups on|off|show");
        return true;
      }
      const result = await chatContext().fetchAPI<{ success?: boolean; error?: string }>(
        "/api/config",
        {
          method: "PUT",
          body: JSON.stringify({ follow_up_behavior_enabled: enabled }),
        }
      );
      if (result?.success === false) {
        console.log(`  Error: ${result.error || "Failed to update follow-up behavior"}`);
      } else {
        followUpBehaviorEnabled = enabled;
        console.log(`  Queue / Steer follow-ups ${enabled ? "enabled" : "disabled"}`);
      }
      return true;
    }
    if (command === "workspace") {
      workspaceDir = argument || undefined;
      console.log(workspaceDir ? `  Workspace set to ${workspaceDir}` : "  Workspace cleared");
      return true;
    }
    if (command === "environment") {
      if (!requireSession()) return true;
      await printEnvironment(sessionId as string);
      return true;
    }
    if (command === "context" || command === "compact") {
      if (!requireSession()) return true;
      const snapshot = await fetchSessionEnvironment(sessionId as string);
      console.log(`  ${formatContextUsageLine(snapshot.contextUsage)}`);
      return true;
    }
    if (command === "usage") {
      if (!requireSession()) return true;
      const snapshot = await fetchSessionEnvironment(sessionId as string);
      console.log(`  ${formatTokenUsageLine(snapshot.tokenUsage)}`);
      return true;
    }
    if (command === "plan") {
      if (!requireSession()) return true;
      const snapshot = await fetchSessionEnvironment(sessionId as string);
      console.log(`  ${formatPlanLine(snapshot.plan)}`);
      return true;
    }
    if (command === "diffs") {
      if (!requireSession()) return true;
      const snapshot = await fetchSessionEnvironment(sessionId as string);
      console.log(`  ${formatFileChangeLine(snapshot.fileChanges)}`);
      for (const file of snapshot.fileChanges?.files.slice(0, 8) || []) {
        console.log(`    ${shortPath(file.path, 72)} +${file.added} -${file.removed}`);
      }
      return true;
    }
    if (command === "tasks") {
      const response = await chatContext().fetchAPI<unknown>("/api/tasks");
      const tasks = tasksFromResponse(response);
      if (tasks.length === 0) {
        console.log("  No tasks");
      } else {
        for (const task of tasks.slice(0, 12)) console.log(`  ${formatTaskLine(task)}`);
      }
      return true;
    }
    if (command === "subagent" || command === "subagents") {
      const [subcommand, ...subRest] = rest;
      if (subcommand !== "spawn") {
        const response = await chatContext().fetchAPI<unknown>("/api/subagents");
        const subagents = subagentsFromResponse(response);
        if (subagents.length === 0) {
          console.log("  No subagents");
        } else {
          for (const subagent of subagents.slice(0, 12)) {
            console.log(`  ${formatSubagentLine(subagent)}`);
          }
        }
        return true;
      }
      const task = subRest.join(" ").trim();
      if (!task) {
        console.log("  Usage: /subagent spawn <task>");
        return true;
      }
      const result = await chatContext().fetchAPI<{
        subagentId?: string;
        error?: string;
        status?: string;
        warning?: string;
      }>("/api/subagents/spawn", {
        method: "POST",
        body: JSON.stringify({
          task,
          agentId,
          model: useModelRouter ? undefined : modelOverride,
          workspaceDir,
          cleanup: "keep",
        }),
      });
      if (result?.subagentId) {
        console.log(`  Spawned subagent ${result.subagentId}`);
      } else {
        console.log(
          `  Error: ${result?.error || result?.warning || result?.status || "spawn failed"}`
        );
      }
      return true;
    }
    if (command === "pending") {
      if (!requireSession()) return true;
      await refreshPending();
      printPendingMessages(pendingMessages);
      return true;
    }
    if (command === "queue") {
      if (!argument) {
        console.log("  Usage: /queue <message>");
        return true;
      }
      await handleQueuedInput(argument);
      return true;
    }
    if (command === "stop") {
      if (!requireSession()) return true;
      const data = await stopSession(sessionId as string);
      if (data?.success === false) {
        console.log(`  Error: ${data.error || "Failed to stop session"}`);
      } else {
        running = false;
        console.log("  Stop requested");
      }
      return true;
    }
    if (command === "steer") {
      if (!requireSession()) return true;
      await refreshPending();
      const pendingId = resolvePendingId(rest[0], pendingMessages);
      if (!pendingId) {
        console.log("  Usage: /steer <id|#n>");
        return true;
      }
      const data = await steerPending(sessionId as string, pendingId);
      if (!data) return true;
      pendingMessages = data.pendingMessages || [];
      console.log("  Steered pending message");
      printPendingMessages(pendingMessages);
      return true;
    }
    if (command === "edit") {
      if (!requireSession()) return true;
      await refreshPending();
      const pendingId = resolvePendingId(rest[0], pendingMessages);
      const content = rest.slice(1).join(" ").trim();
      if (!pendingId || !content) {
        console.log("  Usage: /edit <id|#n> <message>");
        return true;
      }
      const data = await editPending(sessionId as string, pendingId, content);
      if (!data) return true;
      pendingMessages = data.pendingMessages || (data.pendingMessage ? [data.pendingMessage] : []);
      console.log("  Updated pending message");
      printPendingMessages(pendingMessages);
      return true;
    }
    if (command === "delete") {
      if (!requireSession()) return true;
      await refreshPending();
      const pendingId = resolvePendingId(rest[0], pendingMessages);
      if (!pendingId) {
        console.log("  Usage: /delete <id|#n>");
        return true;
      }
      const data = await deletePending(sessionId as string, pendingId);
      if (!data) return true;
      pendingMessages = data.pendingMessages || [];
      console.log("  Deleted pending message");
      printPendingMessages(pendingMessages);
      return true;
    }
    if (command === "reorder") {
      if (!requireSession()) return true;
      await refreshPending();
      const ids = rest.map((value) => resolvePendingId(value, pendingMessages)).filter(Boolean);
      if (ids.length === 0) {
        console.log("  Usage: /reorder <id|#n>...");
        return true;
      }
      const data = await reorderPending(sessionId as string, ids as string[]);
      if (!data) return true;
      pendingMessages = data.pendingMessages || [];
      console.log("  Reordered pending messages");
      printPendingMessages(pendingMessages);
      return true;
    }
    return false;
  };

  const enqueueInput = createChatInputQueue(
    async (input) => {
      if (input.startsWith("/") && (await handleCommand(input))) {
        rl.prompt();
        return;
      }
      if (running) {
        await handleQueuedInput(input);
        rl.prompt();
        return;
      }
      void runTurn(input);
    },
    (error) => {
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      rl.prompt();
    }
  );

  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    enqueueInput(input);
  });
}
