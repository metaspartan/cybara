import { readAgentContextWindowTokens } from "../core/agent-internals";
import { agentManager } from "../core/agent";
import { buildMemoryFlushMessages } from "../core/chat-token-optimization";
import { type Agent, type Provider } from "../core/database";
import { createLogger } from "../core/logger";
import { resolveMemoryFlushSettings, shouldRunMemoryFlush } from "../core/memory/flush";
import {
  trackContextCompaction,
  trackMemoryFlush,
  trackSessionEvent,
  trackSessionTokens,
} from "../core/metrics";
import {
  compactContext,
  estimateMessagesTokens,
  getContextWindow,
  shouldCompactContext,
} from "../core/session-context";
import { broadcastStatus } from "../core/status";
import { persistActiveSessionContext, type InMemoryChatSession } from "./chat-runtime-state";

const log = createLogger("ChatTurnContext");

export function resolveTurnContextWindow(
  agent: Pick<Agent, "config"> | undefined,
  effectiveModel: string | undefined
): { contextWindow: number; contextWindowTokens: number | undefined } {
  const contextWindowTokens = agent ? readAgentContextWindowTokens(agent.config) : undefined;
  const contextWindow = contextWindowTokens ?? getContextWindow(effectiveModel);
  return { contextWindow, contextWindowTokens };
}

export async function prepareTurnContext(input: {
  session: InMemoryChatSession;
  agent: Pick<Agent, "id" | "config" | "model" | "provider_id">;
  provider: Provider;
  effectiveModel: string | undefined;
  channel?: string;
  userId?: string;
  maxOutputTokens?: number;
  modelParamsOverride?: Record<string, unknown>;
}): Promise<void> {
  const { session, agent, provider, effectiveModel } = input;
  const { contextWindow, contextWindowTokens } = resolveTurnContextWindow(agent, effectiveModel);
  const currentTokens = estimateMessagesTokens(session.messages);
  const flushSettings = resolveMemoryFlushSettings();

  trackSessionTokens(session.id, currentTokens, contextWindow, effectiveModel, {
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
    log.info("Running pre-compaction memory flush", {
      sessionId: session.id,
      currentTokens,
      contextWindow,
    });
    const flushStartTime = Date.now();

    try {
      const flushMessages = buildMemoryFlushMessages(session.messages, flushSettings.prompt);
      const flushResult = await agentManager.callLLM(
        provider,
        effectiveModel ?? "",
        flushMessages,
        [],
        {
          agentId: agent.id,
          sessionId: session.id,
          channel: input.channel,
          userId: input.userId,
          workspaceDir: session.workspaceDir || undefined,
          suppressStreaming: true,
          maxOutputTokens: input.maxOutputTokens,
          modelParamsOverride: input.modelParamsOverride,
        }
      );
      session.lastFlushCompactionCount = session.compactionCount || 0;

      trackMemoryFlush(session.id, true, {
        tokensBeforeFlush: currentTokens,
        compactionCount: session.compactionCount || 0,
        durationMs: Date.now() - flushStartTime,
      });
      trackSessionEvent(session.id, "memory_flushed", {
        model: effectiveModel,
      });

      log.info("Memory flush completed", {
        sessionId: session.id,
        preview: flushResult.content.substring(0, 100),
      });
    } catch (flushError) {
      log.exception("Memory flush failed", flushError, {
        sessionId: session.id,
      });
      trackMemoryFlush(session.id, false, {
        tokensBeforeFlush: currentTokens,
        compactionCount: session.compactionCount || 0,
      });
    }
  }

  const contextCheck = shouldCompactContext(
    session.messages,
    effectiveModel,
    undefined,
    contextWindowTokens
  );

  if (contextCheck.needed) {
    log.info("Context compaction needed", {
      sessionId: session.id,
      currentTokens: contextCheck.currentTokens,
      maxTokens: contextCheck.maxTokens,
    });
    const compactionStart = Date.now();
    const messagesBefore = session.messages.length;
    const tokensBefore = estimateMessagesTokens(session.messages);

    broadcastStatus({
      status: "compacting",
      sessionId: session.id,
      agentId: agent.id,
      timestamp: Date.now(),
      detail: "Summarizing earlier conversation to continue...",
    });

    const compaction = await compactContext(session.messages, effectiveModel, agent.provider_id, {
      contextWindowTokens,
    });
    if (compaction.wasCompacted) {
      session.messages = compaction.messages;
      session.compactionCount = (session.compactionCount || 0) + 1;
      persistActiveSessionContext(session);

      const tokensAfter = estimateMessagesTokens(session.messages);
      trackContextCompaction(session.id, {
        messagesBefore,
        messagesAfter: session.messages.length,
        tokensBefore,
        tokensAfter,
        model: agent.model,
        durationMs: Date.now() - compactionStart,
      });
      trackSessionEvent(session.id, "compacted", { model: effectiveModel });

      log.info("Context compacted", {
        sessionId: session.id,
        summaryPreview: compaction.summary?.slice(0, 100),
      });
      broadcastStatus({
        status: "thinking",
        sessionId: session.id,
        agentId: agent.id,
        timestamp: Date.now(),
        detail: "Context automatically compacted",
      });
    }
  }
}
