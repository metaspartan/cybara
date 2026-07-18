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
import { createHash } from "crypto";
import { broadcastStatus } from "./status";
import { config } from "./config";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId?: string;
  toolName: string;
  /**
   * The allowlist key this request grants. For command-bearing tools (exec,
   * process, git, execute_code) it includes a signature of the command/code, so
   * approving one command does NOT auto-approve a different one. Defaults to the
   * tool name for tools whose danger does not depend on their arguments.
   */
  approvalKey: string;
  argsSummary: string;
  /** Full args for the approval UI to display (redacted). */
  argsPreview?: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "approved_once" | "approved_session" | "approved_always" | "denied";
  resolvedAt?: number;
}

/**
 * Tools whose danger is entirely determined by their arguments — approving one
 * invocation must not blanket-approve every future call. Their approval key
 * incorporates the salient argument so `exec ls` never green-lights `exec rm`.
 */
const COMMAND_BEARING_ARG: Record<string, readonly string[]> = {
  exec: ["command"],
  process: ["command", "action"],
  git: ["command", "args"],
  execute_code: ["code", "language"],
  shell: ["command"],
};

const FILE_MUTATION_ARG: Record<string, readonly string[]> = {
  write: ["path", "content"],
  edit: ["path", "oldText", "newText"],
  apply_patch: ["path", "patch", "dryRun"],
};

/**
 * Build the allowlist key for a tool call. For command-bearing tools this binds
 * the approval to the specific command/arguments; for everything else the key is
 * just the tool name.
 */
export function buildApprovalKey(toolName: string, args?: Record<string, unknown>): string {
  const fileFields = FILE_MUTATION_ARG[toolName];
  if (fileFields && args) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    const payload = fileFields.slice(1).map((field) => args[field] ?? null);
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
    return `${toolName} ${path || "[path]"} sha256:${digest}`;
  }
  const SP = String.fromCharCode(32);
  const fields = COMMAND_BEARING_ARG[toolName];
  if (!fields || !args) return toolName;
  const signature = fields
    .map((f) => {
      const v = args[f];
      if (v === undefined || v === null) return "";
      return typeof v === "string" ? v : JSON.stringify(v);
    })
    .join(" ")
    .trim();
  return signature ? `${toolName} ${signature}` : toolName;
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

/**
 * Check if a call is already approved (session or always). The `approvalKey`
 * scopes the grant — pass the key from `buildApprovalKey` so a session approval
 * of one command does not silently cover a different command of the same tool.
 */
export function isToolApproved(sessionId: string, approvalKey: string): boolean {
  if (alwaysAllowlist.has(approvalKey)) return true;
  const session = sessionAllowlist.get(sessionId);
  return !!session?.has(approvalKey);
}

/** Grant session-level approval for a specific approval key in a session. */
export function approveToolForSession(sessionId: string, approvalKey: string): void {
  let set = sessionAllowlist.get(sessionId);
  if (!set) {
    set = new Set();
    sessionAllowlist.set(sessionId, set);
  }
  set.add(approvalKey);
}

/** Grant persistent (always) approval for a specific approval key. */
export function approveToolAlways(approvalKey: string): void {
  alwaysAllowlist.add(approvalKey);
}

/**
 * Revoke approvals. Matches both the exact key and any command-scoped keys that
 * begin with `"<toolName> "`, so revoking a tool clears all of its grants.
 */
export function revokeToolApproval(toolName: string, sessionId?: string): void {
  const matches = (key: string) => key === toolName || key.startsWith(`${toolName} `);
  for (const key of [...alwaysAllowlist]) {
    if (matches(key)) alwaysAllowlist.delete(key);
  }
  const clearFrom = (set: Set<string>) => {
    for (const key of [...set]) if (matches(key)) set.delete(key);
  };
  if (sessionId) {
    const set = sessionAllowlist.get(sessionId);
    if (set) clearFrom(set);
  } else {
    for (const set of sessionAllowlist.values()) clearFrom(set);
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

  // Update allowlists based on the decision, scoped to the specific approval key.
  if (decision === "approve_session") {
    approveToolForSession(request.sessionId, request.approvalKey);
  } else if (decision === "approve_always") {
    approveToolAlways(request.approvalKey);
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
  /** Allowlist key; defaults to a key derived from tool name + args. */
  approvalKey?: string;
  force?: boolean;
}): Promise<ApprovalDecision> {
  const { sessionId, agentId, toolName, argsSummary, argsPreview } = params;
  const approvalKey = params.approvalKey ?? buildApprovalKey(toolName, argsPreview);

  // Fast path: this exact call is already approved.
  if (isToolApproved(sessionId, approvalKey)) {
    return "approve_session";
  }

  // Check if approval mode is "always_allow" — skip entirely.
  const mode = config.getToolApprovalMode();
  if (mode === "always_allow" && params.force !== true) {
    return "approve_always";
  }

  // Create a pending request and suspend.
  const id = crypto.randomUUID();
  const request: ApprovalRequest = {
    id,
    sessionId,
    agentId,
    toolName,
    approvalKey,
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
  alwaysAllowlist.clear();
  pendingRequests.clear();
  resolvers.clear();
}

/** Get the loaded always-allowlist (for the UI/settings). */
export function getAlwaysAllowlist(): string[] {
  return [...alwaysAllowlist];
}
