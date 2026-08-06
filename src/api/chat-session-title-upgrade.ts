import type { agentManager } from "../core/agent";
import type { providerManager } from "../core/providers";
import { deriveSessionTitleFromTurn } from "../core/session-title";
import {
  cleanGeneratedSessionTitle,
  generateSessionTitleViaModel,
  type InMemoryChatSession,
} from "./chat-runtime-state";
import { updateSessionTitle } from "./chat-session-api";

export function applySessionTitleWithBackgroundUpgrade(params: {
  session: InMemoryChatSession;
  provider: ReturnType<typeof providerManager.getWithCredentials>;
  agent: NonNullable<ReturnType<typeof agentManager.get>> | undefined;
  message: string;
  channel?: string;
  userId?: string;
  abortSignal?: AbortSignal;
  skipModelUpgrade?: boolean;
}): void {
  const { session, agent } = params;
  const derivedTitle = cleanGeneratedSessionTitle(
    agent?.name,
    deriveSessionTitleFromTurn(params.message)
  );
  session.title = derivedTitle;
  if (params.skipModelUpgrade) return;
  void generateSessionTitleViaModel({
    provider: params.provider,
    agent,
    sessionId: session.id,
    userMessage: params.message,
    channel: params.channel,
    userId: params.userId,
    workspaceDir: session.workspaceDir,
    abortSignal: params.abortSignal,
  })
    .then(async (generatedTitle) => {
      const upgradedTitle = cleanGeneratedSessionTitle(agent?.name, generatedTitle);
      if (!upgradedTitle || upgradedTitle === session.title) return;
      if (session.title && session.title !== derivedTitle) return;
      session.title = upgradedTitle;
      await updateSessionTitle(session.id, upgradedTitle);
    })
    .catch(() => undefined);
}
