export interface ChannelRuntimeSessionSummary {
  id: string;
  messageCount: number;
  createdAt: string;
}

export interface ChannelRuntimeMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface ChannelRuntimeMemorySearchResult {
  file: string;
  content: string;
  score: number;
  method: string;
}

export interface ChannelRuntimeMemoryFile {
  name: string;
  date: string;
  size: number;
}

export interface ChannelRuntimePendingMessage {
  id: string;
  content: string;
  mode: string;
  sequence: number;
}

type ChannelListSessionsHandler = () => Promise<ChannelRuntimeSessionSummary[]>;
type ChannelSendToSessionHandler = (sessionId: string, message: ChannelRuntimeMessage) => boolean;
type ChannelMemorySearchHandler = (args: Record<string, unknown>) => Promise<{
  results: ChannelRuntimeMemorySearchResult[];
  query: string;
  searchMethod: string;
}>;
type ChannelMemoryContextHandler = (args: Record<string, unknown>) => Promise<{
  context: string;
  lines: number;
}>;
type ChannelMemoryListHandler = () => Promise<{
  files: ChannelRuntimeMemoryFile[];
}>;
type ChannelToolListHandler = () => string[];
type ChannelPendingListHandler = (sessionId: string) => ChannelRuntimePendingMessage[];
type ChannelQueueHandler = (
  sessionId: string,
  message: string
) => Promise<{
  queued: boolean;
  pendingMessages: ChannelRuntimePendingMessage[];
}>;
type ChannelSteerHandler = (
  sessionId: string,
  pendingMessageId: string
) => Promise<{
  success: boolean;
  error?: string;
  pendingMessages: ChannelRuntimePendingMessage[];
}>;
type ChannelStopHandler = (sessionId: string) => {
  stopped: boolean;
  error?: string;
};

interface ChannelChatRuntimeHandlers {
  listSessions?: ChannelListSessionsHandler;
  sendToSession?: ChannelSendToSessionHandler;
  memorySearch?: ChannelMemorySearchHandler;
  memoryContext?: ChannelMemoryContextHandler;
  memoryList?: ChannelMemoryListHandler;
  listTools?: ChannelToolListHandler;
  listPending?: ChannelPendingListHandler;
  queue?: ChannelQueueHandler;
  steer?: ChannelSteerHandler;
  stop?: ChannelStopHandler;
}

const channelChatRuntime: {
  listSessions: ChannelListSessionsHandler | null;
  sendToSession: ChannelSendToSessionHandler | null;
  memorySearch: ChannelMemorySearchHandler | null;
  memoryContext: ChannelMemoryContextHandler | null;
  memoryList: ChannelMemoryListHandler | null;
  listTools: ChannelToolListHandler | null;
  listPending: ChannelPendingListHandler | null;
  queue: ChannelQueueHandler | null;
  steer: ChannelSteerHandler | null;
  stop: ChannelStopHandler | null;
} = {
  listSessions: null,
  sendToSession: null,
  memorySearch: null,
  memoryContext: null,
  memoryList: null,
  listTools: null,
  listPending: null,
  queue: null,
  steer: null,
  stop: null,
};

export function configureChannelChatRuntime(handlers: ChannelChatRuntimeHandlers): void {
  if (handlers.listSessions) {
    channelChatRuntime.listSessions = handlers.listSessions;
  }
  if (handlers.sendToSession) {
    channelChatRuntime.sendToSession = handlers.sendToSession;
  }
  if (handlers.memorySearch) {
    channelChatRuntime.memorySearch = handlers.memorySearch;
  }
  if (handlers.memoryContext) {
    channelChatRuntime.memoryContext = handlers.memoryContext;
  }
  if (handlers.memoryList) {
    channelChatRuntime.memoryList = handlers.memoryList;
  }
  if (handlers.listTools) {
    channelChatRuntime.listTools = handlers.listTools;
  }
  if (handlers.listPending) channelChatRuntime.listPending = handlers.listPending;
  if (handlers.queue) channelChatRuntime.queue = handlers.queue;
  if (handlers.steer) channelChatRuntime.steer = handlers.steer;
  if (handlers.stop) channelChatRuntime.stop = handlers.stop;
}

export function resetChannelChatRuntime(): void {
  channelChatRuntime.listSessions = null;
  channelChatRuntime.sendToSession = null;
  channelChatRuntime.memorySearch = null;
  channelChatRuntime.memoryContext = null;
  channelChatRuntime.memoryList = null;
  channelChatRuntime.listTools = null;
  channelChatRuntime.listPending = null;
  channelChatRuntime.queue = null;
  channelChatRuntime.steer = null;
  channelChatRuntime.stop = null;
}

export async function listChannelRuntimeSessions(): Promise<ChannelRuntimeSessionSummary[]> {
  if (!channelChatRuntime.listSessions) {
    return [];
  }

  try {
    return await channelChatRuntime.listSessions();
  } catch (error) {
    console.error("[Channels] Failed to list runtime sessions:", error);
    return [];
  }
}

export function sendChannelRuntimeMessage(
  sessionId: string,
  message: ChannelRuntimeMessage
): boolean {
  if (!channelChatRuntime.sendToSession) {
    return false;
  }

  try {
    return channelChatRuntime.sendToSession(sessionId, message);
  } catch (error) {
    console.error("[Channels] Failed to send runtime message to session:", error);
    return false;
  }
}

export async function searchChannelRuntimeMemory(args: Record<string, unknown>): Promise<{
  results: ChannelRuntimeMemorySearchResult[];
  query: string;
  searchMethod: string;
}> {
  if (!channelChatRuntime.memorySearch) {
    return {
      results: [],
      query: String(args.query || ""),
      searchMethod: "unavailable",
    };
  }

  try {
    return await channelChatRuntime.memorySearch(args);
  } catch (error) {
    console.error("[Channels] Failed to search runtime memory:", error);
    return {
      results: [],
      query: String(args.query || ""),
      searchMethod: "error",
    };
  }
}

export async function getChannelRuntimeMemoryContext(
  args: Record<string, unknown>
): Promise<{ context: string; lines: number }> {
  if (!channelChatRuntime.memoryContext) {
    return { context: "", lines: 0 };
  }

  try {
    return await channelChatRuntime.memoryContext(args);
  } catch (error) {
    console.error("[Channels] Failed to get runtime memory context:", error);
    return { context: "", lines: 0 };
  }
}

export async function listChannelRuntimeMemoryFiles(): Promise<{
  files: ChannelRuntimeMemoryFile[];
}> {
  if (!channelChatRuntime.memoryList) {
    return { files: [] };
  }

  try {
    return await channelChatRuntime.memoryList();
  } catch (error) {
    console.error("[Channels] Failed to list runtime memory files:", error);
    return { files: [] };
  }
}

export function listChannelRuntimeTools(): string[] {
  if (!channelChatRuntime.listTools) {
    return [];
  }

  try {
    return channelChatRuntime.listTools();
  } catch (error) {
    console.error("[Channels] Failed to list runtime tools:", error);
    return [];
  }
}

export function listChannelRuntimePending(sessionId: string): ChannelRuntimePendingMessage[] {
  return channelChatRuntime.listPending?.(sessionId) || [];
}

export async function queueChannelRuntimeMessage(
  sessionId: string,
  message: string
): Promise<{
  queued: boolean;
  pendingMessages: ChannelRuntimePendingMessage[];
} | null> {
  return channelChatRuntime.queue?.(sessionId, message) || null;
}

export async function steerChannelRuntimeMessage(
  sessionId: string,
  pendingMessageId: string
): Promise<{
  success: boolean;
  error?: string;
  pendingMessages: ChannelRuntimePendingMessage[];
} | null> {
  return channelChatRuntime.steer?.(sessionId, pendingMessageId) || null;
}

export function stopChannelRuntimeMessage(
  sessionId: string
): { stopped: boolean; error?: string } | null {
  return channelChatRuntime.stop?.(sessionId) || null;
}
