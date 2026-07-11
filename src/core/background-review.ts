import { handleSessionsSpawn } from "./tools/handlers/channel";
import type { ToolContext } from "./tools/index";
import { config } from "./config";
import { agentManager } from "./agent";

export function resolveBackgroundAgentId(requesterAgentId?: string): string | undefined {
  const configured = config.get<string>("background_agent_id");
  if (configured && configured.trim() && agentManager.get(configured)) {
    return configured;
  }
  return requesterAgentId;
}

const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes per session
const DEFAULT_REVIEW_TIMEOUT_S = 90;
export const BACKGROUND_REVIEW_TOOL_NAMES = ["memory_search", "memory_get", "memory_save"] as const;

const lastReviewAt = new Map<string, number>();

export interface BackgroundReviewOptions {
  minIntervalMs?: number;
  timeoutSeconds?: number;
  disabled?: boolean;
}

function looksReviewable(lastAssistantText: string): boolean {
  const trimmed = lastAssistantText.trim();
  if (trimmed.length < 200) return false;
  return true;
}

function buildReviewPrompt(conversationExcerpt: string, _context?: ToolContext): string {
  return [
    "You are a background memory reviewer. Decide whether anything in the",
    "recent conversation is worth persisting to long-term memory for this user.",
    "",
    "Save ONLY durable, reusable facts: user preferences, key decisions,",
    "project context, recurring constraints, or corrections of earlier mistakes.",
    "Do NOT save transient status, greetings, or step-by-step narration.",
    "",
    "If there is something worth saving, call memory_save with a concise entry",
    "(type=preference|fact|decision, with a short tag). If nothing is worth",
    "saving, respond with exactly: NOTHING_TO_SAVE",
    "",
    "Recent conversation (excerpt):",
    "----",
    conversationExcerpt.slice(-4000),
    "----",
  ].join("\n");
}

export async function maybeRunBackgroundReview(
  context: ToolContext | undefined,
  lastAssistantText: string,
  options: BackgroundReviewOptions = {}
): Promise<void> {
  if (process.env.CYBARA_DISABLE_BACKGROUND_REVIEW === "1") return;
  if (options.disabled) return;
  if (!context?.sessionId) return;
  if (!looksReviewable(lastAssistantText)) return;

  const minInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = Date.now();
  const last = lastReviewAt.get(context.sessionId) ?? 0;
  if (now - last < minInterval) return;
  lastReviewAt.set(context.sessionId, now);

  const prompt = buildReviewPrompt(lastAssistantText, context);

  try {
    await handleSessionsSpawn(
      {
        task: prompt,
        label: "background-memory-review",
        agentId: resolveBackgroundAgentId(context.agentId),
        _requesterSessionKey: context.sessionId,
        workspaceDir: context.workspaceDir,
        runTimeoutSeconds: options.timeoutSeconds ?? DEFAULT_REVIEW_TIMEOUT_S,
        cleanup: "delete",
        silent: true,
      } as Record<string, unknown>,
      {
        ...context,
        allowedToolNames: [...BACKGROUND_REVIEW_TOOL_NAMES],
      }
    );
  } catch {}
}
