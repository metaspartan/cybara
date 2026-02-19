import { agentManager, type AgentMessage } from "../core/agent";
import { providerManager } from "../core/providers";
import {
  getToolSchemasForLLM,
  checkCircuit,
  recordCircuitSuccess,
  recordCircuitFailure,
  checkRateLimit,
  getRateLimitStatus,
} from "../core/tools/index";
import { getSubagentSession } from "../core/tools/handlers/index";
import { logSessionMessage, logAgentActivity } from "../core/logging";
import {
  listPersistedSessions,
  loadPersistedSession,
  shouldCompactContext,
  compactContext,
  persistSession,
  deletePersistedSession,
  estimateMessagesTokens,
  getContextWindow,
} from "../core/session-context";
import { handleMemorySave } from "../core/tools/handlers/memory";
import {
  trackSessionTokens,
  trackSessionEvent,
  trackContextCompaction,
  trackMemoryFlush,
} from "../core/metrics";
import { shouldRunMemoryFlush, resolveMemoryFlushSettings } from "../core/memory/flush";
import { broadcastStatus } from "../core/status";
import { emitAgentHook } from "../core/agent-hooks";

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed";
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
}

export interface ChatRequest {
  message: string;
  agentId?: string;
  sessionId?: string;
  stream?: boolean;
  tools?: boolean;
  channel?: string;
  userId?: string;
  source?: string;
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
  agent?: {
    id: string;
    name: string;
  };
  thinking?: string;
  tool_calls?: ToolCallInfo[];
}

const chatSessions = new Map<
  string,
  {
    id: string;
    agentId: string;
    messages: ChatMessage[];
    createdAt: string;
    persisted: boolean;
    compactionCount?: number; // Track compaction cycles for memory flush
    lastFlushCompactionCount?: number; // Last compaction cycle we flushed
  }
>();

async function loadPersistedSessions() {
  try {
    const sessions = await listPersistedSessions();

    for (const sessionInfo of sessions) {
      const session = await loadPersistedSession(sessionInfo.id);
      if (session) {
        chatSessions.set(sessionInfo.id, {
          id: sessionInfo.id,
          agentId: session.agentId,
          messages: session.messages,
          createdAt: sessionInfo.createdAt,
          persisted: true,
        });
        console.log(`[Chat] Loaded persisted session ${sessionInfo.id.slice(0, 8)}...`);
      }
    }

    if (sessions.length > 0) {
      console.log(`[Chat] Restored ${sessions.length} persisted sessions`);
    }
  } catch (error) {
    console.error("[Chat] Failed to load persisted sessions:", error);
  }
}

setTimeout(loadPersistedSessions, 1000);

export function stripThinkingTags(content: string): { content: string; thinking: string } {
  const patterns = [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<think>([\s\S]*?)<\/think>/gi,
    /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
  ];

  const thinkingMatches: string[] = [];
  let cleanContent = content;

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) {
        thinkingMatches.push(match[1].trim());
      }
    }
    cleanContent = cleanContent.replace(pattern, "").trim();
  }

  if (thinkingMatches.length === 0) {
    const lines = content.split("\n");
    const thinkingLines: string[] = [];
    const nonThinkingLines: string[] = [];
    let inThinkingBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith("<thinking>")) {
        inThinkingBlock = true;
        continue;
      }
      if (line.trim().startsWith("</thinking>")) {
        inThinkingBlock = false;
        continue;
      }
      if (
        inThinkingBlock ||
        line.trim().match(/^(The user|Let me|I can|First|Step|So |Answer:)/i)
      ) {
        thinkingLines.push(line);
      } else {
        nonThinkingLines.push(line);
      }
    }

    if (thinkingLines.length > 2 && thinkingLines.length < lines.length * 0.5) {
      cleanContent = nonThinkingLines.join("\n").trim();
      thinkingMatches.push(thinkingLines.join("\n"));
    }
  }

  return {
    content: cleanContent,
    thinking: thinkingMatches.join("\n\n"),
  };
}

const chatRateLimitConfig = { windowMs: 60000, maxRequests: 60 }; // 60 requests per minute

export async function handleChat(request: ChatRequest): Promise<ChatResponse> {
  const { message, agentId, sessionId, tools = true, channel, userId, source } = request;

  broadcastStatus({ status: "thinking", timestamp: Date.now() });

  const rateLimit = checkRateLimit("chat", chatRateLimitConfig);
  if (!rateLimit.allowed) {
    return {
      sessionId: sessionId || crypto.randomUUID(),
      message: {
        role: "assistant",
        content: "Rate limit exceeded. Please try again later.",
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (!message.trim()) {
    throw new Error("Message is required");
  }

  let session = sessionId ? chatSessions.get(sessionId) : undefined;

  if (!session) {
    const agent = agentId
      ? agentManager.get(agentId)
      : agentManager.list().find((a) => a.status === "running") || agentManager.list()[0];

    if (!agent) {
      return {
        sessionId: crypto.randomUUID(),
        message: {
          role: "assistant",
          content: "No agent available. Please create or select an agent first.",
          timestamp: new Date().toISOString(),
        },
      };
    }

    const newSessionId = sessionId || crypto.randomUUID();
    session = {
      id: newSessionId,
      agentId: agent.id,
      messages: [
        {
          role: "system",
          content:
            agent.system_prompt ||
            "You are a helpful AI assistant with access to tools. Use tools when needed to help the user.",
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      persisted: false,
    };
    chatSessions.set(newSessionId, session);

    trackSessionEvent(newSessionId, "created", { agentId: agent.id, model: agent.model });
  }

  const agent = agentManager.get(session.agentId);
  const hookContext = {
    agentId: agent?.id,
    sessionId: session.id,
    channel,
    userId,
  };

  const userMessage: ChatMessage = {
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(userMessage);

  await emitAgentHook({
    type: "message:received",
    context: hookContext,
    message,
    metadata: {
      source: source || "chat_api",
    },
  });

  await logSessionMessage(session.id, "user", message, {
    agentId: agent?.id,
    metadata: { source: "chat_api" },
  });

  const provider = agent ? agentManager.resolveProvider(agent.id) : undefined;

  if (provider && agent) {
    const contextWindow = getContextWindow(agent.model);
    const currentTokens = estimateMessagesTokens(session.messages);
    const flushSettings = resolveMemoryFlushSettings();

    trackSessionTokens(session.id, currentTokens, contextWindow, agent.model, {
      messageCount: session.messages.length,
    });

    if (
      flushSettings &&
      shouldRunMemoryFlush({
        totalTokens: currentTokens,
        contextWindowTokens: contextWindow,
        softThresholdTokens: flushSettings.softThresholdTokens,
        lastFlushCompactionCount: session.lastFlushCompactionCount,
        currentCompactionCount: session.compactionCount || 0,
      })
    ) {
      console.log(
        `[Chat] Running pre-compaction memory flush (${currentTokens}/${contextWindow} tokens)`
      );
      const flushStartTime = Date.now();

      try {
        const flushMessages: AgentMessage[] = [
          ...session.messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: flushSettings.prompt },
        ];

        const flushResult = await agentManager.callLLM(
          provider,
          agent.model,
          flushMessages,
          [], // No tools - just let agent respond naturally (it can write to files if needed)
          {
            agentId: agent.id,
            sessionId: session.id,
            channel,
            userId,
          }
        );

        session.lastFlushCompactionCount = session.compactionCount || 0;

        trackMemoryFlush(session.id, true, {
          tokensBeforeFlush: currentTokens,
          compactionCount: session.compactionCount || 0,
          durationMs: Date.now() - flushStartTime,
        });
        trackSessionEvent(session.id, "memory_flushed", { model: agent.model });

        console.log(`[Chat] Memory flush completed: ${flushResult.content.substring(0, 100)}...`);
      } catch (flushError) {
        console.error(`[Chat] Memory flush failed:`, flushError);
        trackMemoryFlush(session.id, false, {
          tokensBeforeFlush: currentTokens,
          compactionCount: session.compactionCount || 0,
        });
      }
    }

    const contextCheck = shouldCompactContext(session.messages, agent.model, message);

    if (contextCheck.needed) {
      console.log(
        `[Chat] Context compaction needed: ${contextCheck.currentTokens}/${contextCheck.maxTokens} tokens`
      );
      const compactionStart = Date.now();
      const messagesBefore = session.messages.length;
      const tokensBefore = estimateMessagesTokens(session.messages);

      const compaction = await compactContext(session.messages, agent.model, agent.provider_id);
      if (compaction.wasCompacted) {
        session.messages = compaction.messages;
        session.compactionCount = (session.compactionCount || 0) + 1;

        const tokensAfter = estimateMessagesTokens(session.messages);
        trackContextCompaction(session.id, {
          messagesBefore,
          messagesAfter: session.messages.length,
          tokensBefore,
          tokensAfter,
          model: agent.model,
          durationMs: Date.now() - compactionStart,
        });
        trackSessionEvent(session.id, "compacted", { model: agent.model });

        console.log(`[Chat] Context compacted. Summary: ${compaction.summary?.slice(0, 100)}...`);
      }
    }
  }

  let responseContent: string;
  const thinkingContent: string = "";
  const allToolCalls: ToolCallInfo[] = [];

  if (provider && agent) {
    try {
      const circuit = checkCircuit(`llm:${provider.id}`);
      if (!circuit.allowed) {
        throw new Error(`LLM circuit breaker open for provider ${provider.id}`);
      }

      const executionMessages: AgentMessage[] = session.messages.map((sessionMessage) => ({
        role: sessionMessage.role,
        content: sessionMessage.content,
      }));
      const result = await agentManager.execute(agent.id, executionMessages, {
        useTools: tools,
        sessionId: session.id,
      });
      responseContent = result.content;

      const toolResults = result.tool_calls || [];
      if (toolResults.length > 0) {
        for (const tc of toolResults) {
          allToolCalls.push({
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            name: tc.name,
            args: {},
            status: "completed",
            result: tc.result,
            duration: 0,
          });
        }

        const toolResultsText = toolResults
          .map(
            (tc) =>
              `Tool: ${tc.name}\nResult: ${typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)}`
          )
          .join("\n\n");

        try {
          const summaryMessages: AgentMessage[] = [
            ...session.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
            {
              role: "user",
              content: `The user asked: "${message}"\n\nTools executed:\n${toolResultsText}\n\nIf more actions are needed to fully complete the user's request (e.g., taking a screenshot after navigating), call the appropriate tools. Otherwise, respond to the user with what was accomplished.`,
            },
          ];

          const providerForSummary = agent?.provider_id
            ? providerManager.getWithCredentials(agent.provider_id)
            : undefined;

          if (providerForSummary) {
            const toolSchemaList = tools ? getToolSchemasForLLM() : [];

            const summaryResult = await agentManager.callLLM(
              providerForSummary,
              agent?.model,
              summaryMessages,
              toolSchemaList.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.input_schema,
              })),
              {
                agentId: agent.id,
                sessionId: session.id,
                channel,
                userId,
              }
            );
            responseContent = summaryResult.content;

            if (summaryResult.tool_calls && summaryResult.tool_calls.length > 0) {
              for (const tc of summaryResult.tool_calls) {
                allToolCalls.push({
                  id: `call_${crypto.randomUUID().slice(0, 8)}`,
                  name: tc.name,
                  args: {},
                  status: "completed",
                  result: tc.result,
                  duration: 0,
                });
              }

              let screenshotFound = false;
              let screenshotPath = "";
              for (const tc of summaryResult.tool_calls) {
                const toolResult = tc.result as { filePath?: unknown } | undefined;
                if (typeof toolResult?.filePath === "string") {
                  screenshotFound = true;
                  screenshotPath = toolResult.filePath;
                  break;
                }
              }

              if (screenshotFound) {
                responseContent = `Here's the screenshot of the page:\n\n📸 Screenshot saved: ${screenshotPath}\n\n![Screenshot](file://${screenshotPath})`;
              } else {
                const allToolResultsText = [...toolResults, ...summaryResult.tool_calls]
                  .map(
                    (tc) =>
                      `Tool: ${tc.name}\nResult: ${typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result).substring(0, 500)}`
                  )
                  .join("\n\n");

                const finalMessages: AgentMessage[] = [
                  {
                    role: "user",
                    content: `The user asked: "${message}"\n\nAll tools completed:\n${allToolResultsText}\n\nProvide a brief, friendly response summarizing what was accomplished.`,
                  },
                ];

                try {
                  const finalResult = await agentManager.callLLM(
                    providerForSummary,
                    agent?.model,
                    finalMessages,
                    [], // No more tools - final response only
                    {
                      agentId: agent.id,
                      sessionId: session.id,
                      channel,
                      userId,
                    }
                  );
                  responseContent = finalResult.content;
                } catch {
                  responseContent = `Completed! ${allToolCalls.length} tool${allToolCalls.length === 1 ? "" : "s"} executed successfully.`;
                }
              }
            }
          }
        } catch {
          console.log("[Chat] Could not generate summary, using formatted tool output");
          responseContent = `Here are the results from the tool execution:\n\n${toolResultsText}`;
        }
      }

      recordCircuitSuccess(`llm:${provider.id}`);
      console.log(`[Chat] LLM response: ${responseContent.substring(0, 100)}...`);
    } catch (error) {
      recordCircuitFailure(`llm:${provider.id}`);
      console.error("[Chat] LLM API error:", (error as Error).message);
      responseContent = `I encountered an error calling the LLM API: ${(error as Error).message}. Please check your provider configuration.`;
    }
  } else {
    responseContent =
      "No AI provider configured. Please add a provider (like MiniMax, OpenAI, or Ollama) to enable AI responses.";
  }

  const { content: cleanContent, thinking: extractedThinking } = stripThinkingTags(responseContent);
  const finalThinking = thinkingContent || extractedThinking;

  const memoryPatterns = [
    /(?:remember|save to memory|store this|note this|don't forget)(?: that |: )?(.+)/i,
    /(?:I'll|I will|I've) (?:already )?(?:saved|stored|remembered|noted)(?: that |: )?(.+)/i,
    /(?:I'll|I will|I've) (?:already )?(?:saved|stored|remembered|noted|keep that in mind|noted it)(?: that |: | for )?(.+)/i,
  ];

  if (allToolCalls.length === 0 && provider?.provider === "minimax") {
    for (const pattern of memoryPatterns) {
      const match = message.match(pattern);
      if (match && match[1] && match[1].length > 3 && match[1].length < 500) {
        try {
          await handleMemorySave({
            content: match[1].trim(),
            type: "context",
            tags: ["auto-saved"],
          });
          console.log(`[Chat] Auto-saved memory: "${match[1].substring(0, 50)}..."`);
        } catch {
          // Ignore memory save errors
        }
        break;
      }
    }
  }

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: cleanContent,
    timestamp: new Date().toISOString(),
    thinking: finalThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
  };
  session.messages.push(assistantMessage);

  await logSessionMessage(session.id, "assistant", cleanContent, {
    agentId: agent?.id,
    metadata: {
      source: "chat_api",
      thinking: finalThinking,
      tool_calls: allToolCalls,
    },
  });

  await persistSession(session.id, session.agentId, session.messages);
  session.persisted = true;

  await emitAgentHook({
    type: "message:sent",
    context: hookContext,
    message: cleanContent,
    metadata: {
      source: source || "chat_api",
      toolCalls: allToolCalls.length,
    },
  });

  if (agent) {
    await logAgentActivity(
      agent.id,
      "chat_response",
      `Responded to session ${session.id.slice(0, 8)}...`,
      {
        sessionId: session.id,
        messageLength: cleanContent.length,
        toolsUsed: allToolCalls.length,
      }
    );
  }

  console.log("[Chat] Broadcasting idle status");
  broadcastStatus({ status: "idle", timestamp: Date.now() });

  return {
    sessionId: session.id,
    message: assistantMessage,
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
        }
      : undefined,
    thinking: finalThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
  };
}

export async function getSession(sessionId: string) {
  const session = chatSessions.get(sessionId);
  if (session) return session;

  const subagentSession = getSubagentSession(sessionId);
  if (subagentSession) {
    return {
      id: subagentSession.id,
      agentId: "subagent",
      messages: subagentSession.messages.map((m) => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
        timestamp: m.timestamp,
      })),
      createdAt: subagentSession.createdAt,
      isSubagent: true,
      status: subagentSession.status,
      result: subagentSession.result,
    };
  }

  const persisted = await loadPersistedSession(sessionId);
  if (persisted) {
    const restoredSession = {
      id: sessionId,
      agentId: persisted.agentId,
      messages: persisted.messages,
      createdAt: new Date().toISOString(),
      persisted: true,
    };
    chatSessions.set(sessionId, restoredSession);
    return restoredSession;
  }

  return undefined;
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const session = await getSession(sessionId);
  return session?.messages || [];
}

export async function listSessions(): Promise<
  Array<{ id: string; agentId: string; messageCount: number; createdAt: string }>
> {
  const memorySessions = Array.from(chatSessions.values()).map((s) => ({
    id: s.id,
    agentId: s.agentId,
    messageCount: s.messages.length,
    createdAt: s.createdAt,
  }));

  const persistedSessions = await listPersistedSessions();

  const persistedMap = new Map(memorySessions.map((s) => [s.id, s]));

  for (const ps of persistedSessions) {
    if (!persistedMap.has(ps.id)) {
      memorySessions.push({
        id: ps.id,
        agentId: ps.agentId,
        messageCount: ps.messageCount,
        createdAt: ps.createdAt,
      });
    }
  }

  return memorySessions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const memoryDeleted = chatSessions.delete(sessionId);

  const persistedDeleted = await deletePersistedSession(sessionId);

  return memoryDeleted || persistedDeleted;
}

export function getChatRateLimitStatus() {
  return getRateLimitStatus("chat");
}

export function sendToSession(sessionKey: string, message: ChatMessage): boolean {
  const session = chatSessions.get(sessionKey);
  if (session) {
    session.messages.push(message);
    console.log(`[Chat] Injected message into session ${sessionKey.slice(0, 20)}...`);
    return true;
  }
  console.log(`[Chat] Session ${sessionKey.slice(0, 20)}... not in memory, skipping announcement`);
  return false;
}
