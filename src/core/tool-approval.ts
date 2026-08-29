import { createHash } from "crypto";
import { broadcastStatus } from "./status";
import { config } from "./config";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId?: string;
  toolName: string;
  approvalKey: string;
  argsSummary: string;
  argsPreview?: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "approved_once" | "approved_session" | "approved_always" | "denied";
  resolvedAt?: number;
}

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

const sessionAllowlist = new Map<string, Set<string>>();
const alwaysAllowlist = new Set<string>();
const pendingRequests = new Map<string, ApprovalRequest>();
const resolvers = new Map<string, (decision: ApprovalDecision) => void>();

const APPROVAL_TIMEOUT_MS = 120_000;

export function isToolApproved(sessionId: string, approvalKey: string): boolean {
  if (alwaysAllowlist.has(approvalKey)) return true;
  const session = sessionAllowlist.get(sessionId);
  return !!session?.has(approvalKey);
}

export function approveToolForSession(sessionId: string, approvalKey: string): void {
  let set = sessionAllowlist.get(sessionId);
  if (!set) {
    set = new Set();
    sessionAllowlist.set(sessionId, set);
  }
  set.add(approvalKey);
}

export function approveToolAlways(approvalKey: string): void {
  alwaysAllowlist.add(approvalKey);
}

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

export function getPendingApprovals(): ApprovalRequest[] {
  return [...pendingRequests.values()].filter((r) => r.status === "pending");
}

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

  if (decision === "approve_session") {
    approveToolForSession(request.sessionId, request.approvalKey);
  } else if (decision === "approve_always") {
    approveToolAlways(request.approvalKey);
  }

  const resolver = resolvers.get(requestId);
  if (resolver) {
    resolver(decision);
    resolvers.delete(requestId);
  }

  setTimeout(() => {
    pendingRequests.delete(requestId);
    resolvers.delete(requestId);
  }, 5_000);

  return true;
}

export async function requestToolApproval(params: {
  sessionId: string;
  agentId?: string;
  toolName: string;
  argsSummary: string;
  argsPreview?: Record<string, unknown>;
  approvalKey?: string;
  force?: boolean;
  abortSignal?: AbortSignal;
}): Promise<ApprovalDecision> {
  const { sessionId, agentId, toolName, argsSummary, argsPreview } = params;
  const approvalKey = params.approvalKey ?? buildApprovalKey(toolName, argsPreview);

  if (params.abortSignal?.aborted) {
    return "deny";
  }

  if (isToolApproved(sessionId, approvalKey)) {
    return "approve_session";
  }

  const mode = config.getToolApprovalMode();
  if (mode === "always_allow" && params.force !== true) {
    return "approve_always";
  }

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

  broadcastStatus({
    status: "tool_executing",
    sessionId,
    agentId,
    timestamp: Date.now(),
    detail: `Approval required: ${toolName}`,
  });

  return new Promise<ApprovalDecision>((resolve) => {
    const abort = () => resolveApproval(id, "deny");
    const timer = setTimeout(() => {
      if (request.status === "pending") {
        resolveApproval(id, "deny");
      }
    }, APPROVAL_TIMEOUT_MS);

    resolvers.set(id, (decision) => {
      clearTimeout(timer);
      params.abortSignal?.removeEventListener("abort", abort);
      resolve(decision);
    });
    params.abortSignal?.addEventListener("abort", abort, { once: true });
    if (params.abortSignal?.aborted) abort();
  });
}

export function resetApprovalStateForTests(): void {
  sessionAllowlist.clear();
  alwaysAllowlist.clear();
  pendingRequests.clear();
  resolvers.clear();
}

export function getAlwaysAllowlist(): string[] {
  return [...alwaysAllowlist];
}
