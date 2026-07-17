import { fetchApi } from "@/lib/api-client";
import type { ChatMessage } from "@/types";

export interface AgentTrajectoryStructure {
  tools: Array<{
    name: string;
    status: string;
    argumentKeys: string[];
    resultKeys: string[];
  }>;
  response: {
    hasContent: boolean;
    hasThinking: boolean;
    contentKind: "empty" | "text" | "structured";
  };
}

export interface AgentGolden {
  id: string;
  trajectoryId: string;
  name: string;
  description: string | null;
  tags: string[];
  assertions: {
    response?: { type: string };
    tools: Array<{ index: number; name?: string }>;
  };
  baseline: {
    id: string;
    sessionId: string;
    turnIndex: number;
    agentId: string;
    provider: string | null;
    model: string | null;
    request: {
      userMessage: ChatMessage;
      userMessageIndex: number;
      workspaceDir: string | null;
    };
    structure: AgentTrajectoryStructure;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvalRun {
  id: string;
  goldenId: string;
  replaySessionId: string | null;
  status: "running" | "passed" | "failed" | "error";
  score: number | null;
  comparison: {
    equivalent: boolean;
    score: number;
    differences: Array<{
      path: string;
      expected: unknown;
      actual: unknown;
      severity: "error" | "warning";
    }>;
  } | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type ResearchExportFormat =
  | "cybara_trace"
  | "trl_sft"
  | "distillation_sft"
  | "hf_session_trace"
  | "prompt_completion"
  | "long_context";

export interface LabSettings {
  enabled: boolean;
  goldenTurnsEnabled: boolean;
  trajectoryCaptureEnabled: boolean;
  sanitizeExportsByDefault: boolean;
  defaultExportFormat: ResearchExportFormat;
}

export interface ResearchTraceSummary {
  id: string;
  sessionId: string;
  turnIndex: number;
  agentId: string;
  provider: string | null;
  model: string | null;
  promptPreview: string;
  responsePreview: string;
  messageCount: number;
  toolCallCount: number;
  toolNames: string[];
  failedToolCallCount: number;
  hasObservableReasoning: boolean;
  observableReasoningCharacters: number;
  qualityScore: number;
  qualityFlags: string[];
  split: "train" | "validation" | "test";
  createdAt: string;
}

export interface ResearchTraceStats {
  total: number;
  toolCalls: number;
  failedToolCalls: number;
  reasoningTraces: number;
  cleanTraces: number;
  train: number;
  validation: number;
  test: number;
}

export type IntelligenceTaskDifficulty =
  | "basic"
  | "intermediate"
  | "advanced"
  | "expert"
  | "stress";

export interface IntelligenceBenchmarkResult {
  taskId: string;
  label: string;
  category: "instruction" | "reasoning" | "coding" | "transformation" | "tool_use";
  passed: boolean;
  score: number;
  rating?: number;
  response: string;
  expected: string;
  difficulty: IntelligenceTaskDifficulty;
  weight: number;
  gradingReason: string;
  durationMs: number;
  toolCalls: string[];
  error: string | null;
}

export interface IntelligenceBenchmarkRun {
  id: string;
  suiteId: string;
  agentId: string;
  provider: string | null;
  model: string | null;
  status: "running" | "completed" | "cancelled" | "error";
  score: number;
  currentTask: number;
  results: IntelligenceBenchmarkResult[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const evalsApi = {
  list: () => fetchApi<{ goldens: AgentGolden[]; runs: AgentEvalRun[] }>("/evals"),
  export: (format: "bundle" | "jsonl", sanitize: boolean) =>
    fetchApi<{
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>(`/evals/export?format=${format}&sanitize=${sanitize ? "1" : "0"}`),
  import: (bundle: unknown) =>
    fetchApi<{
      success: boolean;
      imported: AgentGolden[];
      count: number;
      error?: string;
    }>("/evals/import", { method: "POST", body: JSON.stringify({ bundle }) }),
  replay: (goldenId: string, payload?: { agentId?: string; modelOverride?: string }) =>
    fetchApi<{ success: boolean; run: AgentEvalRun; error?: string }>(
      `/evals/goldens/${goldenId}/replay`,
      { method: "POST", body: JSON.stringify(payload ?? {}) }
    ),
  updateAssertions: (goldenId: string, assertions: AgentGolden["assertions"]) =>
    fetchApi<{ success: boolean; golden?: AgentGolden; error?: string }>(
      `/evals/goldens/${goldenId}/assertions`,
      { method: "PUT", body: JSON.stringify({ assertions }) }
    ),
  runSuite: (goldenIds?: string[]) =>
    fetchApi<{ success: boolean; runs: AgentEvalRun[]; error?: string }>("/evals/run", {
      method: "POST",
      body: JSON.stringify(goldenIds ? { goldenIds } : {}),
    }),
  deleteGolden: (goldenId: string) =>
    fetchApi<{ success: boolean }>(`/evals/goldens/${goldenId}`, {
      method: "DELETE",
    }),
};

export const researchApi = {
  traces: (limit = 200, offset = 0) =>
    fetchApi<{
      traces: ResearchTraceSummary[];
      stats: ResearchTraceStats;
      total: number;
      limit: number;
      offset: number;
    }>(`/evals/research/traces?limit=${limit}&offset=${offset}`),
  export: (format: ResearchExportFormat, sanitize: boolean, ids: string[]) => {
    const params = new URLSearchParams({
      format,
      sanitize: sanitize ? "1" : "0",
    });
    if (ids.length > 0) params.set("ids", ids.join(","));
    return fetchApi<{
      format: ResearchExportFormat;
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>(`/evals/research/export?${params.toString()}`);
  },
  datasetCard: (format: ResearchExportFormat, sanitize: boolean, ids: string[]) => {
    const params = new URLSearchParams({
      format,
      sanitize: sanitize ? "1" : "0",
    });
    if (ids.length > 0) params.set("ids", ids.join(","));
    return fetchApi<{
      filename: "README.md";
      mimeType: "text/markdown";
      content: string;
      count: number;
    }>(`/evals/research/card?${params.toString()}`);
  },
};

export const benchmarksApi = {
  list: () =>
    fetchApi<{
      suite: {
        id: string;
        name: string;
        description: string;
        taskCount: number;
        minRating?: number;
        maxRating?: number;
        tasks: Array<{
          id: string;
          label: string;
          category: string;
          prompt: string;
          rating?: number;
          difficulty: IntelligenceTaskDifficulty;
          weight: number;
          requiredTool?: string;
        }>;
      };
      runs: IntelligenceBenchmarkRun[];
    }>("/evals/benchmarks"),
  run: (agentId: string) =>
    fetchApi<{
      success: boolean;
      run?: IntelligenceBenchmarkRun;
      error?: string;
    }>("/evals/benchmarks/run", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  export: () =>
    fetchApi<{
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>("/evals/benchmarks/export"),
  manifest: () =>
    fetchApi<{ filename: string; mimeType: string; content: string }>("/evals/benchmarks/manifest"),
  cancel: (runId: string) =>
    fetchApi<{
      success: boolean;
      run?: IntelligenceBenchmarkRun;
      error?: string;
    }>("/evals/benchmarks/cancel", {
      method: "POST",
      body: JSON.stringify({ runId }),
    }),
  remove: (runId: string) =>
    fetchApi<{ success: boolean; error?: string }>("/evals/benchmarks", {
      method: "DELETE",
      body: JSON.stringify({ runId }),
    }),
};
