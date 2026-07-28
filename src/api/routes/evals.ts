import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentManager } from "../../core/agent";
import {
  type AgentEvalRun,
  applyGoldenAssertions,
  buildTrajectoryStructure,
  cancelDatasetRunExecutions,
  cancelIntelligenceBenchmarkRun,
  clearIntelligenceBenchmarkCancelRequest,
  compareTrajectoryStructures,
  countTrajectories,
  createDatasetRun,
  createEvalRun,
  createEvalSuiteBundle,
  createIntelligenceBenchmarkRun,
  createResearchDatasetCard,
  deleteDatasetRun,
  deleteGolden,
  deleteIntelligenceBenchmarkRun,
  deleteSessionTrajectories,
  type EvalReplayOptions,
  ensureSessionTrajectory,
  evalSuiteJsonl,
  explainIntelligenceBenchmarkGrade,
  exportResearchTraces,
  failIntelligenceBenchmarkRun,
  findRunningIntelligenceBenchmark,
  finishEvalRun,
  forkSessionFromMessages,
  getDatasetRun,
  getGolden,
  getTrajectory,
  gradeIntelligenceBenchmarkTask,
  INTELLIGENCE_RATING_EDGE_MARGIN,
  INTELLIGENCE_RATING_SUITE_ID,
  importGoldens,
  intelligenceRatingManifest,
  intelligenceRatingTasks,
  isDatasetRunActive,
  isIntelligenceBenchmarkCancelRequested,
  listDatasetRunItems,
  listDatasetRuns,
  listEvalRuns,
  listGoldens,
  listIntelligenceBenchmarkRuns,
  listSessionTrajectories,
  listTrajectories,
  parseEvalSuiteBundle,
  parseResearchExportFormat,
  registerEvalReplayExecutor,
  requestDatasetRunCancel,
  requestIntelligenceBenchmarkCancel,
  resumeDatasetRuns,
  retryDatasetRun,
  saveGolden,
  startDatasetRun,
  summarizeGolden,
  summarizeResearchTrace,
  summarizeResearchTraces,
  updateGoldenAssertions,
  updateIntelligenceBenchmarkRun,
} from "../../core/agent-eval";
import {
  datasetPromptAuthorMaxOutputTokens,
  generateDatasetPromptDraft,
  parseDatasetPromptDifficulty,
  parseDatasetPromptFocus,
} from "../../core/agent-eval/prompt-generation";
import { parseAgentConfig } from "../../core/agent-internals";
import { config } from "../../core/config";
import { deleteSession, handleChat } from "../chat";
import "../eval-dataset-runtime";
import type { RouteHandler } from "./_shared";
import { parseBoundedQueryNumber } from "./request-runtime";

function requireLabEnabled(): void {
  if (!config.getLabSettings().enabled) {
    throw new Error("Validation error: Lab is disabled in Settings");
  }
}

function requireGoldenTurnsEnabled(): void {
  requireLabEnabled();
  if (!config.getLabSettings().goldenTurnsEnabled) {
    throw new Error("Validation error: Golden turns are disabled in Lab settings");
  }
}

async function runGoldenReplay(
  goldenId: string,
  options?: EvalReplayOptions
): Promise<AgentEvalRun> {
  const golden = getGolden(goldenId);
  if (!golden) throw new Error("Golden test not found");
  const run = createEvalRun(golden.id);
  try {
    const baseline = golden.baseline;
    const replayAgentId = options?.agentId?.trim() || baseline.agentId;
    const fork = await forkSessionFromMessages({
      sourceSessionId: baseline.sessionId,
      messages: baseline.request.messages.slice(0, -1),
      workspaceDir: baseline.request.workspaceDir,
      agentId: replayAgentId,
      title: `${golden.name} replay`,
    });
    const response = await handleChat({
      sessionId: fork.sessionId,
      agentId: replayAgentId,
      message: baseline.request.userMessage.content,
      workspaceDir: baseline.request.workspaceDir ?? undefined,
      modelOverride: options?.modelOverride,
      source: "eval_replay",
      tools: true,
    });
    const actual = buildTrajectoryStructure(response.message);
    const comparison = applyGoldenAssertions(
      compareTrajectoryStructures(baseline.structure, actual),
      golden.assertions,
      response.message
    );
    return finishEvalRun(run.id, {
      replaySessionId: fork.sessionId,
      comparison,
    });
  } catch (error) {
    return finishEvalRun(run.id, {
      error: error instanceof Error ? error.message : "Replay failed",
    });
  }
}

async function runQuickIntelligenceBenchmark(runId: string, agentId: string): Promise<void> {
  let workspaceDir: string | null = null;
  const sessionIds: string[] = [];
  try {
    const agent = agentManager.get(agentId);
    if (!agent) throw new Error("Agent not found");
    workspaceDir = mkdtempSync(join(tmpdir(), "cybara-benchmark-"));
    await Bun.write(join(workspaceDir, "benchmark.txt"), "ORCHID-742");
    await Bun.write(join(workspaceDir, "data.csv"), "value\n17\n25\n41\n9\n");
    const results = [];
    let cancelled = false;
    for (const task of intelligenceRatingTasks) {
      if (isIntelligenceBenchmarkCancelRequested(runId)) {
        cancelled = true;
        break;
      }
      const sessionId = crypto.randomUUID();
      sessionIds.push(sessionId);
      const startedAt = Date.now();
      try {
        const response = await handleChat({
          sessionId,
          agentId,
          message: task.prompt,
          workspaceDir: workspaceDir ?? undefined,
          source: "intelligence_benchmark",
          tools: task.requiredTool !== undefined,
        });
        const calls = (response.message.tool_calls ?? []).map((call) => call.name);
        const passed = gradeIntelligenceBenchmarkTask(task, response.message.content, calls);
        results.push({
          taskId: task.id,
          label: task.label,
          category: task.category,
          passed,
          score: passed ? 100 : 0,
          rating: task.rating,
          response: response.message.content,
          expected: task.expected,
          difficulty: task.difficulty,
          weight: task.weight,
          gradingReason: explainIntelligenceBenchmarkGrade(task, response.message.content, calls),
          durationMs: Date.now() - startedAt,
          toolCalls: calls,
          error: null,
        });
      } catch (error) {
        results.push({
          taskId: task.id,
          label: task.label,
          category: task.category,
          passed: false,
          score: 0,
          rating: task.rating,
          response: "",
          expected: task.expected,
          difficulty: task.difficulty,
          weight: task.weight,
          gradingReason: error instanceof Error ? error.message : "The task failed to run.",
          durationMs: Date.now() - startedAt,
          toolCalls: [],
          error: error instanceof Error ? error.message : "Benchmark task failed",
        });
      }
      updateIntelligenceBenchmarkRun(runId, results, false);
    }
    if (cancelled) cancelIntelligenceBenchmarkRun(runId, results);
    else updateIntelligenceBenchmarkRun(runId, results, true);
  } catch (error) {
    failIntelligenceBenchmarkRun(
      runId,
      error instanceof Error ? error.message : "Benchmark failed"
    );
  } finally {
    clearIntelligenceBenchmarkCancelRequest(runId);
    await Promise.all(sessionIds.map((sessionId) => deleteSession(sessionId)));
    sessionIds.forEach((sessionId) => deleteSessionTrajectories(sessionId));
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  }
}

registerEvalReplayExecutor(runGoldenReplay);

export const evalRoutes: Record<string, RouteHandler> = {
  "GET /api/evals": () => ({
    goldens: listGoldens().map(summarizeGolden),
    runs: listEvalRuns(),
  }),
  "GET /api/evals/runs": (_body, params) => ({
    runs: listEvalRuns(parseBoundedQueryNumber(params?.limit, 1, 500) ?? 100),
  }),
  "GET /api/evals/research/traces": (_body, params) => {
    const limit = parseBoundedQueryNumber(params?.limit, 1, 1000) ?? 200;
    const offset = parseBoundedQueryNumber(params?.offset, 0, 1_000_000) ?? 0;
    const page = summarizeResearchTraces(listTrajectories(limit, offset));
    const all = summarizeResearchTraces(listTrajectories(1000));
    return {
      traces: page.traces,
      stats: all.stats,
      total: countTrajectories(),
      limit,
      offset,
    };
  },
  "GET /api/evals/research/export": (_body, params) => {
    const lab = config.getLabSettings();
    const ids = (params?.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 1000);
    const trajectories =
      ids.length > 0
        ? ids.map(getTrajectory).filter((trajectory) => trajectory !== null)
        : listTrajectories(1000);
    return exportResearchTraces(trajectories, {
      format: parseResearchExportFormat(params?.format ?? lab.defaultExportFormat),
      sanitize:
        params?.sanitize === undefined
          ? lab.sanitizeExportsByDefault
          : params.sanitize === "true" || params.sanitize === "1",
    });
  },
  "GET /api/evals/research/card": (_body, params) => {
    const lab = config.getLabSettings();
    const ids = (params?.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 1000);
    const trajectories =
      ids.length > 0
        ? ids.map(getTrajectory).filter((trajectory) => trajectory !== null)
        : listTrajectories(1000);
    return createResearchDatasetCard(trajectories, {
      format: parseResearchExportFormat(params?.format ?? lab.defaultExportFormat),
      sanitize:
        params?.sanitize === undefined
          ? lab.sanitizeExportsByDefault
          : params.sanitize === "true" || params.sanitize === "1",
    });
  },
  "GET /api/evals/datasets": (_body, params) => {
    requireLabEnabled();
    resumeDatasetRuns();
    return {
      runs: listDatasetRuns(parseBoundedQueryNumber(params?.limit, 1, 200) ?? 50),
    };
  },
  "GET /api/evals/datasets/:id": (_body, params) => {
    requireLabEnabled();
    const id = params?.id?.trim() || "";
    const run = getDatasetRun(id);
    if (!run) return { success: false, error: "Dataset run not found" };
    return {
      success: true,
      run,
      items: listDatasetRunItems(id).map((item) => {
        const trajectory = item.trajectoryId ? getTrajectory(item.trajectoryId) : null;
        return {
          ...item,
          trace: trajectory ? summarizeResearchTrace(trajectory) : null,
        };
      }),
    };
  },
  "POST /api/evals/dataset-prompts": async (body) => {
    requireLabEnabled();
    const data = (body || {}) as {
      agentId?: string;
      targetAgentId?: string;
      objective?: string;
      focus?: unknown;
      difficulty?: unknown;
      count?: number;
      toolsEnabled?: boolean;
      seedPrompts?: unknown;
    };
    const authorAgent = agentManager.get(data.agentId?.trim() || "");
    if (!authorAgent) return { success: false, error: "Select an available prompt author" };
    const targetAgent = agentManager.get(data.targetAgentId?.trim() || "");
    if (!targetAgent) return { success: false, error: "Select an available teacher agent" };
    const count = Math.floor(data.count ?? 12);
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      return { success: false, error: "Prompt count must be between 1 and 50" };
    }
    const objective = typeof data.objective === "string" ? data.objective.trim() : "";
    if (objective.length > 4_000) {
      return { success: false, error: "Dataset objective must be 4,000 characters or fewer" };
    }
    const seedPrompts = Array.isArray(data.seedPrompts)
      ? data.seedPrompts
          .filter((prompt): prompt is string => typeof prompt === "string")
          .map((prompt) => prompt.trim().slice(0, 4_000))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const targetAgentConfig = parseAgentConfig(targetAgent.config, targetAgent.id);
    const targetToolProfileValue = targetAgentConfig.tool_profile ?? targetAgentConfig.toolProfile;
    const promptAuthorSignal = AbortSignal.timeout(180_000);
    const prompts = await generateDatasetPromptDraft(
      {
        authorAgentName: authorAgent.name,
        authorModel: authorAgent.model || null,
        targetAgentName: targetAgent.name,
        targetModel: targetAgent.model || null,
        targetToolProfile:
          typeof targetToolProfileValue === "string" ? targetToolProfileValue : null,
        objective,
        focus: parseDatasetPromptFocus(data.focus),
        difficulty: parseDatasetPromptDifficulty(data.difficulty),
        count,
        toolsEnabled: data.toolsEnabled !== false,
        seedPrompts,
      },
      async (messages) => {
        const result = await agentManager.execute(authorAgent.id, messages, {
          useTools: false,
          useMemory: false,
          abortSignal: promptAuthorSignal,
          modelParamsOverride: { reasoning_effort: "minimal" },
          maxOutputTokens: datasetPromptAuthorMaxOutputTokens(count),
        });
        if (result.failure) {
          throw new Error(
            result.content || "The prompt author provider could not complete the request"
          );
        }
        return result.content;
      }
    );
    return {
      success: true,
      prompts,
      author: {
        id: authorAgent.id,
        name: authorAgent.name,
        model: authorAgent.model || null,
      },
      target: {
        id: targetAgent.id,
        name: targetAgent.name,
        model: targetAgent.model || null,
      },
    };
  },
  "POST /api/evals/datasets": (body) => {
    requireLabEnabled();
    const data = (body || {}) as {
      name?: string;
      agentId?: string;
      prompts?: unknown;
      samplesPerPrompt?: number;
      concurrency?: number;
      toolsEnabled?: boolean;
      maxOutputTokens?: number;
      sampleTimeoutSeconds?: number;
    };
    const agentId = data.agentId?.trim() || "";
    const agent = agentManager.get(agentId);
    if (!agent) return { success: false, error: "Select an available agent" };
    if (!Array.isArray(data.prompts)) {
      return { success: false, error: "Prompts must be an array" };
    }
    const prompts = data.prompts
      .filter((prompt): prompt is string => typeof prompt === "string")
      .map((prompt) => prompt.trim())
      .filter(Boolean);
    if (prompts.length === 0) return { success: false, error: "Add at least one prompt" };
    if (prompts.length > 500) return { success: false, error: "Use 500 prompts or fewer per run" };
    const samplesPerPrompt = Math.floor(data.samplesPerPrompt ?? 1);
    if (samplesPerPrompt < 1 || samplesPerPrompt > 8) {
      return { success: false, error: "Samples per prompt must be between 1 and 8" };
    }
    if (prompts.length * samplesPerPrompt > 1000) {
      return { success: false, error: "A dataset run can contain at most 1,000 samples" };
    }
    const concurrency = Math.floor(data.concurrency ?? 2);
    if (concurrency < 1 || concurrency > 6) {
      return { success: false, error: "Concurrency must be between 1 and 6" };
    }
    const maxOutputTokens = Math.floor(data.maxOutputTokens ?? 4096);
    if (maxOutputTokens < 512 || maxOutputTokens > 32768) {
      return { success: false, error: "Output budget must be between 512 and 32,768 tokens" };
    }
    const sampleTimeoutSeconds = Math.floor(data.sampleTimeoutSeconds ?? 300);
    if (sampleTimeoutSeconds < 30 || sampleTimeoutSeconds > 3600) {
      return { success: false, error: "Sample timeout must be between 30 and 3,600 seconds" };
    }
    const run = createDatasetRun({
      name: data.name?.trim().slice(0, 120) || `Dataset ${new Date().toLocaleDateString()}`,
      agentId,
      provider: agent.provider_pool_name || agent.provider_type || agent.provider || null,
      model: agent.model || null,
      prompts,
      samplesPerPrompt,
      concurrency,
      toolsEnabled: data.toolsEnabled !== false,
      maxOutputTokens,
      sampleTimeoutSeconds,
    });
    startDatasetRun(run.id);
    return { success: true, run: getDatasetRun(run.id) ?? run };
  },
  "POST /api/evals/datasets/:id/cancel": (_body, params) => {
    requireLabEnabled();
    const id = params?.id?.trim() || "";
    const run = requestDatasetRunCancel(id);
    if (!run) return { success: false, error: "Dataset run not found" };
    cancelDatasetRunExecutions(id);
    if (!isDatasetRunActive(id)) resumeDatasetRuns();
    return { success: true, run: getDatasetRun(id) ?? run };
  },
  "POST /api/evals/datasets/:id/retry": (_body, params) => {
    requireLabEnabled();
    const id = params?.id?.trim() || "";
    const run = retryDatasetRun(id);
    if (!run) return { success: false, error: "Run has no incomplete samples to retry" };
    startDatasetRun(id);
    return { success: true, run: getDatasetRun(id) ?? run };
  },
  "DELETE /api/evals/datasets/:id": (_body, params) => {
    requireLabEnabled();
    const id = params?.id?.trim() || "";
    const deleted = !isDatasetRunActive(id) && deleteDatasetRun(id);
    return deleted
      ? { success: true }
      : { success: false, error: "Run not found or still running" };
  },
  "GET /api/evals/datasets/:id/export": (_body, params) => {
    requireLabEnabled();
    const run = getDatasetRun(params?.id?.trim() || "");
    if (!run) throw new Error("Dataset run not found");
    const trajectories = listDatasetRunItems(run.id)
      .map((item) => (item.trajectoryId ? getTrajectory(item.trajectoryId) : null))
      .filter((trajectory) => trajectory !== null);
    const lab = config.getLabSettings();
    return exportResearchTraces(trajectories, {
      format: parseResearchExportFormat(params?.format ?? lab.defaultExportFormat),
      sanitize:
        params?.sanitize === undefined
          ? lab.sanitizeExportsByDefault
          : params.sanitize === "true" || params.sanitize === "1",
    });
  },
  "GET /api/evals/datasets/:id/card": (_body, params) => {
    requireLabEnabled();
    const run = getDatasetRun(params?.id?.trim() || "");
    if (!run) throw new Error("Dataset run not found");
    const trajectories = listDatasetRunItems(run.id)
      .map((item) => (item.trajectoryId ? getTrajectory(item.trajectoryId) : null))
      .filter((trajectory) => trajectory !== null);
    const lab = config.getLabSettings();
    return createResearchDatasetCard(trajectories, {
      format: parseResearchExportFormat(params?.format ?? lab.defaultExportFormat),
      sanitize:
        params?.sanitize === undefined
          ? lab.sanitizeExportsByDefault
          : params.sanitize === "true" || params.sanitize === "1",
    });
  },
  "GET /api/evals/benchmarks": (_body, params) => ({
    suite: {
      id: INTELLIGENCE_RATING_SUITE_ID,
      name: "Cybara Capability Smoke Score",
      description: `A reproducible, judge-free smoke suite with ${intelligenceRatingTasks.length} objectively graded tasks. The score is an internal ordinal for comparing runs of this suite version, not an externally calibrated intelligence measure.`,
      taskCount: intelligenceRatingTasks.length,
      minRating: Math.min(...intelligenceRatingTasks.map((task) => task.rating)),
      maxRating:
        Math.max(...intelligenceRatingTasks.map((task) => task.rating)) +
        INTELLIGENCE_RATING_EDGE_MARGIN,
      tasks: intelligenceRatingTasks.map(({ expected: _expected, ...task }) => task),
    },
    runs: listIntelligenceBenchmarkRuns(parseBoundedQueryNumber(params?.limit, 1, 200) ?? 50),
  }),
  "GET /api/evals/benchmarks/manifest": () => {
    const manifest = intelligenceRatingManifest();
    return {
      filename: `${INTELLIGENCE_RATING_SUITE_ID}-manifest.json`,
      mimeType: "application/json",
      content: JSON.stringify(manifest, null, 2),
      manifest,
    };
  },
  "GET /api/evals/benchmarks/export": () => {
    const runs = listIntelligenceBenchmarkRuns(200);
    return {
      filename: `cybara-benchmarks-${new Date().toISOString().slice(0, 10)}.jsonl`,
      mimeType: "application/x-ndjson",
      content: runs.map((run) => JSON.stringify(run)).join("\n"),
      count: runs.length,
    };
  },
  "POST /api/evals/benchmarks/cancel": (body) => {
    const data = (body || {}) as { runId?: string };
    if (!data.runId?.trim()) return { success: false, error: "runId is required" };
    const run = requestIntelligenceBenchmarkCancel(data.runId.trim());
    if (!run) return { success: false, error: "No running benchmark with that id" };
    return { success: true, run };
  },
  "DELETE /api/evals/benchmarks": (body) => {
    const data = (body || {}) as { runId?: string };
    if (!data.runId?.trim()) return { success: false, error: "runId is required" };
    const deleted = deleteIntelligenceBenchmarkRun(data.runId.trim());
    if (!deleted) {
      return {
        success: false,
        error: "Run not found or still running; cancel it first",
      };
    }
    return { success: true };
  },
  "POST /api/evals/benchmarks/run": async (body) => {
    const data = (body || {}) as { agentId?: string };
    if (!data.agentId?.trim()) return { success: false, error: "agentId is required" };
    const agentId = data.agentId.trim();
    const running = findRunningIntelligenceBenchmark();
    if (running) {
      return {
        success: false,
        error: "A benchmark is already running",
        run: running,
      };
    }
    const agent = agentManager.get(agentId);
    if (!agent) return { success: false, error: "Agent not found" };
    const run = createIntelligenceBenchmarkRun({
      agentId,
      provider: agent.provider_id || agent.provider || null,
      model: agent.model || null,
    });
    void runQuickIntelligenceBenchmark(run.id, agentId);
    return { success: true, run };
  },
  "GET /api/evals/export": (_body, params) => {
    const goldens = listGoldens();
    const runs = listEvalRuns(500);
    const sanitized = params?.sanitize === "true" || params?.sanitize === "1";
    const date = new Date().toISOString().slice(0, 10);
    if (params?.format === "jsonl") {
      return {
        filename: `cybara-eval-trajectories-${date}.jsonl`,
        mimeType: "application/x-ndjson",
        content: evalSuiteJsonl(goldens, { sanitize: sanitized, runs }),
        count: goldens.length,
      };
    }
    return {
      filename: `cybara-eval-suite-${date}.json`,
      mimeType: "application/json",
      content: JSON.stringify(createEvalSuiteBundle(goldens, { sanitize: sanitized }), null, 2),
      count: goldens.length,
    };
  },
  "POST /api/evals/import": (body) => {
    const data = (body || {}) as { bundle?: unknown };
    try {
      const imported = importGoldens(parseEvalSuiteBundle(data.bundle));
      return { success: true, imported, count: imported.length };
    } catch (error) {
      return {
        success: false,
        imported: [],
        count: 0,
        error: error instanceof Error ? error.message : "Invalid eval suite",
      };
    }
  },
  "POST /api/evals/goldens": async (body) => {
    requireGoldenTurnsEnabled();
    const data = (body || {}) as {
      sessionId?: string;
      messageIndex?: number;
      name?: string;
      description?: string;
      tags?: string[];
      assertions?: unknown;
    };
    if (!data.sessionId?.trim()) return { success: false, error: "sessionId is required" };
    const trajectory = await ensureSessionTrajectory(data.sessionId.trim(), data.messageIndex);
    const golden = saveGolden({
      trajectory,
      name:
        data.name?.trim() || trajectory.request.userMessage.content.slice(0, 80) || "Golden run",
      description: data.description,
      tags: Array.isArray(data.tags) ? data.tags : [],
      assertions: data.assertions,
    });
    return { success: true, golden };
  },
  "DELETE /api/evals/goldens/:id": (_body, params) => ({
    success: deleteGolden(params?.id || ""),
  }),
  "PUT /api/evals/goldens/:id/assertions": (body, params) => {
    const data = (body || {}) as { assertions?: unknown };
    const golden = updateGoldenAssertions(params?.id || "", data.assertions);
    return golden ? { success: true, golden } : { success: false, error: "Golden test not found" };
  },
  "POST /api/evals/goldens/:id/replay": async (body, params) => {
    const data = (body || {}) as { agentId?: string; modelOverride?: string };
    return {
      success: true,
      run: await runGoldenReplay(params?.id || "", {
        agentId: data.agentId,
        modelOverride: data.modelOverride,
      }),
    };
  },
  "POST /api/evals/run": async (body) => {
    const data = (body || {}) as { goldenIds?: string[] };
    const selected = Array.isArray(data.goldenIds)
      ? listGoldens().filter((golden) => data.goldenIds?.includes(golden.id))
      : listGoldens();
    const runs: AgentEvalRun[] = [];
    for (const golden of selected) {
      runs.push(await runGoldenReplay(golden.id));
    }
    return { success: true, runs };
  },
  "GET /api/sessions/:sessionId/trajectories": (_body, params) => {
    requireLabEnabled();
    const sessionId = params?.sessionId || "";
    return {
      sessionId,
      trajectories: listSessionTrajectories(sessionId),
    };
  },
  "POST /api/sessions/:sessionId/golden": async (body, params) => {
    requireGoldenTurnsEnabled();
    const data = (body || {}) as {
      messageIndex?: number;
      name?: string;
      description?: string;
      tags?: string[];
      assertions?: unknown;
    };
    const trajectory = await ensureSessionTrajectory(params?.sessionId || "", data.messageIndex);
    return {
      success: true,
      golden: saveGolden({
        trajectory,
        name:
          data.name?.trim() || trajectory.request.userMessage.content.slice(0, 80) || "Golden run",
        description: data.description,
        tags: Array.isArray(data.tags) ? data.tags : [],
        assertions: data.assertions,
      }),
    };
  },
};
