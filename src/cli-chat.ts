import { createInterface } from "readline";
import { getFlagValue } from "./cli-args";

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;
type WithAuthHeaders = (
  headers?: RequestInit["headers"],
  ensureJsonContentType?: boolean
) => Headers;

interface ChatCliContext {
  apiBase: string;
  fetchAPI: FetchAPI;
  withAuthHeaders: WithAuthHeaders;
}

interface CliChatOptions {
  agentId?: string;
  sessionId?: string;
  showThinking: boolean;
  workspaceDir?: string;
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
  process_activities?: CliProcessActivity[];
  tool_calls?: CliToolCall[];
}

interface CliToolCall {
  name?: string;
  status?: string;
  result?: unknown;
}

interface CliProcessActivity {
  phase?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  status?: string;
}

interface CliChatResponse {
  sessionId?: string;
  queued?: boolean;
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
  if (activities.length > 0) {
    console.log(
      `  ${dim(`Ran ${activities.length} activity${activities.length === 1 ? "" : "ies"}`)}`
    );
    for (const activity of activities.slice(-12)) {
      const label =
        activity.text || activity.toolName || activity.phase || activity.status || "activity";
      console.log(`  ${dim(`- ${label}`)}`);
    }
  }

  const toolCalls = collectToolCalls(response);
  if (toolCalls.length > 0) {
    console.log(
      `  ${dim(`Ran ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`)}`
    );
    for (const tool of toolCalls.slice(-12)) {
      const name = tool.name || "tool";
      const status = tool.status ? ` [${tool.status}]` : "";
      console.log(`  ${dim(`- ${name}${status}`)}`);
    }
  }

  const thinking =
    response.thinking ||
    response.message?.thinking ||
    extractThinkingContent(response.message?.content || "");
  if (showThinking && thinking) {
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
  console.log("    /sessions                  List sessions");
  console.log("    /new                       Start a new session");
  console.log("    /agent <id>                Use another agent for future turns");
  console.log("    /workspace <path>          Use a workspace for future turns");
  console.log("    /pending                   Show queued follow-ups");
  console.log("    /queue <message>           Queue a follow-up while a run is active");
  console.log("    /steer <id|#n>             Inject a queued follow-up now");
  console.log("    /edit <id|#n> <message>    Edit a queued follow-up");
  console.log("    /delete <id|#n>            Delete a queued follow-up");
  console.log("    /reorder <id|#n>...        Reorder queued follow-ups");
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
  const options: CliChatOptions = { showThinking: !rawArgs.includes("--no-thinking") };
  const positional: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--no-thinking") continue;
    if (arg === "--session" || arg === "-s") {
      options.sessionId = rawArgs[++i];
      continue;
    }
    if (arg === "--agent" || arg === "-a") {
      options.agentId = rawArgs[++i];
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
  message: string
): Promise<CliPendingResponse | null> {
  return await chatContext().fetchAPI<CliPendingResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message, queueMode: "queue" }),
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

export async function rawAgent(rawArgs: string[]): Promise<void> {
  const json = rawArgs.includes("--json");
  let sessionId: string | undefined;
  let agentId: string | undefined;
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
      'Usage: cybara agent "<prompt>" [--json] [--session <id>] [--agent <id>] [--workspace <path>]'
    );
    console.error("       echo '<prompt>' | cybara agent --json");
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    message: prompt,
    sessionId,
    agentId,
    workspaceDir,
    tools: true,
  };
  const res = await chatContext().fetchAPI<CliChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res) {
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
  if (!["queue", "pending", "steer", "edit", "delete", "reorder"].includes(subcommand || "")) {
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
  const sessions = await chatContext().fetchAPI<CliChatSessionSummary[]>("/api/sessions");
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
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`
  );
  if (!messages?.length) {
    return;
  }
  console.log("\n  --- Session History ---");
  for (const message of messages.slice(-8)) {
    if (message.role === "system") continue;
    const content = extractTextContent(message.content || "");
    if (!content) continue;
    const prefix = message.role === "user" ? "  You: " : "  AI:  ";
    const preview = content.length > 220 ? `${content.slice(0, 220)}...` : content;
    console.log(`${prefix}${formatMarkdownForTerminal(preview)}`);
  }
  console.log("  ----------------------\n");
}

export async function rawChatCommand(rawArgs: string[]): Promise<void> {
  if (await rawChatPendingCommand(rawArgs)) return;
  await rawChat(parseChatOptions(rawArgs));
}

async function rawChat(options: CliChatOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let sessionId = options.sessionId;
  let agentId = options.agentId;
  let workspaceDir = options.workspaceDir;
  let running = false;
  let pendingMessages: CliPendingMessage[] = [];

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

  const runTurn = async (message: string) => {
    running = true;
    console.log(
      `  ${dim("Working. Type a follow-up to queue it, or use /steer <id|#n> to inject one now.")}`
    );
    try {
      const body: Record<string, unknown> = { message, tools: true };
      if (sessionId) body.sessionId = sessionId;
      if (agentId) body.agentId = agentId;
      if (workspaceDir) body.workspaceDir = workspaceDir;

      const current = chatContext();
      const resp = await fetch(`${current.apiBase}/api/chat`, {
        method: "POST",
        headers: current.withAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        console.error(`  Error: ${resp.status} ${resp.statusText}`);
        return;
      }

      const data = (await resp.json()) as CliChatResponse;
      if (data.sessionId) {
        sessionId = data.sessionId;
      }
      printAssistantResponse(data, options.showThinking);
      pendingMessages = data.pendingMessages || pendingMessages;
      if (pendingMessages.length > 0) {
        console.log("  Pending follow-ups");
        printPendingMessages(pendingMessages);
        console.log("");
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
    const data = await queueMessage(sessionId as string, message);
    if (!data) return;
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
    if (command === "sessions") {
      const sessions = await chatContext().fetchAPI<CliChatSessionSummary[]>("/api/sessions");
      for (const session of sessions || []) {
        console.log(`  ${session.id}  ${formatSessionLabel(session)}`);
      }
      return true;
    }
    if (command === "new") {
      sessionId = undefined;
      pendingMessages = [];
      console.log("  New session");
      return true;
    }
    if (command === "agent") {
      agentId = argument || undefined;
      console.log(agentId ? `  Agent set to ${agentId}` : "  Agent reset to default");
      return true;
    }
    if (command === "workspace") {
      workspaceDir = argument || undefined;
      console.log(workspaceDir ? `  Workspace set to ${workspaceDir}` : "  Workspace cleared");
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

  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    void (async () => {
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
    })();
  });
}
