/**
 * Interactive tool-approval system with per-session allowlists.
 *
 * Replaces the previous "ask mode just throws" behavior. When a dangerous tool
 * is called in "ask" mode, this module:
 *  1. Emits an approval-request event (over the status stream + an API endpoint).
 *  2. Suspends the tool call until the user responds (once/session/always/deny).
 *  3. Caches per-session allowlist so approved tools don't re-prompt.
 *
 * Session state + allowlist, kept minimal: no LLM auto-approve (that's a
 * follow-up).
 */
import { broadcastStatus } from "./status";
import { config } from "./config";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId?: string;
  toolName: string;
  argsSummary: string;
  /** Full args for the approval UI to display (redacted). */
  argsPreview?: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "approved_once" | "approved_session" | "approved_always" | "denied";
  resolvedAt?: number;
}

export type ApprovalDecision = "approve_once" | "approve_session" | "approve_always" | "deny";

/** Per-session allowlist: tools approved for the rest of the session. */
const sessionAllowlist = new Map<string, Set<string>>();
/** Persistent (cross-session) allowlist: tools approved "always". */
const alwaysAllowlist = new Set<string>();
/** Pending approval requests keyed by id. */
const pendingRequests = new Map<string, ApprovalRequest>();
/** Resolvers for suspended tool calls. */
const resolvers = new Map<string, (decision: ApprovalDecision) => void>();

/** How long to wait for an approval response before timing out (ms). */
const APPROVAL_TIMEOUT_MS = 120_000;

/** Check if a tool is already approved (session or always). */
export function isToolApproved(sessionId: string, toolName: string): boolean {
  if (alwaysAllowlist.has(toolName)) return true;
  const session = sessionAllowlist.get(sessionId);
  return !!session?.has(toolName);
}

/** Grant session-level approval for a tool in a session. */
export function approveToolForSession(sessionId: string, toolName: string): void {
  let set = sessionAllowlist.get(sessionId);
  if (!set) {
    set = new Set();
    sessionAllowlist.set(sessionId, set);
  }
  set.add(toolName);
}

/** Grant persistent (always) approval for a tool. */
export function approveToolAlways(toolName: string): void {
  alwaysAllowlist.add(toolName);
}

/** Revoke a tool's approvals. */
export function revokeToolApproval(toolName: string, sessionId?: string): void {
  alwaysAllowlist.delete(toolName);
  if (sessionId) {
    sessionAllowlist.get(sessionId)?.delete(toolName);
  } else {
    for (const set of sessionAllowlist.values()) set.delete(toolName);
  }
}

/** Get all pending approval requests. */
export function getPendingApprovals(): ApprovalRequest[] {
  return [...pendingRequests.values()].filter((r) => r.status === "pending");
}

/** Resolve a pending approval request. Called by the API endpoint / UI. */
export function resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
  const request = pendingRequests.get(requestId);
  if (!request || request.status !== "pending") return false;
  const statusMap: Record<ApprovalDecision, ApprovalRequest["status"]> = {
    approve_once: "approved_once",
    approve_session: "approved_session",
    approve_always: "approved_always",
    deny: "denied",
  };
  request.status = statusMap[decision];
  request.resolvedAt = Date.now();

  // Update allowlists based on the decision.
  if (decision === "approve_session") {
    approveToolForSession(request.sessionId, request.toolName);
  } else if (decision === "approve_always") {
    approveToolAlways(request.toolName);
  }

  // Wake the suspended tool call.
  const resolver = resolvers.get(requestId);
  if (resolver) {
    resolver(decision);
    resolvers.delete(requestId);
  }

  // Clean up old requests after a delay.
  setTimeout(() => {
    pendingRequests.delete(requestId);
    resolvers.delete(requestId);
  }, 5_000);

  return true;
}

/**
 * Request approval for a dangerous tool call. If the tool is already approved
 * (session/always), returns immediately. Otherwise suspends until the user
 * responds or the timeout elapses (denies on timeout).
 */
export async function requestToolApproval(params: {
  sessionId: string;
  agentId?: string;
  toolName: string;
  argsSummary: string;
  argsPreview?: Record<string, unknown>;
}): Promise<ApprovalDecision> {
  const { sessionId, agentId, toolName, argsSummary, argsPreview } = params;

  // Fast path: already approved.
  if (isToolApproved(sessionId, toolName)) {
    return "approve_session";
  }

  // Check if approval mode is "always_allow" — skip entirely.
  const mode = config.getToolApprovalMode();
  if (mode === "always_allow") {
    return "approve_always";
  }

  // Create a pending request and suspend.
  const id = crypto.randomUUID();
  const request: ApprovalRequest = {
    id,
    sessionId,
    agentId,
    toolName,
    argsSummary,
    argsPreview,
    createdAt: Date.now(),
    status: "pending",
  };
  pendingRequests.set(id, request);

  // Broadcast so the UI can show an approval prompt.
  broadcastStatus({
    status: "tool_executing",
    sessionId,
    agentId,
    timestamp: Date.now(),
    detail: `Approval required: ${toolName}`,
  });

  return new Promise<ApprovalDecision>((resolve) => {
    // Timeout: auto-deny after APPROVAL_TIMEOUT_MS.
    const timer = setTimeout(() => {
      if (request.status === "pending") {
        resolveApproval(id, "deny");
      }
    }, APPROVAL_TIMEOUT_MS);

    resolvers.set(id, (decision) => {
      clearTimeout(timer);
      resolve(decision);
    });
  });
}

/** Reset per-session state (for tests). */
export function resetApprovalStateForTests(): void {
  sessionAllowlist.clear();
  pendingRequests.clear();
  resolvers.clear();
}

/** Get the loaded always-allowlist (for the UI/settings). */
export function getAlwaysAllowlist(): string[] {
  return [...alwaysAllowlist];
}
