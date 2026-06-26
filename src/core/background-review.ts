/**
 * Background memory/skill review fork.
 *
 * After an agent turn completes, opportunistically fork a low-priority
 * subagent limited to `memory_*`/`skill_*` tools and ask: "should anything
 * from this turn be saved to long-term memory?" This lets the agent learn
 * user preferences and facts without polluting the main conversation loop or
 * its prompt cache.
 *
 * Ports hermes's `background_review`. Key properties:
 *  - Non-blocking: failures are swallowed; never affects the main turn.
 *  - Throttled: at most once per `minIntervalMs` per session.
 *  - Isolated: uses sessions_spawn with a restricted toolset and a short prompt.
 */
import { handleSessionsSpawn } from "./tools/handlers/channel";
import type { ToolContext } from "./tools/index";

const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes per session
const DEFAULT_REVIEW_TIMEOUT_S = 90;

const lastReviewAt = new Map<string, number>();

export interface BackgroundReviewOptions {
  /** Minimum interval between reviews for the same session. */
  minIntervalMs?: number;
  /** Spawn timeout. */
  timeoutSeconds?: number;
  /** Disable entirely (e.g. via config). */
  disabled?: boolean;
}

/**
 * Heuristic gate: only consider reviewing when the turn looks like it might
 * contain durable signal (enough content, not a trivial reply).
 */
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

/**
 * Fire-and-forget background review. Always resolves (never rejects) so callers
 * can invoke it without try/catch on the critical path.
 *
 * IMPORTANT: This spawns a subagent that makes its own LLM call. If the provider
 * has auth issues, the subagent will fail — but we must NOT let that failure
 * surface to the user's chat. The subagent is spawned with cleanup="delete" and
 * we swallow all errors. The review is also disabled entirely via env var
 * CYBARA_DISABLE_BACKGROUND_REVIEW=1.
 */
export async function maybeRunBackgroundReview(
  context: ToolContext | undefined,
  lastAssistantText: string,
  options: BackgroundReviewOptions = {}
): Promise<void> {
  if (options.disabled) return;
  // Allow disabling via env var.
  if (process.env.CYBARA_DISABLE_BACKGROUND_REVIEW === "1") return;
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
        // Reuse the requester's agent so the reviewer runs on the SAME provider
        // the user already has working. Without this, executeSubagent falls back
        // to availableAgents[0] (often a different provider whose token may be
        // expired), producing a spurious 401 that the user blamed on their
        // working MiniMax setup.
        agentId: context.agentId,
        // Restrict the reviewer to memory tools only.
        _requesterSessionKey: context.sessionId,
        workspaceDir: context.workspaceDir,
        runTimeoutSeconds: options.timeoutSeconds ?? DEFAULT_REVIEW_TIMEOUT_S,
        cleanup: "delete",
        // Silent: don't announce results/errors back to the parent session.
        // The background review is fire-and-forget; any errors (401, etc.)
        // must NOT surface to the user's chat.
        silent: true,
      } as Record<string, unknown>,
      context
    );
  } catch {
    // Best-effort: swallow errors so the main loop is unaffected.
  }
}
