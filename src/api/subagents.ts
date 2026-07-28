import type {
  SubagentActivity,
  SubagentRunOutcome,
  SubagentRunRecord,
  SubagentToolCall,
} from "../core/subagent-registry";

export type ApiSubagentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "killed";

export interface ApiSubagentSummary {
  id: string;
  label: string;
  status: ApiSubagentStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  task: string;
  sessionKey: string;
  requesterSessionId: string;
  model?: string;
  workspaceDir?: string;
  runTimeoutSeconds?: number;
  cleanup: "keep" | "delete";
  result?: string;
  error?: string;
  activityCount: number;
  toolCallCount: number;
}

export interface ApiSubagentDetail extends ApiSubagentSummary {
  outcome?: SubagentRunOutcome;
  thinking?: string;
  activities: SubagentActivity[];
  toolCalls: SubagentToolCall[];
}

export function isVisibleSubagentRun(run: SubagentRunRecord): boolean {
  return run.silent !== true;
}

export function subagentStatus(run: SubagentRunRecord): ApiSubagentStatus {
  if (run.outcome?.status === "ok") return "completed";
  if (run.outcome?.status === "error") return "failed";
  if (run.outcome?.status === "timeout") return "timeout";
  if (run.outcome?.status === "killed") return "killed";
  return run.startedAt ? "running" : "pending";
}

export function serializeSubagentSummary(run: SubagentRunRecord): ApiSubagentSummary {
  return {
    id: run.runId,
    label: run.label || run.task.slice(0, 50),
    status: subagentStatus(run),
    createdAt: new Date(run.createdAt).toISOString(),
    startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : undefined,
    endedAt: run.endedAt ? new Date(run.endedAt).toISOString() : undefined,
    task: run.task.slice(0, 200),
    sessionKey: run.childSessionKey,
    requesterSessionId: run.requesterSessionKey,
    model: run.model,
    workspaceDir: run.workspaceDir,
    runTimeoutSeconds: run.runTimeoutSeconds,
    cleanup: run.cleanup,
    result: run.outcome?.result,
    error: run.outcome?.error,
    activityCount: run.activities?.length || 0,
    toolCallCount: run.toolCalls?.length || 0,
  };
}

export function serializeSubagentDetail(run: SubagentRunRecord): ApiSubagentDetail {
  return {
    ...serializeSubagentSummary(run),
    task: run.task,
    outcome: run.outcome,
    thinking: run.thinking,
    activities: run.activities || [],
    toolCalls: run.toolCalls || [],
  };
}
