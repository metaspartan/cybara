export interface EvalToolCall {
  id: string;
  name: string;
  status: "pending" | "executing" | "completed" | "failed";
  args: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration?: number;
  timeline_index?: number;
}

export interface EvalProcessActivity {
  id: string;
  phase: "start" | "result" | "error" | "blocked";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface EvalMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp?: string;
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
  thinking?: string;
  tool_calls?: EvalToolCall[];
  process_activities?: EvalProcessActivity[];
}

export interface TrajectoryRequest {
  messages: EvalMessage[];
  userMessage: EvalMessage;
  userMessageIndex: number;
  contextMessageCount: number;
  contextHash: string;
  workspaceDir: string | null;
}

export interface StructuralToolCall {
  name: string;
  status: string;
  argumentKeys: string[];
  resultKeys: string[];
  resultKinds: Record<string, string>;
}

export interface TrajectoryStructure {
  tools: StructuralToolCall[];
  response: {
    hasContent: boolean;
    hasThinking: boolean;
    contentKind: "empty" | "text" | "structured";
  };
}

export interface AgentTrajectory {
  id: string;
  sessionId: string;
  turnIndex: number;
  agentId: string;
  provider: string | null;
  model: string | null;
  request: TrajectoryRequest;
  response: EvalMessage;
  structure: TrajectoryStructure;
  createdAt: string;
}

export type GoldenResponseAssertion =
  | { type: "exact_text"; expected: string }
  | { type: "normalized_text"; expected: string }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json_schema"; schema: Record<string, unknown> }
  | { type: "citations"; minimum: number; domains?: string[] };

export interface GoldenToolAssertion {
  index: number;
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

export interface GoldenAssertions {
  response?: GoldenResponseAssertion;
  tools: GoldenToolAssertion[];
}

export interface AgentGolden {
  id: string;
  trajectoryId: string;
  name: string;
  description: string | null;
  tags: string[];
  assertions: GoldenAssertions;
  baseline: AgentTrajectory;
  createdAt: string;
  updatedAt: string;
}

export interface StructuralDifference {
  path: string;
  expected: unknown;
  actual: unknown;
  severity: "error" | "warning";
}

export interface StructuralComparison {
  equivalent: boolean;
  score: number;
  differences: StructuralDifference[];
}

export interface AgentEvalRun {
  id: string;
  goldenId: string;
  replaySessionId: string | null;
  status: "running" | "passed" | "failed" | "error";
  score: number | null;
  comparison: StructuralComparison | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type AgentDatasetRunStatus = "queued" | "running" | "completed" | "cancelled" | "error";

export type AgentDatasetItemStatus = "queued" | "running" | "completed" | "cancelled" | "error";

export interface AgentDatasetUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number | null;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  tokensPerSecond: number | null;
  averageFirstTokenMs: number | null;
}

export interface AgentDatasetRun {
  id: string;
  name: string;
  agentId: string;
  provider: string | null;
  model: string | null;
  status: AgentDatasetRunStatus;
  samplesPerPrompt: number;
  concurrency: number;
  toolsEnabled: boolean;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  cancelledItems: number;
  queuedItems: number;
  runningItems: number;
  cancelRequested: boolean;
  usage: AgentDatasetUsage;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentDatasetItem {
  id: string;
  runId: string;
  promptIndex: number;
  sampleIndex: number;
  prompt: string;
  sessionId: string;
  status: AgentDatasetItemStatus;
  trajectoryId: string | null;
  usage: AgentDatasetUsage;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
