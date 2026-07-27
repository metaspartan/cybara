interface RawAgentHistoryMessage {
  role?: string;
  content?: unknown;
}

interface RawAgentStatusResponse {
  active?: boolean;
}

type RawAgentFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

interface RawAgentRecoveryOptions {
  baselineMessageCount: number | null;
  fetchAPI: RawAgentFetch;
  sessionId: string;
  waitMs?: number;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return [];
      const record = block as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n")
    .trim();
}

export function latestRecoveredAssistantContent(
  messages: RawAgentHistoryMessage[],
  baselineMessageCount: number
): string | null {
  const candidates = messages.slice(Math.max(0, baselineMessageCount));
  for (let index = candidates.length - 1; index >= 0; index--) {
    const message = candidates[index];
    if (message?.role !== "assistant") continue;
    const content = textContent(message.content);
    if (content) return content;
  }
  return null;
}

function recoveryWaitMs(): number {
  const configured = Number(process.env.CYBARA_CLI_AGENT_WAIT_MS);
  return Number.isFinite(configured) && configured >= 10_000 ? configured : 86_400_000;
}

export async function recoverRawAgentResult({
  baselineMessageCount,
  fetchAPI,
  sessionId,
  waitMs = recoveryWaitMs(),
}: RawAgentRecoveryOptions): Promise<string | null> {
  if (baselineMessageCount === null) return null;
  const deadline = Date.now() + waitMs;
  let observedActiveRun = false;
  let inactiveChecks = 0;
  while (Date.now() < deadline) {
    const status = await fetchAPI<RawAgentStatusResponse>(
      `/api/status/sessions?sessionId=${encodeURIComponent(sessionId)}`
    );
    if (status?.active) {
      observedActiveRun = true;
      inactiveChecks = 0;
      await Bun.sleep(1_000);
      continue;
    }

    const messages = await fetchAPI<RawAgentHistoryMessage[]>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`
    );
    const content = latestRecoveredAssistantContent(messages || [], baselineMessageCount);
    if (content) return content;
    inactiveChecks += 1;
    if (!observedActiveRun && inactiveChecks >= 2) return null;
    if (observedActiveRun && inactiveChecks >= 8) return null;
    await Bun.sleep(250);
  }
  return null;
}
