import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";
import {
  type ChatMessage,
  deletePendingChatMessage,
  deleteSession,
  getChatRateLimitStatus,
  getSession,
  getSessionMessages,
  getSessionPinned,
  handleChat,
  listPendingChatMessages,
  listSessionPage,
  listSessions,
  reorderPendingChatMessages,
  revertSessionToMessage,
  setSessionPinned,
  steerPendingChatMessage,
  stopActiveChatTurn,
  updatePendingChatMessage,
  updateSessionAgent,
  updateSessionTitle,
  updateSessionWorkspace,
} from "../api/chat";
import {
  handleMemoryCreate,
  handleMemoryDelete,
  handleMemoryEdit,
  handleMemoryList,
  handleMemorySearch,
} from "../api/memory/memory-api";
import { agentManager, getBuiltinTools } from "../core/agent";
import {
  type AgentEvalRun,
  applyGoldenAssertions,
  buildTrajectoryStructure,
  cancelIntelligenceBenchmarkRun,
  clearIntelligenceBenchmarkCancelRequest,
  compareTrajectoryStructures,
  countTrajectories,
  createResearchDatasetCard,
  createEvalRun,
  createEvalSuiteBundle,
  createIntelligenceBenchmarkRun,
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
  forkSession,
  forkSessionFromMessages,
  getGolden,
  getTrajectory,
  gradeIntelligenceBenchmarkTask,
  INTELLIGENCE_RATING_EDGE_MARGIN,
  INTELLIGENCE_RATING_SUITE_ID,
  importGoldens,
  intelligenceRatingManifest,
  intelligenceRatingTasks,
  isIntelligenceBenchmarkCancelRequested,
  listEvalRuns,
  listGoldens,
  listIntelligenceBenchmarkRuns,
  listSessionTrajectories,
  listTrajectories,
  parseEvalSuiteBundle,
  parseResearchExportFormat,
  registerEvalReplayExecutor,
  requestIntelligenceBenchmarkCancel,
  saveGolden,
  summarizeGolden,
  summarizeResearchTraces,
  updateIntelligenceBenchmarkRun,
  updateGoldenAssertions,
} from "../core/agent-eval";
import { agentImageSupportById, agentSupportsImages } from "../core/agent-image-capabilities";
import { parseAgentConfig } from "../core/agent-internals";
import {
  cancelAgentLoopRun,
  getAgentLoopRun,
  listAgentLoopRuns,
  startAgentLoop,
} from "../core/agent-loop";
import {
  parseAgentReasoningSetting,
  readAgentReasoningSetting,
  withAgentReasoningSetting,
} from "../core/agent-reasoning";
import { deleteArtifact, listAllArtifacts, listArtifacts, readArtifact } from "../core/artifacts";
import { getAppVersion, getBuildProvenance, getReleaseRepositoryUrl } from "../core/build-info";
import {
  channelManager,
  channels,
  processTelegramWebhook,
  securityManager,
  whatsappAdapter,
} from "../core/channels";
import { listChatCapabilities, listChatCommands } from "../core/chat/capability-mentions";
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
} from "../core/checkpoint";
import { config, redactSandboxRuntimeConfig } from "../core/config";
import { credentialDestinationChanged } from "../core/credential-destination";
import { resolveCybaraHome, setCybaraHomeOverride } from "../core/cybara-home";
import { tables } from "../core/database";
import {
  LOCAL_STT_MODELS,
  LOCAL_TTS_MODELS,
  LOCAL_TTS_VOICES,
  listLocalSttModelStatus,
  listLocalTtsModelStatus,
  loadLocalSttModel,
  loadLocalTtsModel,
  transcribeLocalSpeech,
  unloadLocalSttModel,
  unloadLocalTtsModel,
} from "../core/local-speech";
import { normalizeLocalTranscriptionAudio } from "../core/local-speech-audio";
import { createLogger } from "../core/logger";
import {
  getAgentLogs,
  getSessionMessages as getLogSessionMessages,
  getRecentActivity,
  searchAllLogs,
} from "../core/logging";
import {
  getMemoryProviderCatalog,
  mergeMemoryProviderSettingsUpdate,
  normalizeMemoryProviderId,
  redactMemoryProviderSettings,
  testMemoryProvider,
} from "../core/memory/providers";
import { getVectorStore } from "../core/memory/vector-store";
import { discoverProviderModels } from "../core/model-discovery";
import { cybaraDir, homeDir as runtimeHomeDir } from "../core/paths";
import {
  getBuiltinPluginCatalog,
  installPluginFromPayload,
  listInstalledPlugins,
  parsePluginInstallPayload,
  setPluginEnabled,
  uninstallLocalPlugin,
  validatePluginAtPath,
  validatePluginInstallPayload,
} from "../core/plugins";
import {
  activateInstalledPluginRuntimes,
  activatePluginRuntime,
  deactivatePluginRuntime,
  getPluginProviderContribution,
  listPluginChannelContributions,
  listPluginCommands,
  listPluginProviderContributions,
} from "../core/plugins/runtime";
import { discoverMarketplacePlugins, installMarketplacePlugin } from "./plugin-marketplace";
import {
  enrichProviderPlanStatusWithLiveUsage,
  getProviderPlanAvailability,
  getProviderPlanMonitoringConfig,
  getProviderPlanStatus,
  setProviderPlanMonitoringConfig,
} from "../core/provider-plans";
import {
  createProviderAccountPool,
  deleteProviderAccountPool,
  listProviderAccountPools,
  removeProviderFromAccountPools,
  type ProviderAccountPool,
  type ProviderAccountPoolInput,
  updateProviderAccountPool,
} from "../core/provider-account-pool";
import {
  type ProviderType,
  providerManager,
  providers,
  resolveProviderType,
} from "../core/providers";
import { normalizeProviderSettings } from "../core/provider-settings";
import {
  createRealtimeVoiceSession,
  getRealtimeVoiceStatus,
  testRealtimeVoiceConnection,
} from "../core/realtime-voice";
import { getAllPricing, getRouterStatus, type RouterConfig, selectProvider } from "../core/router";
import { openUrlInBrowser } from "../core/runtime/open-url";
import { getSandboxRuntimeStatus, logSandboxRuntimeStatus } from "../core/sandbox";
import { taskScheduler } from "../core/scheduler";
import { estimateSessionContextUsage, summarizeSessionTokenUsage } from "../core/session-context";
import { extractLatestSessionPlan } from "../core/session-plan";
import { searchSessionMessages } from "../core/session-search";
import {
  clearSkillsCache,
  createEligibilityContext,
  createLocalSkill,
  executeSkill,
  getSkill,
  getSkillCategories,
  getSkills,
  getSkillsStatusReport,
  loadAllSkills,
  registryManager,
} from "../core/skills/index";
import {
  detectMigrationSources,
  runSourceMigration,
  type SourceMigrationRequest,
} from "../core/source-migration";
import { resolveSpeechTtsProvider, synthesizeSpeech } from "../core/speech";
import * as subagentRegistry from "../core/subagent-registry";
import {
  createSystemBackup,
  deleteSystemBackup,
  listSystemBackups,
  readSystemRestoreStatus,
  scheduleSystemRestore,
  systemBackupDirectory,
} from "../core/system-backup";
import { buildSystemPrompt } from "../core/system-prompt";
import { detectSystemSpeechCapability } from "../core/system-speech";
import { getAlwaysAllowlist, getPendingApprovals, resolveApproval } from "../core/tool-approval";
import {
  clearSubagentSession,
  handleSessionsSpawn,
  handleSessionsWait,
  killSubagentSession,
} from "../core/tools/handlers/channel";
import { executeTool, hasTool } from "../core/tools/handlers/index";
import {
  getCircuitState,
  getDangerousToolNames,
  getToolSchemasForLLM,
  isToolEnabledForAgent,
  type ToolContext,
} from "../core/tools/index";
import { checkForUpdate, isUpdateCheckDisabled } from "../core/update-check";
import { workspaceIndexer } from "../core/workspace-indexer";
import { getCybaraDataDirConfigInfo, getCybaraDataDirInfo } from "./data-dir-info";
import { gatewayAuthSettingsResponse, updateGatewayHostSetting } from "./gateway-network";
import { buildJourney } from "./journey";
import { mobileRoutes } from "./mobile";
import { pollProviderDeviceCodeOAuth, startProviderDeviceCodeOAuth } from "./provider-oauth-device";
import { pollProviderRedirectOAuth, startProviderRedirectOAuth } from "./provider-oauth-redirect";
import { getCombinedLogs, getCombinedLogsPage, getLogStats, normalizeTimestamp } from "./queries";
import { cacheMetricsRoutes, invalidateCachedRoute, prewarmMetricsRoutes } from "./route-cache";
import {
  buildGoogleAuthHeaders,
  decodeDictationAudioBase64,
  formatChannelTestError,
  isLikelyGoogleApiKey,
  isRawHttpResponse,
  makeRawHttpResponse,
  normalizeIdentityConfig,
  normalizeOptionalString,
  normalizeSecretString,
  normalizeSystemPromptConfig,
  parseJsonObject,
  pickDictationProvider,
  type RouteContext,
  type RouteHandler,
  type SessionMessageView,
  sanitizeSessionMessages,
  transcribeWithOpenAICompatibleProvider,
} from "./routes/_shared";
import { ideLspRoutes } from "./routes/ide-lsp-routes";
import { integrationCredentialRoutes } from "./routes/integration-credential-routes";
import { accountConnectorRoutes } from "./routes/account-connectors";
import { mcpRoutes } from "./routes/mcp";
import { metricsRoutes } from "./routes/metrics";
import { sessionEventRoutes } from "./routes/session-events";
import { externalTelemetryRoutes } from "./routes/external-telemetry";
import { getProcessMemoryUsage, healthRoutes } from "./routes/health";
import { toolCapabilityPolicyRoutes } from "./routes/tool-capability-policy";
import { browserSupervisionRoutes } from "./routes/browser-supervision";
import { nearbyRoutes } from "./routes/nearby";
import { createRouteMatcher } from "./route-matcher";
import {
  validateProviderBaseUrlShape,
  validateProviderCredentialShape,
} from "./routes/provider-validation";
import {
  buildCorsHeaders,
  logRequest,
  parseBoundedQueryNumber,
  recordApiMetrics,
  redactSecretConfig,
  requestLogs,
  securityHeaders,
} from "./routes/request-runtime";
import { runtimeRoutes } from "./routes/runtime-routes";
import {
  latestSessionModelMetadata,
  type SessionModelMetadata,
  sessionModelMetadata,
  sessionModelMetadataSnapshot,
} from "./routes/session-model-metadata";
import { formatSkillInstallSpec } from "./routes/skill-formatting";
import { walletRoutes } from "./routes/wallet";
import { webResearchRoutes } from "./routes/web-research-routes";
import {
  type AuthResult,
  clearGatewayPassword,
  getGatewayAuthSettings,
  revealGatewayApiKey,
  rotateGatewayApiKey,
  securityCheck,
  setGatewayBasePath,
  setGatewayPassword,
  setGatewayRemoteAccessSettings,
  setRequireAuthForLocalhost,
  validateUrl,
} from "./security";
import { serializeSubagentDetail, serializeSubagentSummary } from "./subagents";

const log = createLogger("API");

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

registerEvalReplayExecutor(runGoldenReplay);

function providerAccountPoolResponse(pool: ProviderAccountPool): Record<string, unknown> {
  return {
    id: pool.id,
    name: pool.name,
    provider: pool.provider,
    enabled: pool.enabled,
    routing_mode: pool.accounts.some((account) => account.priority !== undefined)
      ? "priority_then_usage"
      : "usage",
    accounts: pool.accounts.map((account) => {
      const provider = providerManager.get(account.providerId);
      return {
        provider_id: account.providerId,
        provider_name: provider?.name ?? account.providerId,
        priority: account.priority ?? null,
      };
    }),
  };
}

function providerAccountPoolInput(body: unknown): ProviderAccountPoolInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Validation error: Provider pool body is required");
  }
  const record = body as Record<string, unknown>;
  const accounts = Array.isArray(record.accounts)
    ? record.accounts.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const account = entry as Record<string, unknown>;
        const providerId = normalizeOptionalString(account.provider_id ?? account.providerId);
        return providerId
          ? [
              {
                providerId,
                priority: typeof account.priority === "number" ? account.priority : undefined,
              },
            ]
          : [];
      })
    : [];
  return {
    name: normalizeOptionalString(record.name) || "",
    provider: normalizeOptionalString(record.provider) || "",
    enabled: record.enabled !== false,
    accounts,
  };
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

function pluginSummary(plugin: ReturnType<typeof listInstalledPlugins>[number]) {
  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    author: plugin.manifest.author,
    homepage: plugin.manifest.homepage,
    source: plugin.source,
    rootDir: plugin.rootDir,
    skillDirs: plugin.skillDirs,
    skillNames: plugin.skillNames,
    skillCount: plugin.skillNames.length,
    contributions: Object.fromEntries(
      Object.entries(plugin.contributionFiles).map(([kind, files]) => [kind, files.length])
    ),
    enabled: plugin.enabled,
    builtIn: plugin.builtIn,
  };
}

const routes: Record<string, RouteHandler> = {
  ...walletRoutes,
  ...mobileRoutes,
  ...metricsRoutes,
  ...sessionEventRoutes,
  ...externalTelemetryRoutes,
  ...toolCapabilityPolicyRoutes,
  ...browserSupervisionRoutes,
  ...ideLspRoutes,
  ...runtimeRoutes,
  ...mcpRoutes,
  ...nearbyRoutes,
  ...accountConnectorRoutes,
  ...integrationCredentialRoutes,
  ...webResearchRoutes,
  ...healthRoutes,
  "GET /api/metrics": () => ({
    requestCount: requestLogs.length,
    recentRequests: requestLogs.slice(0, 100),
    rateLimits: {
      chat: getChatRateLimitStatus(),
    },
    circuitBreakers: getCircuitBreakersStatus(),
    memory: getProcessMemoryUsage(),
    uptime: process.uptime(),
  }),
  "GET /api/info": () => ({
    name: "Cybara",
    version: getAppVersion(),
    releaseRepositoryUrl: getReleaseRepositoryUrl(),
    setupComplete: config.isSetupComplete(),
    homeDir: runtimeHomeDir,
    ...getCybaraDataDirInfo(),
    defaultWorkspaceDir: config.getDefaultWorkspaceDir(),
    stats: {
      agents: agentManager.getStats(),
      providers: providerManager.getStats(),
      channels: channelManager.getStats(),
      tasks: taskScheduler.getStats(),
    },
  }),

  "GET /api/build-info": async () => ({
    version: getAppVersion(),
    release_repository_url: getReleaseRepositoryUrl(),
    ...(await getBuildProvenance()),
  }),

  "GET /api/update-check": async () => {
    if (isUpdateCheckDisabled()) {
      return {
        updateAvailable: false,
        latestVersion: null,
        currentVersion: getAppVersion(),
        releaseUrl: null,
        checkedAt: Date.now(),
        cached: true,
        disabled: true,
      };
    }
    return checkForUpdate();
  },
  "GET /api/setup/status": () => ({
    complete: config.isSetupComplete(),
    currentStep: config.getSetupStep(),
  }),
  "POST /api/setup/complete": async () => {
    config.completeSetup();
    return { success: true };
  },
  "GET /api/migrations/sources": () => ({
    sources: detectMigrationSources(),
  }),
  "POST /api/migrations/preview": async (body) =>
    runSourceMigration({
      ...((body || {}) as SourceMigrationRequest),
      dryRun: true,
    }),
  "POST /api/migrations/run": async (body) =>
    runSourceMigration({
      ...((body || {}) as SourceMigrationRequest),
      dryRun: false,
    }),
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
    if (running)
      return {
        success: false,
        error: "A benchmark is already running",
        run: running,
      };
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
    success: deleteGolden(params!.id),
  }),
  "PUT /api/evals/goldens/:id/assertions": (body, params) => {
    const data = (body || {}) as { assertions?: unknown };
    const golden = updateGoldenAssertions(params!.id, data.assertions);
    return golden ? { success: true, golden } : { success: false, error: "Golden test not found" };
  },
  "POST /api/evals/goldens/:id/replay": async (body, params) => {
    const data = (body || {}) as { agentId?: string; modelOverride?: string };
    return {
      success: true,
      run: await runGoldenReplay(params!.id, {
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
  "GET /api/config": () => ({
    ...redactSecretConfig(config.getAll()),
    dangerous_tool_policy: config.getDangerousToolPolicy(),
    tool_approval_mode: config.getToolApprovalMode(),
    web_tool_url_policy: config.getWebToolUrlPolicy(),
    sandbox_runtime: redactSandboxRuntimeConfig(config.getSandboxRuntime()),
    workspace_indexer: config.getWorkspaceIndexerSettings(),
    memory: config.getMemoryBehaviorSettings(),
    llm_timeouts: config.getLlmTimeoutSettings(),
    memory_provider: redactMemoryProviderSettings(config.getMemoryProviderSettings()),
    token_optimization: config.getTokenOptimizationSettings(),
    acp_enabled: config.get<boolean>("acp_enabled") !== false,
    speech: config.getSpeechSettings(),
    computer_use: config.getComputerUseSettings(),
    lab: config.getLabSettings(),
    default_workspace_dir: config.getDefaultWorkspaceDir(),
    ...getCybaraDataDirConfigInfo(),
    reasoning_effort: config.getDefaultReasoningEffort(),
    follow_up_behavior_enabled: config.getFollowUpBehaviorEnabled(),
    self_improving_skills_enabled: config.get<boolean>("self_improving_skills_enabled") !== false,
  }),
  "GET /api/auth/settings": () => gatewayAuthSettingsResponse(),
  "PUT /api/auth/settings": (body) => {
    const data = (body || {}) as {
      requireAuthForLocalhost?: unknown;
      basePath?: unknown;
      host?: unknown;
      applyHostNow?: unknown;
      port?: unknown;
      gatewayPassword?: unknown;
      clearGatewayPassword?: unknown;
      remoteAccess?: unknown;
    };
    const settings = getGatewayAuthSettings();

    if (data.basePath !== undefined) {
      if (typeof data.basePath !== "string") {
        throw new Error("basePath must be a string");
      }
      if (settings.basePathForced) {
        throw new Error(
          "Base path is forced by the CYBARA_BASE_PATH environment variable and cannot be changed here"
        );
      }
      setGatewayBasePath(data.basePath);
    }

    if (data.host !== undefined) {
      const hostApply = updateGatewayHostSetting(data.host, data.applyHostNow, {
        port: Number(process.env.PORT) || config.get<number>("port") || 4269,
      });
      if (data.applyHostNow === true) return { ...gatewayAuthSettingsResponse(), ...hostApply };
    }

    if (data.port !== undefined) {
      const port = Number(data.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error("port must be an integer between 1024 and 65535");
      }
      if (Number(process.env.PORT)) {
        throw new Error(
          "Port is forced by the PORT environment variable and cannot be changed here"
        );
      }
      config.set("port", port);
    }

    if (data.requireAuthForLocalhost !== undefined) {
      if (typeof data.requireAuthForLocalhost !== "boolean") {
        throw new Error("requireAuthForLocalhost must be a boolean");
      }
      if (settings.requireAuthForLocalhostForced) {
        throw new Error(
          "Localhost auth requirement is forced by CYBARA_REQUIRE_AUTH/production mode and cannot be changed here"
        );
      }
      setRequireAuthForLocalhost(data.requireAuthForLocalhost);
    }

    if (data.gatewayPassword !== undefined) {
      setGatewayPassword(data.gatewayPassword);
    }

    if (data.remoteAccess !== undefined) setGatewayRemoteAccessSettings(data.remoteAccess);

    if (data.clearGatewayPassword !== undefined) {
      if (data.clearGatewayPassword !== true) {
        throw new Error("clearGatewayPassword must be true");
      }
      clearGatewayPassword();
    }

    return gatewayAuthSettingsResponse();
  },
  "GET /api/auth/key": () => ({ success: true, ...revealGatewayApiKey() }),
  "POST /api/auth/rotate-key": () => ({
    success: true,
    ...rotateGatewayApiKey(),
  }),
  "GET /api/speech/settings": () => config.getSpeechSettings(),
  "GET /api/speech/status": () => {
    const settings = config.getSpeechSettings();
    let tts: {
      ready: boolean;
      provider: string | null;
      type: string | null;
      systemFallback: boolean;
      error: string | null;
    } = {
      ready: false,
      provider: null,
      type: null,
      systemFallback: false,
      error: null,
    };
    const systemVoice = detectSystemSpeechCapability();
    tts.systemFallback = settings.tts.fallbackToSystem && systemVoice.available;
    if (settings.tts.provider === "local") {
      const localStatus = listLocalTtsModelStatus()[0];
      tts = {
        ...tts,
        ready: localStatus?.state !== "error",
        provider: "Kokoro 82M (local)",
        type: "local",
        error: localStatus?.state === "error" ? localStatus.lastError : null,
      };
    } else if (settings.tts.provider === "system") {
      tts = {
        ...tts,
        ready: systemVoice.available,
        provider: systemVoice.available ? systemVoice.label : null,
        type: "system",
        error: systemVoice.error,
      };
    } else {
      try {
        const resolved = resolveSpeechTtsProvider({ settings });
        if (resolved) {
          tts = {
            ...tts,
            ready: true,
            provider: resolved.provider.name,
            type: resolved.type,
          };
        } else if (tts.systemFallback) {
          tts = {
            ...tts,
            ready: true,
            provider: `${systemVoice.label} (fallback)`,
            type: "system",
          };
        } else {
          tts.error =
            settings.tts.provider === "auto"
              ? "No speech provider yet. Add OpenAI/ElevenLabs, pick Local Kokoro, or enable the system-voice fallback."
              : `No ${settings.tts.provider} provider with speech credentials is configured.`;
        }
      } catch (error) {
        tts.error = error instanceof Error ? error.message : "TTS provider resolution failed";
      }
    }
    let stt: {
      ready: boolean;
      provider: string | null;
      type: string | null;
      native: boolean;
      error: string | null;
    } = {
      ready: false,
      provider: null,
      type: null,
      native: settings.stt.provider === "native",
      error: null,
    };
    if (stt.native) {
      stt.ready = true;
    } else if (settings.stt.provider === "local" || settings.stt.provider === "auto") {
      const localStatus = listLocalSttModelStatus()[0];
      stt = {
        ...stt,
        ready: localStatus?.state !== "error",
        provider: "Whisper (local)",
        type: "local",
        error: localStatus?.state === "error" ? localStatus.lastError : null,
      };
    } else {
      try {
        const provider = pickDictationProvider(settings.stt.providerId || undefined);
        stt = {
          ...stt,
          ready: true,
          provider: provider.name,
          type: provider.provider,
        };
      } catch (error) {
        stt.error =
          error instanceof Error ? error.message : "Transcription provider resolution failed";
      }
    }
    return {
      success: true,
      tts,
      stt,
      realtime: getRealtimeVoiceStatus(settings.realtime),
      settings: {
        ttsProvider: settings.tts.provider,
        ttsVoice: settings.tts.voice,
        sttProvider: settings.stt.provider,
        realtimeProvider: settings.realtime.provider,
      },
    };
  },
  "PUT /api/speech/settings": (body) => ({
    success: true,
    speech: config.setSpeechSettings(body),
  }),
  "GET /api/speech/local/models": () => ({
    success: true,
    tts: {
      models: LOCAL_TTS_MODELS,
      voices: LOCAL_TTS_VOICES,
      status: listLocalTtsModelStatus(),
    },
    stt: {
      models: LOCAL_STT_MODELS,
      status: listLocalSttModelStatus(),
    },
  }),
  "POST /api/speech/local/load": async (body) => {
    const data = (body || {}) as { model?: string; kind?: string };
    try {
      if (data.kind === "stt") {
        await loadLocalSttModel(data.model?.trim() || undefined);
        return { success: true, status: listLocalSttModelStatus() };
      }
      await loadLocalTtsModel(data.model?.trim() || undefined);
      return { success: true, status: listLocalTtsModelStatus() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Model load failed",
        status: data.kind === "stt" ? listLocalSttModelStatus() : listLocalTtsModelStatus(),
      };
    }
  },
  "POST /api/speech/local/unload": (body) => {
    const data = (body || {}) as { model?: string; kind?: string };
    const unloaded =
      data.kind === "stt"
        ? unloadLocalSttModel(data.model?.trim() || undefined)
        : unloadLocalTtsModel(data.model?.trim() || undefined);
    return {
      success: true,
      unloaded,
      status: data.kind === "stt" ? listLocalSttModelStatus() : listLocalTtsModelStatus(),
    };
  },
  "POST /api/speech/realtime/session": async () => ({
    success: true,
    session: await createRealtimeVoiceSession(),
  }),
  "POST /api/speech/realtime/test": async () => ({
    success: true,
    result: await testRealtimeVoiceConnection(),
  }),
  "GET /api/sandbox/status": () => getSandboxRuntimeStatus(),
  "PUT /api/config": async (body) => {
    const data = body as Record<string, unknown>;
    let cybaraDataDirChanged = false;
    for (const [key, value] of Object.entries(data)) {
      if (key === "dangerous_tool_policy") {
        config.setDangerousToolPolicy(value);
        continue;
      }
      if (key === "tool_approval_mode") {
        config.setToolApprovalMode(value);
        continue;
      }
      if (key === "web_tool_url_policy") {
        config.setWebToolUrlPolicy(value);
        continue;
      }
      if (key === "sandbox_runtime") {
        config.setSandboxRuntime(value);
        logSandboxRuntimeStatus("config_update");
        continue;
      }
      if (key === "workspace_indexer") {
        workspaceIndexer.updateSettings(value);
        continue;
      }
      if (key === "memory") {
        config.setMemoryBehaviorSettings(value);
        continue;
      }
      if (key === "llm_timeouts") {
        config.setLlmTimeoutSettings(value);
        continue;
      }
      if (key === "memory_provider") {
        config.setMemoryProviderSettings(value);
        continue;
      }
      if (key === "token_optimization") {
        config.setTokenOptimizationSettings(value);
        continue;
      }
      if (key === "speech") {
        config.setSpeechSettings(value);
        continue;
      }
      if (key === "computer_use") {
        config.setComputerUseSettings(value);
        const { stopComputerUseDriver } = await import("../core/computer-use");
        stopComputerUseDriver();
        continue;
      }
      if (key === "lab") {
        config.setLabSettings(value);
        continue;
      }
      if (key === "default_workspace_dir") {
        config.setDefaultWorkspaceDir(value);
        continue;
      }
      if (key === "cybara_data_dir") {
        const next = setCybaraHomeOverride(value);
        cybaraDataDirChanged = next.dir !== cybaraDir;
        continue;
      }
      if (key === "reasoning_effort") {
        config.setDefaultReasoningEffort(value);
        continue;
      }
      if (key === "follow_up_behavior_enabled") {
        config.setFollowUpBehaviorEnabled(value);
        continue;
      }
      if (key === "chat_appearance") {
        config.setChatAppearanceSettings(value);
        continue;
      }
      if (value === "***redacted***") continue;
      config.set(key, value);
    }
    return {
      success: true,
      restartRequired: cybaraDataDirChanged || getCybaraDataDirInfo().cybaraDataDirRestartRequired,
      ...getCybaraDataDirConfigInfo(),
    };
  },

  "GET /api/agents": () => agentManager.list(),
  "GET /api/agents/summary": () => {
    const agents = agentManager.list();
    const imageSupport = agentImageSupportById(agents);
    return agents.map((agent) => {
      const toolProfile = parseAgentConfig(agent.config).tool_profile;
      return {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        model: agent.model,
        provider: agent.provider,
        provider_id: agent.provider_id,
        provider_type: agent.provider_type,
        provider_pool_id: agent.provider_pool_id,
        provider_pool_name: agent.provider_pool_name,
        fallback_provider_id: agent.fallback_provider_id,
        status: agent.status,
        created_at: agent.created_at,
        reasoning_effort: readAgentReasoningSetting(agent.config),
        tool_profile: typeof toolProfile === "string" ? toolProfile : "full",
        supports_images: imageSupport.get(agent.id) ?? false,
      };
    });
  },
  "POST /api/agents": (body) => {
    const data = body as Parameters<typeof agentManager.create>[0];
    return agentManager.create(data);
  },
  "POST /api/agents/default": async () => {
    if (agentManager.hasDefaultAgent()) {
      return { error: "Default agent already exists" };
    }
    const agent = agentManager.createDefault();
    try {
      await agentManager.start(agent.id);
    } catch {
      /* keep the created agent even if start fails */
    }
    return agentManager.get(agent.id) ?? agent;
  },
  "GET /api/agents/:id": (_body, params) => agentManager.get(params!.id),
  "PUT /api/agents/:id": (body, params) =>
    agentManager.update(params!.id, body as Parameters<typeof agentManager.update>[1]),
  "PUT /api/agents/:id/reasoning": (body, params) => {
    const agent = agentManager.get(params!.id);
    if (!agent) return { success: false, error: "Agent not found" };
    const parsed = parseAgentReasoningSetting(
      (body as { reasoning_effort?: unknown } | undefined)?.reasoning_effort
    );
    if (!parsed.valid) return { success: false, error: "Invalid reasoning effort" };
    const updated = agentManager.update(params!.id, {
      config: withAgentReasoningSetting(agent.config, parsed.effort),
    });
    if (!updated) return { success: false, error: "Agent not found" };
    return {
      success: true,
      reasoning_effort: readAgentReasoningSetting(updated.config),
    };
  },
  "POST /api/agents/:id/start": async (_body, params) => ({
    success: await agentManager.start(params!.id),
  }),
  "POST /api/agents/:id/stop": async (_body, params) => ({
    success: await agentManager.stop(params!.id),
  }),
  "DELETE /api/agents/:id": (_body, params) => ({
    success: agentManager.delete(params!.id),
  }),

  "POST /api/agents/:id/message": async (body, params) => {
    const data = body as { message: string };
    if (!data.message) throw new Error("Message content is required");
    const result = await agentManager.message(params!.id, data.message);
    return result;
  },
  "POST /api/agents/:id/loops": async (body, params) => {
    const data = body as {
      objective?: string;
      label?: string;
      maxIterations?: number;
      maxDurationSeconds?: number;
      maxDuration?: number;
      model?: string;
      useTools?: boolean;
    };

    if (!data.objective || !data.objective.trim()) {
      return { success: false, error: "objective is required" };
    }

    try {
      const run = startAgentLoop({
        agentId: params!.id,
        objective: data.objective,
        label: data.label,
        maxIterations: data.maxIterations,
        maxDurationSeconds:
          typeof data.maxDurationSeconds === "number" ? data.maxDurationSeconds : data.maxDuration,
        modelOverride: data.model,
        useTools: data.useTools,
      });

      return { success: true, runId: run.id, run };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
  "GET /api/agents/:id/loops": (_body, params) => ({
    runs: listAgentLoopRuns(params!.id),
  }),
  "GET /api/agents/:id/history": (_body, params) => {
    return { messages: agentManager.getHistory(params!.id) };
  },
  "DELETE /api/agents/:id/history": (_body, params) => {
    return { success: agentManager.clearHistory(params!.id) };
  },
  "GET /api/agents/:id/state": (_body, params) => {
    const state = agentManager.getState(params!.id);
    if (!state) return { running: false };
    return {
      running: true,
      startedAt: state.startedAt.toISOString(),
      pid: state.pid,
      messageCount: state.messages.length,
      lastActive: state.lastActive.toISOString(),
    };
  },

  "POST /api/agents/:id/chat": async (body, params) => {
    const data = body as {
      message: string;
      sessionId?: string;
      clientPendingId?: string;
      workspaceDir?: string;
      queueMode?: "queue" | "steer";
      useModelRouter?: boolean;
      images?: Array<{ data?: string; url?: string; mimeType?: string }>;
    };
    return await handleChat({
      message: data.message,
      agentId: params!.id,
      sessionId: data.sessionId,
      clientPendingId: data.clientPendingId,
      workspaceDir: data.workspaceDir,
      queueMode: data.queueMode,
      useModelRouter: data.useModelRouter,
      images: data.images,
    });
  },

  "GET /api/tools/builtin": () => getBuiltinTools(),
  "GET /api/tools": () => getToolSchemasForLLM(),
  "GET /api/tools/dangerous": () => ({
    policy: config.getDangerousToolPolicy(),
    tools: getDangerousToolNames(),
  }),
  "GET /api/tools/approvals": () => ({
    pending: getPendingApprovals(),
    alwaysAllowed: getAlwaysAllowlist(),
  }),
  "POST /api/tools/approvals/resolve": (body) => {
    const data = body as { requestId?: string; decision?: string };
    if (!data.requestId || !data.decision) {
      return { success: false, error: "requestId and decision are required" };
    }
    const valid = ["approve_once", "approve_session", "approve_always", "deny"];
    if (!valid.includes(data.decision)) {
      return {
        success: false,
        error: `Invalid decision. Must be one of: ${valid.join(", ")}`,
      };
    }
    const ok = resolveApproval(data.requestId, data.decision as never);
    return { success: ok };
  },
  "GET /api/tools/:name": (_body, params) => {
    const schemas = getToolSchemasForLLM();
    const found = schemas.find((t) => t.name === params!.name);
    return found || { error: "Tool not found" };
  },
  "POST /api/tools/execute": async (body) => {
    const data = body as {
      name: string;
      args: Record<string, unknown>;
      context?: Partial<ToolContext>;
    };
    if (!data.name) throw new Error("Tool name is required");

    if (!hasTool(data.name)) {
      throw new Error(`Invalid tool: ${data.name}`);
    }
    if (!isToolEnabledForAgent(data.name)) {
      throw new Error(`Validation error: Tool '${data.name}' is disabled by configuration`);
    }

    const contextPermissions = Array.isArray(data.context?.permissions)
      ? data.context.permissions.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
        )
      : undefined;
    const context: ToolContext = {
      agentId:
        typeof data.context?.agentId === "string" && data.context.agentId.trim()
          ? data.context.agentId
          : "api",
      sessionId:
        typeof data.context?.sessionId === "string" && data.context.sessionId.trim()
          ? data.context.sessionId
          : undefined,
      channel:
        typeof data.context?.channel === "string" && data.context.channel.trim()
          ? data.context.channel
          : "api",
      userId:
        typeof data.context?.userId === "string" && data.context.userId.trim()
          ? data.context.userId
          : "user",
      workspaceDir:
        typeof data.context?.workspaceDir === "string" && data.context.workspaceDir.trim()
          ? data.context.workspaceDir
          : undefined,
      permissions: contextPermissions,
      enforcePermissions: data.context?.enforcePermissions === true,
      // SECURITY: never let the HTTP caller self-grant dangerous-tool access.
      // Honoring a client-supplied `allowDangerousTools` let any API caller
      // bypass the dangerous-tool block and the approval gate (privilege
      // escalation). Dangerous tools must go through the normal
      // dangerous-tool policy / approval flow regardless of the request body.
      allowDangerousTools: false,
      confineToWorkspace:
        typeof data.context?.workspaceDir === "string" &&
        data.context.workspaceDir.trim().length > 0,
    };

    return await executeTool(data.name, data.args, {
      ...context,
    });
  },

  "GET /api/providers": () => providerManager.list(),
  "GET /api/provider-account-pools": () =>
    listProviderAccountPools().map(providerAccountPoolResponse),
  "POST /api/provider-account-pools": (body) =>
    providerAccountPoolResponse(
      createProviderAccountPool(providerAccountPoolInput(body), providerManager.list())
    ),
  "PUT /api/provider-account-pools/:id": (body, params) => {
    const pool = updateProviderAccountPool(
      params!.id,
      providerAccountPoolInput(body),
      providerManager.list()
    );
    if (!pool) throw new Error("Provider account pool not found");
    return providerAccountPoolResponse(pool);
  },
  "DELETE /api/provider-account-pools/:id": (_body, params) => ({
    success: deleteProviderAccountPool(params!.id),
  }),
  "GET /api/providers/available": () => [
    ...Object.entries(providers).map(([key, value]) => ({
      id: key,
      name: value.name,
      description: `Use ${value.name} models`,
      baseUrl: value.baseUrl,
      authType: value.authType,
      oauthFlow: (value as Record<string, unknown>).oauthFlow || null,
      hasOAuthConfig: !!(value as Record<string, unknown>).oauthConfig,
      oauthLoginUrl: (value as Record<string, unknown>).oauthLoginUrl || null,
      models: value.models.map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context,
        maxTokens: m.maxTokens,
        reasoning: m.reasoning,
        input: m.input,
      })),
    })),
    ...listPluginProviderContributions().map((provider) => ({
      id: provider.runtimeId,
      name: provider.name,
      description: `Use ${provider.name} models`,
      baseUrl: provider.baseUrl,
      authType: provider.authType === "none" ? "none" : "api_key",
      oauthFlow: null,
      hasOAuthConfig: false,
      oauthLoginUrl: null,
      models: provider.models.map((model) => ({
        id: model,
        name: model,
        input: ["text"],
      })),
    })),
  ],
  "GET /api/provider-plans/config": () => getProviderPlanMonitoringConfig(),
  "PUT /api/provider-plans/config": (body) => {
    const result = setProviderPlanMonitoringConfig(body);
    invalidateCachedRoute("GET /api/provider-plans/status");
    return result;
  },
  "GET /api/provider-plans/availability": () => getProviderPlanAvailability(),
  "GET /api/provider-plans/status": () =>
    enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus()),
  "POST /api/providers/:id/test": async (_body, params) => {
    const provider = providerManager.getWithCredentials(params!.id);
    if (!provider) {
      throw new Error("Provider not found");
    }

    const providerInfo = providers[provider.provider as ProviderType];
    if (!providerInfo) {
      throw new Error(`Unknown provider type: ${provider.provider}`);
    }

    const requiresCredentials = providerInfo.authType !== "none";
    const hasCredentials = !!(provider.api_key || provider.access_token || provider.refresh_token);

    if (requiresCredentials && !hasCredentials) {
      return {
        success: false,
        provider: provider.provider,
        message: "Provider credentials are missing",
      };
    }

    if (provider.provider === "ollama") {
      const baseUrl = provider.base_url || providerInfo.baseUrl || "http://localhost:11434";
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        return {
          success: response.ok,
          provider: provider.provider,
          message: response.ok
            ? "Ollama connection verified"
            : `Ollama returned HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `Failed to connect to Ollama: ${(error as Error).message}`,
        };
      }
    }

    if (provider.provider === "openai") {
      const apiKey = provider.api_key || provider.access_token;
      const baseUrl = provider.base_url || providerInfo.baseUrl || "https://api.openai.com/v1";
      if (!apiKey) {
        return {
          success: false,
          provider: provider.provider,
          message: "OpenAI API key is missing",
        };
      }

      try {
        const response = await fetch(`${baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const text = await response.text();
          const safeText = text.slice(0, 300);
          return {
            success: false,
            provider: provider.provider,
            message: `OpenAI auth/model check failed: HTTP ${response.status}${safeText ? ` - ${safeText}` : ""}`,
          };
        }

        return {
          success: true,
          provider: provider.provider,
          message: "OpenAI credentials verified",
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `OpenAI test failed: ${(error as Error).message}`,
        };
      }
    }

    if (provider.provider === "elevenlabs") {
      const apiKey = provider.api_key || provider.access_token;
      const baseUrl = (
        provider.base_url ||
        providerInfo.baseUrl ||
        "https://api.elevenlabs.io/v1"
      ).replace(/\/+$/, "");
      if (!apiKey) {
        return {
          success: false,
          provider: provider.provider,
          message: "ElevenLabs API key is missing",
        };
      }

      try {
        const response = await fetch(`${baseUrl}/voices`, {
          headers: {
            "xi-api-key": apiKey,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const text = await response.text();
          const safeText = text.slice(0, 300);
          return {
            success: false,
            provider: provider.provider,
            message: `ElevenLabs voice check failed: HTTP ${response.status}${safeText ? ` - ${safeText}` : ""}`,
          };
        }

        return {
          success: true,
          provider: provider.provider,
          message: "ElevenLabs credentials verified",
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `ElevenLabs test failed: ${(error as Error).message}`,
        };
      }
    }

    if (providerInfo.api === "google-generative-ai") {
      const baseUrl = (
        provider.base_url ||
        providerInfo.baseUrl ||
        "https://generativelanguage.googleapis.com/v1beta"
      ).replace(/\/+$/, "");
      if ((providerInfo.authType || "api_key") === "api_key") {
        const storedApiKey = provider.api_key?.trim();
        if (!storedApiKey) {
          return {
            success: false,
            provider: provider.provider,
            message: "Google API key is missing",
          };
        }
        if (/^https?:\/\//i.test(storedApiKey) || !isLikelyGoogleApiKey(storedApiKey)) {
          return {
            success: false,
            provider: provider.provider,
            message:
              "Stored Google API key appears invalid. Paste an AI Studio key that starts with 'AIza'.",
          };
        }
      }
      const authHeaders = buildGoogleAuthHeaders(providerInfo.authType || "api_key", {
        apiKey: provider.api_key ?? undefined,
        accessToken: provider.access_token ?? undefined,
      });
      const probeModelId = providerInfo.models?.[0]?.id || "gemini-3-pro-preview";
      if (!authHeaders.Authorization && !authHeaders["x-goog-api-key"]) {
        return {
          success: false,
          provider: provider.provider,
          message: "Google credentials are missing",
        };
      }

      try {
        const response = await fetch(`${baseUrl}/models/${encodeURIComponent(probeModelId)}`, {
          method: "GET",
          headers: authHeaders,
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const text = await response.text();
          const safeText = text.slice(0, 300);
          return {
            success: false,
            provider: provider.provider,
            message: `Google auth/model check failed: HTTP ${response.status}${safeText ? ` - ${safeText}` : ""}`,
          };
        }
        return {
          success: true,
          provider: provider.provider,
          message: "Google credentials verified",
        };
      } catch (error) {
        return {
          success: false,
          provider: provider.provider,
          message: `Google test failed: ${(error as Error).message}`,
        };
      }
    }

    return {
      success: true,
      provider: provider.provider,
      message: "Provider configuration appears valid",
    };
  },
  "GET /api/providers/:id": (_body, params) => {
    const provider = providerManager.get(params!.id);
    return provider || { error: "Provider not found" };
  },
  "POST /api/providers": (body) => {
    const data = body as {
      provider: string;
      name: string;
      api_key?: string;
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      base_url?: string;
      settings?: Record<string, unknown>;
      is_default?: boolean;
    };

    const apiKey = normalizeSecretString(data.api_key);
    const accessToken = normalizeSecretString(data.access_token);
    const refreshToken = normalizeSecretString(data.refresh_token);
    const normalizedBaseUrl = normalizeOptionalString(data.base_url);
    if (normalizedBaseUrl) {
      validateProviderBaseUrlShape(normalizedBaseUrl);
    }
    const resolvedProviderType = resolveProviderType(data.provider);
    const pluginProvider = getPluginProviderContribution(data.provider);
    if (!resolvedProviderType && !pluginProvider) {
      throw new Error(`Validation error: unknown provider '${data.provider}'`);
    }
    if (resolvedProviderType) {
      validateProviderCredentialShape(resolvedProviderType, {
        apiKey,
        accessToken,
      });
    } else if (pluginProvider?.authType !== "none" && !apiKey && !accessToken) {
      throw new Error("Validation error: plugin provider API key is required");
    }
    const providerSettings = normalizeProviderSettings(resolvedProviderType || "", data.settings);
    if (resolvedProviderType === "devin" && data.settings && !providerSettings) {
      throw new Error("Validation error: Devin organization ID is invalid");
    }

    if (pluginProvider) {
      const id = crypto.randomUUID();
      tables.providers.create({
        id,
        provider: pluginProvider.runtimeId,
        name: normalizeOptionalString(data.name) || data.name,
        api_key: apiKey,
        access_token: accessToken,
        base_url: normalizedBaseUrl || pluginProvider.baseUrl,
        settings: providerSettings,
        is_default: data.is_default === true,
      });
      for (const model of pluginProvider.models) {
        tables.providerModels.upsert({
          id: crypto.randomUUID(),
          provider_id: id,
          model_id: model,
          model_name: model,
        });
      }
      invalidateCachedRoute("GET /api/provider-plans/status");
      return providerManager.get(id);
    }
    const created = providerManager.create({
      provider: resolvedProviderType as Parameters<typeof providerManager.create>[0]["provider"],
      name: normalizeOptionalString(data.name) || data.name,
      api_key: apiKey,
      access_token: accessToken,
      refresh_token: refreshToken,
      settings: providerSettings,
      expires_at: typeof data.expires_at === "number" ? data.expires_at : undefined,
      base_url: normalizedBaseUrl,
      is_default: data.is_default,
    });
    invalidateCachedRoute("GET /api/provider-plans/status");
    return created;
  },
  "PUT /api/providers/:id": (body, params) => {
    const existing = providerManager.getWithCredentials(params!.id);
    if (!existing) {
      throw new Error("Provider not found");
    }

    const data = (body || {}) as Record<string, unknown>;
    const updates: Parameters<typeof providerManager.update>[1] = {};

    if ("name" in data) {
      const normalizedName = normalizeOptionalString(data.name);
      if (normalizedName) {
        updates.name = normalizedName;
      }
    }

    if ("base_url" in data) {
      const normalizedBaseUrl = normalizeOptionalString(data.base_url);
      if (normalizedBaseUrl) {
        validateProviderBaseUrlShape(normalizedBaseUrl);
        updates.base_url = normalizedBaseUrl;
      }
    }

    if ("is_default" in data) {
      updates.is_default = data.is_default === true;
    }

    if ("settings" in data) {
      const providerSettings = normalizeProviderSettings(existing.provider, {
        ...(existing.settings || {}),
        ...((data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
          ? data.settings
          : {}) as Record<string, unknown>),
      });
      if (existing.provider === "devin" && !providerSettings) {
        throw new Error("Validation error: Devin organization ID is invalid");
      }
      updates.settings = providerSettings;
    }

    if ("api_key" in data) {
      const normalizedApiKey = normalizeSecretString(data.api_key);
      if (normalizedApiKey) {
        updates.api_key = normalizedApiKey;
      }
    }

    if ("access_token" in data) {
      const normalizedAccessToken = normalizeSecretString(data.access_token);
      if (normalizedAccessToken) {
        updates.access_token = normalizedAccessToken;
      }
    }

    if ("refresh_token" in data) {
      const normalizedRefreshToken = normalizeSecretString(data.refresh_token);
      if (normalizedRefreshToken) {
        updates.refresh_token = normalizedRefreshToken;
      }
    }

    if ("expires_at" in data && typeof data.expires_at === "number") {
      updates.expires_at = data.expires_at;
    }

    const existingProviderType = resolveProviderType(existing.provider);
    const existingBaseUrl =
      existing.base_url ||
      (existingProviderType ? providers[existingProviderType]?.baseUrl : undefined);
    if (
      updates.base_url &&
      credentialDestinationChanged(existingBaseUrl, updates.base_url) &&
      ((existing.api_key && !updates.api_key) ||
        (existing.access_token && !updates.access_token) ||
        (existing.refresh_token && !updates.refresh_token))
    ) {
      throw new Error(
        "Validation error: credentials must be re-entered when changing the provider destination"
      );
    }

    validateProviderCredentialShape(existing.provider, {
      apiKey: updates.api_key,
      accessToken: updates.access_token,
    });

    const success = providerManager.update(params!.id, updates);
    if (success) invalidateCachedRoute("GET /api/provider-plans/status");
    return { success };
  },
  "DELETE /api/providers/:id": (_body, params) => {
    const success = providerManager.delete(params!.id);
    if (success) {
      removeProviderFromAccountPools(params!.id);
      invalidateCachedRoute("GET /api/provider-plans/status");
    }
    return { success };
  },
  "GET /api/providers/:id/models": async (_body, params) => {
    const provider = providerManager.get(params!.id);
    const discovery = discoverProviderModels(params!.id);
    const waitMs = provider?.provider === "openai-codex" ? 2500 : 600;
    await Promise.race([discovery, Bun.sleep(waitMs)]);
    return providerManager.getModels(params!.id);
  },
  "POST /api/providers/:id/models/discover": async (_body, params) =>
    await discoverProviderModels(params!.id, { force: true }),
  "POST /api/providers/discover/ollama": async () => await providerManager.discoverOllamaModels(),

  "GET /api/checkpoints": (_body, params) => {
    const workspaceDir = params?.workspace as string;
    if (!workspaceDir) return { checkpoints: [] };
    return { checkpoints: listCheckpoints(workspaceDir) };
  },
  "POST /api/checkpoints": async (body) => {
    const data = (body || {}) as { workspaceDir?: string; label?: string };
    if (!data.workspaceDir) return { success: false, error: "workspaceDir is required" };
    const checkpoint = await createCheckpoint(data.workspaceDir, data.label || "manual checkpoint");
    return checkpoint
      ? { success: true, checkpoint }
      : { success: false, error: "checkpoint failed" };
  },
  "POST /api/checkpoints/:id/restore": async (body, params) => {
    const data = (body || {}) as { workspaceDir?: string };
    const id = params?.id as string;
    if (!data.workspaceDir || !id) {
      return { success: false, error: "workspaceDir and id are required" };
    }
    return await restoreCheckpoint(data.workspaceDir, id);
  },
  "DELETE /api/checkpoints/:id": (_body, params) => {
    const workspaceDir = params?.workspace as string;
    const id = params?.id as string;
    if (!workspaceDir || !id) return { success: false, error: "workspace and id are required" };
    return { success: deleteCheckpoint(workspaceDir, id) };
  },

  "GET /api/system/backups": () => ({
    backups: listSystemBackups(),
    backupDirectory: systemBackupDirectory(),
    restore: readSystemRestoreStatus(),
  }),
  "POST /api/system/backups": (body) => {
    const data = (body || {}) as { label?: unknown; password?: unknown };
    const label = typeof data.label === "string" ? data.label : "Manual backup";
    const password =
      typeof data.password === "string" && data.password.trim() ? data.password : undefined;
    return {
      success: true,
      backup: createSystemBackup(label, undefined, password ? { password } : undefined),
    };
  },
  "POST /api/system/backups/:id/restore": (body, params) => {
    const data = (body || {}) as { password?: unknown };
    const password =
      typeof data.password === "string" && data.password.trim() ? data.password : undefined;
    return {
      success: true,
      restore: scheduleSystemRestore(params?.id || "", undefined, password),
      restartRequired: true,
    };
  },
  "DELETE /api/system/backups/:id": (_body, params) => ({
    success: deleteSystemBackup(params?.id || ""),
  }),

  "GET /api/router/status": () => getRouterStatus(),
  "GET /api/router/pricing": () => ({ pricing: getAllPricing() }),
  "PUT /api/router/config": (body) => {
    const cfg = body as RouterConfig;
    config.set("router", cfg);
    return { success: true };
  },
  "GET /api/router/config": () =>
    config.get("router") || {
      enabled: false,
      strategy: "weighted",
      fallbackToAny: true,
      routes: {},
    },
  "POST /api/router/select": (body) => {
    const { preferredProviderId } = body as { preferredProviderId?: string };
    const selected = selectProvider(preferredProviderId);
    return { providerId: selected };
  },

  "POST /api/providers/oauth/device-code": startProviderDeviceCodeOAuth,
  "POST /api/providers/oauth/poll": pollProviderDeviceCodeOAuth,

  "POST /api/open-url": async (body) => {
    const { url } = body as { url: string };
    if (!url || typeof url !== "string") throw new Error("url required");

    const validation = await validateUrl(url);
    if (!validation.valid) {
      throw new Error(`Invalid URL: ${validation.error || "URL blocked"}`);
    }

    await openUrlInBrowser(url);
    log.info(`Opened URL in browser: ${url.substring(0, 80)}...`);
    return { ok: true };
  },

  "POST /api/providers/oauth/start": startProviderRedirectOAuth,
  "POST /api/providers/oauth/callback-status": pollProviderRedirectOAuth,
  "GET /api/channels": () => channelManager.list(),
  "GET /api/channels/available": () =>
    Object.entries(channels).map(([key, value]) => ({
      id: key,
      ...value,
      fields: value.fields,
      webhook: !!channelManager.getAdapter(key as keyof typeof channels)?.handleWebhook,
    })),
  "POST /api/channels/telegram/setup": async (body) => {
    const data = body as { botToken?: string; webhookUrl?: string };
    if (!data.botToken) {
      throw new Error("Validation error: botToken is required");
    }

    let baseUrl = data.webhookUrl;
    if (baseUrl) {
      const parsed = new URL(baseUrl);
      baseUrl = `${parsed.protocol}//${parsed.host}`;
    } else {
      const configuredBaseUrl =
        config.get<string>("public_url") ||
        config.get<string>("base_url") ||
        `http://localhost:${config.get<number>("port") || 4269}`;
      baseUrl = configuredBaseUrl;
    }

    const channel = await channelManager.setupTelegram(data.botToken, baseUrl);
    if (!channel) {
      throw new Error("Failed to set up Telegram channel");
    }
    return channel;
  },
  "POST /api/channels": (body) => {
    const data = body as {
      type?: string;
      name?: string;
      config?: Record<string, unknown>;
    };
    if (!data.type || !data.name) {
      throw new Error("Validation error: type and name are required");
    }
    return channelManager.create(
      data.type as Parameters<typeof channelManager.create>[0],
      data.name,
      data.config || {}
    );
  },
  "GET /api/channels/:id": (_body, params) => {
    const channel = channelManager.list().find((c) => c.id === params!.id);
    return channel || { error: "Channel not found" };
  },
  "PUT /api/channels/:id": (body, params) => ({
    success: channelManager.update(params!.id, body as Parameters<typeof channelManager.update>[1]),
  }),
  "POST /api/channels/:id/toggle": (body, params) => {
    const data = body as { enabled: boolean };
    return {
      success: channelManager.update(params!.id, { enabled: data.enabled }),
    };
  },
  "POST /api/channels/:id/test": async (_body, params) => {
    const channel = channelManager.get(params!.id);
    if (!channel) {
      throw new Error("Channel not found");
    }

    const adapter = channelManager.getAdapter(channel.type as keyof typeof channels);
    if (!adapter) {
      return {
        success: false,
        error: `No adapter registered for channel type: ${channel.type}`,
      };
    }

    const config = parseJsonObject(channel.config) || {};

    const channelDef = channels[channel.type as keyof typeof channels];
    const missingRequired = channelDef.fields
      .filter((f) => f.required)
      .map((f) => f.name)
      .filter((key) => {
        const value = (config as Record<string, unknown>)[key];
        return (
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim().length === 0)
        );
      });

    if (missingRequired.length > 0) {
      return {
        success: false,
        error: `Missing required config fields: ${missingRequired.join(", ")}`,
        running: adapter.isRunning(channel.id),
      };
    }

    if (!adapter.isRunning(channel.id) && channel.enabled) {
      try {
        await adapter.start(channel.id, config as Record<string, unknown>);
      } catch (error) {
        return {
          success: false,
          error: formatChannelTestError(channel.type, error),
          running: adapter.isRunning(channel.id),
          type: channel.type,
          enabled: channel.enabled,
        };
      }
    }

    const running = adapter.isRunning(channel.id);

    if (!channel.enabled && !running) {
      return {
        success: false,
        running,
        type: channel.type,
        enabled: channel.enabled,
        message: "Channel is disabled. Enable it to run a live connection test.",
      };
    }

    if (channel.type === "whatsapp") {
      const whatsappState = whatsappAdapter.getState(channel.id);
      if (whatsappState.ready) {
        return {
          success: true,
          running: true,
          type: channel.type,
          enabled: channel.enabled,
          whatsapp: whatsappState,
          message:
            "WhatsApp client is connected and ready. Send from another contact, or enable 'Allow Self Messages' in channel config for self-chat testing.",
        };
      }

      if (whatsappState.awaitingQr) {
        return {
          success: false,
          running: whatsappState.running,
          type: channel.type,
          enabled: channel.enabled,
          whatsapp: whatsappState,
          message:
            "WhatsApp is waiting for QR scan. Open the channel QR view in UI and scan with your phone.",
        };
      }

      return {
        success: false,
        running: whatsappState.running,
        type: channel.type,
        enabled: channel.enabled,
        whatsapp: whatsappState,
        message:
          whatsappState.lastError ||
          "WhatsApp client is starting. If this persists, click Test again or restart the channel.",
      };
    }

    return {
      success: running,
      running,
      type: channel.type,
      enabled: channel.enabled,
      ...(channel.type === "discord" && running
        ? {
            message:
              "Discord connection looks good. Invite the bot to your server before expecting messages in guild channels.",
          }
        : {}),
    };
  },
  "GET /api/channels/:id/whatsapp/state": (_body, params) => {
    const channel = channelManager.get(params!.id);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (channel.type !== "whatsapp") {
      throw new Error("Channel is not a WhatsApp channel");
    }
    const state = whatsappAdapter.getState(channel.id);
    return {
      success: true,
      channelId: channel.id,
      enabled: !!channel.enabled,
      ...state,
    };
  },
  "DELETE /api/channels/:id": (_body, params) => ({
    success: channelManager.delete(params!.id),
  }),

  "GET /api/channels/:id/pairings": (_body, params) => {
    const channelId = params!.id;
    const rawPairings = securityManager.getAllPairings(channelId);
    const pairings = rawPairings.map(
      (p: {
        id: string;
        sender_id: string;
        code: string;
        platform: string;
        sender_name?: string;
        status: string;
        created_at: number;
        expires_at: number;
      }) => ({
        id: p.id,
        senderId: p.sender_id,
        code: p.code,
        platform: p.platform,
        displayName: p.sender_name,
        status: p.status,
        createdAt: new Date(p.created_at).toISOString(),
        expiresAt: new Date(p.expires_at).toISOString(),
      })
    );
    return {
      pairings,
      pendingCount: securityManager.getPendingPairings(channelId).length,
      config: securityManager.getConfig(channelId),
    };
  },
  "POST /api/channels/:id/pairings/verify": (body, params) => {
    const channelId = params!.id;
    const { code } = body as { code: string };
    return securityManager.verifyPairing(channelId, code);
  },
  "POST /api/channels/:id/pairings/:pairingId/reject": (_body, params) => {
    const { id, pairingId } = params!;
    return { success: securityManager.rejectPairing(id, pairingId) };
  },
  "GET /api/channels/:id/allowed-senders": (_body, params) => {
    return { senders: securityManager.getAllowedSenders(params!.id) };
  },
  "POST /api/channels/:id/allowed-senders": (body, params) => {
    const { senderId } = body as { senderId: string };
    securityManager.addAllowedSender(params!.id, senderId);
    return { success: true };
  },
  "DELETE /api/channels/:id/allowed-senders/:senderId": (_body, params) => {
    return {
      success: securityManager.removeAllowedSender(params!.id, params!.senderId),
    };
  },
  "PUT /api/channels/:id/security": (body, params) => {
    const channelId = params!.id;
    const config = body as {
      dm_policy?: string;
      group_policy?: string;
      group_owner_sender_id?: string;
      pairing_expiry_minutes?: number;
      max_pending_pairings?: number;
    };
    securityManager.setConfig(channelId, config as Parameters<typeof securityManager.setConfig>[1]);
    return { success: true, config: securityManager.getConfig(channelId) };
  },

  "GET /api/tasks": () => taskScheduler.list(),
  "GET /api/tasks/:id": (_body, params) => {
    const task = taskScheduler.get(params!.id);
    return task || { error: "Task not found" };
  },
  "POST /api/tasks": (body) =>
    taskScheduler.create(body as Parameters<typeof taskScheduler.create>[0]),
  "PUT /api/tasks/:id": (body, params) => {
    const task = taskScheduler.update(
      params!.id,
      body as Parameters<typeof taskScheduler.update>[1]
    );
    return task || { error: "Task not found" };
  },
  "POST /api/tasks/:id/start": async (_body, params) => ({
    success: await taskScheduler.start(params!.id),
  }),
  "POST /api/tasks/:id/stop": async (_body, params) => ({
    success: await taskScheduler.stop(params!.id),
  }),
  "POST /api/tasks/:id/trigger": async (_body, params) => ({
    success: await taskScheduler.trigger(params!.id),
  }),
  "POST /api/tasks/:id/run": async (_body, params) => ({
    success: await taskScheduler.trigger(params!.id),
  }),
  "GET /api/tasks/:id/runs": (_body, params) => tables.taskRuns.getByTask(params!.id),
  "DELETE /api/tasks/:id": (_body, params) => ({
    success: taskScheduler.delete(params!.id),
  }),

  "POST /api/webhooks/telegram/:channelId": async (body, params, ctx) => {
    const { channelId } = params!;
    const headers = ctx?.headers ?? {};
    const secretToken =
      headers["x-telegram-bot-api-secret-token"] || headers["X-Telegram-Bot-Api-Secret-Token"];
    const success = await processTelegramWebhook(
      channelId,
      body as Record<string, unknown>,
      secretToken
    );
    return { ok: success };
  },

  "POST /api/channels/:channelId/webhook": async (body, params, ctx) => {
    return dispatchChannelWebhook(body, params, ctx);
  },
  "GET /api/channels/:channelId/webhook": async (body, params, ctx) => {
    return dispatchChannelWebhook(body, params, ctx);
  },

  "GET /api/computer-use/status": async () => {
    const { computerUseDoctor } = await import("../core/computer-use");
    return await computerUseDoctor();
  },

  "POST /api/computer-use/permissions/grant": async () => {
    const { requestComputerUsePermissionsGrant } = await import("../core/computer-use");
    return await requestComputerUsePermissionsGrant();
  },

  "POST /api/chat": async (body) => {
    const data = body as {
      message: string;
      agentId?: string;
      sessionId?: string;
      model?: string;
      modelOverride?: string;
      clientPendingId?: string;
      workspaceDir?: string;
      stream?: boolean;
      tools?: boolean;
      images?: Array<{ data?: string; url?: string; mimeType?: string }>;
      queueMode?: "queue" | "steer";
      useModelRouter?: boolean;
    };
    const modelOverride =
      typeof data.modelOverride === "string" && data.modelOverride.trim()
        ? data.modelOverride.trim()
        : typeof data.model === "string" && data.model.trim()
          ? data.model.trim()
          : undefined;
    return await handleChat({ ...data, modelOverride });
  },
  "GET /api/chat/capabilities": async (_body, params) => ({
    capabilities: [
      ...(await listChatCapabilities(normalizeOptionalString(params?.workspaceDir))),
      ...listChatCommands(),
    ],
  }),
  "POST /api/speech/dictate": async (body) => {
    const data = body as {
      audioBase64?: string;
      mimeType?: string;
      fileName?: string;
      model?: string;
      providerId?: string;
      provider?: string;
    };

    if (!data.audioBase64 || typeof data.audioBase64 !== "string") {
      throw new Error("Validation error: audioBase64 is required");
    }

    const fallbackMimeType =
      typeof data.mimeType === "string" && data.mimeType.trim()
        ? data.mimeType.trim()
        : "audio/webm";
    const decoded = decodeDictationAudioBase64(data.audioBase64, fallbackMimeType);
    const speechSettings = config.getSpeechSettings();
    const requestedProviderId =
      typeof data.providerId === "string" && data.providerId.trim()
        ? data.providerId.trim()
        : undefined;
    const requestedProvider =
      typeof data.provider === "string" && data.provider.trim()
        ? data.provider.trim().toLowerCase()
        : speechSettings.stt.provider;
    if (requestedProvider === "local") {
      let pcmBytes: Uint8Array;
      try {
        pcmBytes = normalizeLocalTranscriptionAudio(decoded);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Recording could not be decoded";
        throw new Error(`Validation error: ${message}`);
      }
      const result = await transcribeLocalSpeech({
        pcmBytes,
        model:
          typeof data.model === "string" && data.model.trim()
            ? data.model.trim()
            : speechSettings.stt.provider === "local"
              ? speechSettings.stt.model || undefined
              : undefined,
        language: speechSettings.stt.language || undefined,
      });
      return {
        success: true,
        text: result.text,
        providerId: "local",
        providerType: "local",
        model: result.model,
      };
    }
    const provider = pickDictationProvider(
      requestedProviderId ||
        (speechSettings.stt.providerId ? speechSettings.stt.providerId : undefined)
    );
    const result = await transcribeWithOpenAICompatibleProvider({
      provider,
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      fileName:
        typeof data.fileName === "string" && data.fileName.trim()
          ? data.fileName.trim()
          : "dictation.webm",
      model:
        typeof data.model === "string" && data.model.trim()
          ? data.model.trim()
          : speechSettings.stt.model || undefined,
    });

    return {
      success: true,
      text: result.text,
      providerId: provider.id,
      providerType: provider.provider,
      model: result.model,
    };
  },
  "POST /api/speech/synthesize": async (body) => {
    const data = body as {
      text?: string;
      providerId?: string;
      model?: string;
      voice?: string;
      format?: string;
      speed?: number;
    };
    const result = await synthesizeSpeech({
      text: typeof data.text === "string" ? data.text : "",
      providerId: typeof data.providerId === "string" ? data.providerId : undefined,
      model: typeof data.model === "string" ? data.model : undefined,
      voice: typeof data.voice === "string" ? data.voice : undefined,
      format: typeof data.format === "string" ? data.format : undefined,
      speed: typeof data.speed === "number" ? data.speed : undefined,
    });
    return { success: true, ...result };
  },
  "GET /api/sessions/search": (_body, params) =>
    searchSessionMessages(typeof params?.q === "string" ? params.q : "", {
      limit: parseBoundedQueryNumber(params?.limit, 1, 100) ?? 20,
      offset: parseBoundedQueryNumber(params?.offset, 0, 10000) ?? 0,
      sessionId:
        typeof params?.sessionId === "string" && params.sessionId ? params.sessionId : undefined,
      role: typeof params?.role === "string" && params.role ? params.role : undefined,
    }),
  "GET /api/chat/sessions": (_body, params) =>
    listSessions({
      limit: parseBoundedQueryNumber(params?.limit, 1, 500) ?? 150,
      offset: parseBoundedQueryNumber(params?.offset, 0, 100000) ?? 0,
    }),
  "GET /api/chat/sessions/:id": async (_body, params) => {
    const session = await getSession(params!.id);
    if (!session) return session;
    const sessionObj = session as Record<string, unknown>;
    const messages = await getSessionMessages(params!.id);
    return {
      ...session,
      plan: extractLatestSessionPlan(params!.id, messages),
      messages: sanitizeSessionMessages(messages),
      messagesList: Array.isArray(sessionObj.messagesList)
        ? sanitizeSessionMessages(sessionObj.messagesList as SessionMessageView[])
        : undefined,
    };
  },
  "GET /api/chat/sessions/:id/messages": async (_body, params) => {
    const messages = await getSessionMessages(params!.id);
    return sanitizeSessionMessages(messages);
  },
  "GET /api/chat/sessions/:id/pending": (_body, params) => ({
    sessionId: params!.id,
    pendingMessages: listPendingChatMessages(params!.id),
  }),
  "POST /api/chat/sessions/:id/pending/reorder": (body, params) => {
    const data = body as { pendingMessageIds?: string[] };
    return reorderPendingChatMessages(
      params!.id,
      Array.isArray(data.pendingMessageIds) ? data.pendingMessageIds : []
    );
  },
  "PATCH /api/chat/sessions/:id/pending/:pendingId": (body, params) => {
    const data = body as { content?: string };
    return updatePendingChatMessage(params!.id, params!.pendingId, data.content || "");
  },
  "DELETE /api/chat/sessions/:id/pending/:pendingId": (_body, params) =>
    deletePendingChatMessage(params!.id, params!.pendingId),
  "POST /api/chat/sessions/:id/pending/:pendingId/steer": async (body, params) => {
    const data = body as { processActivities?: unknown };
    return await steerPendingChatMessage(params!.id, params!.pendingId, {
      processActivities: data.processActivities,
    });
  },
  "POST /api/chat/sessions/:id/stop": async (_body, params) => stopActiveChatTurn(params!.id),
  "DELETE /api/chat/sessions/:id": async (_body, params) => ({
    success: await deleteSession(params!.id),
  }),

  "GET /api/memory": async () => {
    return await handleMemoryList();
  },
  "POST /api/memory": async (body) => {
    const data = body as { file?: string; content?: string };
    return await handleMemoryCreate(data.file || "", data.content || "");
  },
  "GET /api/memory/search": async (_body, params) => {
    return await handleMemorySearch(params!.query || "");
  },
  "GET /api/memory/status": async () => {
    try {
      const vectorStore = getVectorStore();
      const indexerSettings = config.getWorkspaceIndexerSettings();
      await vectorStore.configureEmbeddings({
        provider: indexerSettings.embeddingProvider,
        model: indexerSettings.embeddingModel,
      });
      return {
        success: true,
        ...vectorStore.stats(),
        configuredProvider: indexerSettings.embeddingProvider,
        configuredModel: indexerSettings.embeddingModel,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "unavailable",
      };
    }
  },
  "GET /api/memory/providers": () => {
    const settings = config.getMemoryProviderSettings();
    return {
      success: true,
      settings: redactMemoryProviderSettings(settings),
      providers: getMemoryProviderCatalog(settings),
    };
  },
  "POST /api/memory/providers/test": async (body) => {
    const data = (body || {}) as { provider?: string; settings?: unknown };
    const stored = config.getMemoryProviderSettings();
    const settings =
      data.settings !== undefined
        ? mergeMemoryProviderSettingsUpdate(stored, data.settings)
        : stored;
    const provider = normalizeMemoryProviderId(data.provider ?? settings.provider);
    const health = await testMemoryProvider(provider, settings);
    return { success: health.ok, provider, ...health };
  },
  "DELETE /api/memory/:file": async (body, params) => {
    const data = (body || {}) as { index?: number };
    return await handleMemoryDelete(params!.file, data.index);
  },
  "PUT /api/memory/:file": async (body, params) => {
    const data = body as { index: number; content: string };
    return await handleMemoryEdit(params!.file, data.index, data.content);
  },

  "POST /api/skills": (body) => {
    const data = body as {
      name?: string;
      description?: string;
      content?: string;
      category?: string;
      slug?: string;
    };

    if (!data.name) throw new Error("Validation error: Skill name is required");
    if (!data.content) throw new Error("Validation error: Skill content is required");

    const result = createLocalSkill({
      name: data.name,
      description: data.description,
      content: data.content,
      category: data.category,
      slug: data.slug,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to create skill");
    }

    const createdSkill = getSkill(result.slug || data.name);
    return (
      createdSkill || {
        id: result.slug || data.name,
        name: data.name,
        description: data.description || "",
        category: data.category || "custom",
        location: result.path,
      }
    );
  },
  "GET /api/skills": () => getSkills(),
  "GET /api/journey": () => buildJourney(),
  "GET /api/skills/categories": () => getSkillCategories(),
  "GET /api/skills/status": async () => {
    const homeDir = config.getDefaultWorkspaceDir();
    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const statuses = getSkillsStatusReport(allSkills, context);
    return {
      skills: statuses.map((s) => ({
        name: s.skill.name,
        description: s.skill.description,
        location: s.skill.location,
        source: s.source,
        eligible: s.eligible,
        disabled: s.disabled,
        blockedByAllowlist: s.blockedByAllowlist,
        requirements: s.requirements,
        missing: s.missing,
        install: s.install.map(formatSkillInstallSpec),
        metadata: s.metadata,
      })),
      summary: {
        total: statuses.length,
        eligible: statuses.filter((s) => s.eligible).length,
        disabled: statuses.filter((s) => s.disabled).length,
        blocked: statuses.filter((s) => !s.eligible && !s.disabled).length,
      },
    };
  },
  "GET /api/skills/registry/search": async (_body, params) => {
    const registries = registryManager.list().map((r) => r.name);
    const query = typeof params?.q === "string" ? params.q.trim() : "";
    const registry = typeof params?.registry === "string" ? params.registry : undefined;
    const dedupe = params?.dedupe !== "false";
    const limitRaw = Number.parseInt(String(params?.limit ?? ""), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : undefined;

    if (!query) {
      return { skills: [], registries, counts: {} };
    }

    const results = await registryManager.searchAll(query, {
      registry,
      dedupe,
      limit,
    });
    const counts = results.reduce<Record<string, number>>((acc, skill) => {
      acc[skill.registry] = (acc[skill.registry] ?? 0) + 1;
      return acc;
    }, {});

    return { skills: results, registries, counts };
  },
  "GET /api/skills/registry/browse": async (_body, params) => {
    const registries = registryManager.list().map((r) => r.name);
    const registry = typeof params?.registry === "string" ? params.registry : undefined;
    const dedupe = params?.dedupe !== "false";
    const limitRaw = Number.parseInt(String(params?.limit ?? ""), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : undefined;
    const maxPagesRaw = Number.parseInt(String(params?.maxPages ?? ""), 10);
    const maxPages = Number.isFinite(maxPagesRaw)
      ? Math.max(1, Math.min(3, maxPagesRaw))
      : undefined;
    const sortParam = typeof params?.sort === "string" ? params.sort : undefined;
    const validSorts = [
      "updated",
      "downloads",
      "stars",
      "rating",
      "installsCurrent",
      "installs",
      "installsAllTime",
      "trending",
    ] as const;
    const sort =
      sortParam && (validSorts as readonly string[]).includes(sortParam)
        ? (sortParam as (typeof validSorts)[number])
        : "downloads";

    const results = await registryManager.browseAll({
      registry,
      dedupe,
      limit,
      maxPages,
      sort,
    });
    const counts = results.reduce<Record<string, number>>((acc, skill) => {
      acc[skill.registry] = (acc[skill.registry] ?? 0) + 1;
      return acc;
    }, {});

    return { skills: results, registries, counts };
  },
  "POST /api/skills/install": async (body) => {
    const { slug, registry, allowSuspicious } = body as {
      slug: string;
      registry?: string;
      allowSuspicious?: boolean;
    };
    if (!slug) throw new Error("Skill slug is required");
    const result = await registryManager.install(slug, {
      registry,
      allowSuspicious,
    });
    if (result.success) {
      clearSkillsCache(); // Invalidate cache so new skill appears in list
    }
    return result;
  },
  "DELETE /api/skills/:name": async (_body, params) => {
    const skillName = decodeURIComponent(params!.name);
    const skill = getSkill(skillName);

    let targetDir: string | undefined = undefined;
    if (skill?.location?.includes(".cybara/skills")) {
      targetDir = skill.location.endsWith("SKILL.md") ? dirname(skill.location) : skill.location;
    }

    const result = await registryManager.uninstall(skillName, { targetDir });
    if (result.success) {
      clearSkillsCache(); // Invalidate cache so deleted skill disappears from list
    }
    return result;
  },
  "POST /api/skills/update": async () => {
    const results = await registryManager.updateAll();
    return { updates: results };
  },
  "GET /api/skills/:name": (_body, params) => {
    const skill = getSkill(params!.name);
    return skill || { error: "Skill not found" };
  },
  "POST /api/skills/:name/execute": async (body, params) => {
    const args = body as Record<string, unknown>;
    return await executeSkill(params!.name, args);
  },
  "GET /api/plugins": () => {
    return {
      plugins: listInstalledPlugins().map(pluginSummary),
    };
  },
  "GET /api/plugins/catalog": () => {
    const installed = new Map(
      listInstalledPlugins().map((plugin) => [plugin.manifest.id, plugin] as const)
    );
    return {
      plugins: getBuiltinPluginCatalog().map((entry) => {
        const plugin = installed.get(entry.id);
        return {
          ...entry,
          installed: !!plugin,
          enabled: plugin?.enabled ?? entry.enabledByDefault,
        };
      }),
    };
  },
  "GET /api/plugins/contributions": () => ({
    commands: listPluginCommands(),
    providers: listPluginProviderContributions(),
    channels: listPluginChannelContributions(),
  }),
  "GET /api/plugins/marketplace": async (_body, params) => {
    const query = typeof params?.q === "string" ? params.q : undefined;
    const filter =
      params?.filter === "installed" || params?.filter === "available" ? params.filter : "all";
    const rawPage = Number.parseInt(String(params?.page ?? ""), 10);
    const rawPageSize = Number.parseInt(String(params?.page_size ?? params?.limit ?? ""), 10);
    const page = Number.isFinite(rawPage) ? rawPage : undefined;
    const pageSize = Number.isFinite(rawPageSize) ? rawPageSize : undefined;
    return await discoverMarketplacePlugins({ query, filter, page, pageSize });
  },
  "POST /api/plugins/marketplace/install": async (body) => {
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    if (typeof record.id !== "string") {
      throw new Error("Marketplace plugin id is required");
    }
    const result = await installMarketplacePlugin({
      id: record.id,
      marketplace: typeof record.marketplace === "string" ? record.marketplace : undefined,
    });
    if (result.success) {
      activateInstalledPluginRuntimes(listInstalledPlugins());
      clearSkillsCache();
    }
    return result;
  },
  "GET /api/plugins/validate": (_body, params) => {
    const targetPath = typeof params?.path === "string" ? params.path.trim() : "";
    if (!targetPath) {
      throw new Error("Plugin path is required");
    }
    return validatePluginAtPath(targetPath);
  },
  "POST /api/plugins/validate": async (body) => {
    return await validatePluginInstallPayload(parsePluginInstallPayload(body));
  },
  "POST /api/plugins/install": async (body) => {
    const plugin = await installPluginFromPayload(parsePluginInstallPayload(body));
    try {
      activatePluginRuntime(plugin);
    } catch (error) {
      uninstallLocalPlugin(plugin.manifest.id);
      throw error;
    }
    clearSkillsCache();
    return {
      success: true,
      plugin: pluginSummary(plugin),
    };
  },
  "PUT /api/plugins/:id": (body, params) => {
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    if (typeof record.enabled !== "boolean") {
      throw new Error("Plugin enabled state must be a boolean");
    }
    const previous = listInstalledPlugins().find((plugin) => plugin.manifest.id === params!.id);
    const plugin = setPluginEnabled(params!.id, record.enabled);
    try {
      activatePluginRuntime(plugin);
    } catch (error) {
      if (previous) {
        const restored = setPluginEnabled(previous.manifest.id, previous.enabled);
        activatePluginRuntime(restored);
      }
      throw error;
    }
    clearSkillsCache();
    return { success: true, plugin: pluginSummary(plugin) };
  },
  "DELETE /api/plugins/:id": (_body, params) => {
    deactivatePluginRuntime(params!.id);
    const removed = uninstallLocalPlugin(params!.id);
    clearSkillsCache();
    return { success: removed };
  },

  "GET /api/logs/system": async (_body, params) => {
    const limit = parseBoundedQueryNumber(params?.limit, 1, 1000);
    const offset = parseBoundedQueryNumber(params?.offset, 0, 100000) ?? 0;
    const includeTotal =
      params?.includeTotal === "1" ||
      params?.includeTotal === "true" ||
      params?.includeTotal === "yes";
    if (includeTotal) {
      return getCombinedLogsPage({ limit: limit ?? 150, offset });
    }
    return getCombinedLogs({ limit, offset });
  },
  "GET /api/logs/search": async (_body, params) => {
    return await searchAllLogs(params!.q || "", parseInt(params!.limit || "100"));
  },
  "GET /api/logs/activity": async (_body, params) => {
    return await getRecentActivity(parseInt(params!.minutes || "60"));
  },
  "GET /api/logs/sessions/:sessionId/messages": async (_body, params) => {
    const getSessionMessages = getLogSessionMessages;
    return await getSessionMessages(params!.sessionId);
  },
  "GET /api/logs/agents/:agentId": async (_body, params) => {
    return await getAgentLogs(params!.agentId);
  },
  "GET /api/logs/stats": async (_body, params) => {
    const hours = parseInt(params!.hours || "24");
    return getLogStats(hours);
  },

  "GET /api/sessions": async (_body, params) => {
    const parseQueryNumber = (raw: string | undefined): number | undefined => {
      if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const limit = parseQueryNumber(params?.limit);
    const offset = parseQueryNumber(params?.offset);
    const pageOptions = {
      limit: typeof limit === "number" ? Math.min(500, Math.max(1, limit)) : undefined,
      offset: typeof offset === "number" ? Math.max(0, offset) : undefined,
    };
    const includeTotal =
      params?.includeTotal === "1" ||
      params?.includeTotal === "true" ||
      params?.includeTotal === "yes";
    const toApiSession = (session: Awaited<ReturnType<typeof listSessions>>[number]) => {
      const updatedAt = session.updatedAt || session.createdAt;
      const lastMessage = session.lastMessage;
      const modelMetadata = sessionModelMetadata(
        session.agentId,
        sessionModelMetadataSnapshot(
          (session as { modelMetadata?: SessionModelMetadata | null }).modelMetadata
        )
      );
      return {
        id: session.id,
        agent_id: session.agentId,
        ...modelMetadata,
        title: typeof session.title === "string" && session.title.trim() ? session.title : null,
        created_at: normalizeTimestamp(session.createdAt),
        updated_at: normalizeTimestamp(updatedAt),
        workspace_dir:
          "workspaceDir" in session && typeof session.workspaceDir === "string"
            ? session.workspaceDir
            : null,
        pinned: session.pinned === true,
        message_count: session.messageCount,
        last_message: lastMessage
          ? {
              role: lastMessage.role,
              content:
                lastMessage.content.slice(0, 100) + (lastMessage.content.length > 100 ? "..." : ""),
            }
          : null,
      };
    };

    if (includeTotal) {
      const page = await listSessionPage(pageOptions);
      return {
        sessions: page.sessions.map(toApiSession),
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        has_more: page.hasMore,
        hasMore: page.hasMore,
      };
    }

    return (await listSessions(pageOptions)).map(toApiSession);
  },
  "GET /api/sessions/:sessionId": async (_body, params) => {
    const session = await getSession(params!.sessionId);
    if (!session) return { error: "Session not found" };
    const messages = await getSessionMessages(params!.sessionId);
    const includeFullToolCalls =
      params?.includeFullToolCalls === "1" ||
      params?.includeFullToolCalls === "true" ||
      params?.includeFullToolCalls === "yes";
    const sanitizedMessages = sanitizeSessionMessages(messages, {
      maxToolCalls: includeFullToolCalls ? 0 : 50,
      includeFullToolCalls,
    }).map((m) => ({
      ...m,
      timestamp: normalizeTimestamp(m.timestamp),
    }));

    const detailModelMetadata = sessionModelMetadata(
      session.agentId,
      sessionModelMetadataSnapshot(
        (session as { modelMetadata?: SessionModelMetadata | null }).modelMetadata
      ) || latestSessionModelMetadata(sanitizedMessages)
    );

    return {
      id: session.id,
      agent_id: session.agentId,
      ...detailModelMetadata,
      title:
        "title" in session && typeof session.title === "string" && session.title.trim()
          ? session.title
          : null,
      created_at: normalizeTimestamp(session.createdAt),
      updated_at: normalizeTimestamp(
        "updatedAt" in session && typeof session.updatedAt === "string" && session.updatedAt.trim()
          ? session.updatedAt
          : messages[messages.length - 1]?.timestamp || session.createdAt
      ),
      pinned: ("pinned" in session && session.pinned === true) || getSessionPinned(session.id),
      workspace_dir:
        "workspaceDir" in session && typeof session.workspaceDir === "string"
          ? session.workspaceDir
          : null,
      contextUsage: estimateSessionContextUsage(session.messages || [], detailModelMetadata.model, {
        sessionId: session.id,
        compactionCount:
          "compactionCount" in session && typeof session.compactionCount === "number"
            ? session.compactionCount
            : 0,
      }),
      tokenUsage: summarizeSessionTokenUsage(session.id),
      plan: extractLatestSessionPlan(session.id, messages),
      messagesList: sanitizedMessages,
    };
  },
  "GET /api/sessions/:sessionId/plan": async (_body, params) => {
    const sessionId = params!.sessionId;
    const session = await getSession(sessionId);
    if (!session) return { error: "Session not found" };
    const messages = await getSessionMessages(sessionId);
    return {
      sessionId,
      plan: extractLatestSessionPlan(sessionId, messages),
    };
  },
  "GET /api/sessions/:sessionId/trajectories": (_body, params) => {
    requireLabEnabled();
    return {
      sessionId: params!.sessionId,
      trajectories: listSessionTrajectories(params!.sessionId),
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
    const trajectory = await ensureSessionTrajectory(params!.sessionId, data.messageIndex);
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
  "POST /api/sessions/:sessionId/fork": async (body, params) => {
    const data = (body || {}) as {
      throughMessageIndex?: number;
      agentId?: string;
      title?: string;
    };
    return {
      success: true,
      fork: await forkSession({
        sourceSessionId: params!.sessionId,
        throughMessageIndex: data.throughMessageIndex,
        agentId: data.agentId,
        title: data.title,
      }),
    };
  },
  "PUT /api/sessions/:sessionId/agent": async (body, params) => {
    const data = (body || {}) as { agentId?: string; agent_id?: string };
    const agentId =
      typeof data.agentId === "string" && data.agentId.trim()
        ? data.agentId.trim()
        : typeof data.agent_id === "string" && data.agent_id.trim()
          ? data.agent_id.trim()
          : "";
    try {
      return await updateSessionAgent(params!.sessionId, agentId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update session agent",
      };
    }
  },
  "PUT /api/sessions/:sessionId/title": async (body, params) => {
    const data = (body || {}) as { title?: string };
    try {
      const updated = await updateSessionTitle(
        params!.sessionId,
        typeof data.title === "string" ? data.title : ""
      );
      return {
        success: true,
        ...updated,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update session title",
      };
    }
  },
  "PUT /api/sessions/:sessionId/pin": async (body, params) => {
    const data = (body || {}) as { pinned?: boolean };
    try {
      const result = await setSessionPinned(params!.sessionId, data.pinned === true);
      if (!result.found) {
        return { success: false, error: "Session not found" };
      }
      return {
        success: true,
        sessionId: params!.sessionId,
        pinned: result.pinned,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update session pin",
      };
    }
  },
  "PUT /api/sessions/:sessionId/workspace": async (body, params) => {
    const data = (body || {}) as { workspaceDir?: string | null };
    try {
      const updated = await updateSessionWorkspace(
        params!.sessionId,
        typeof data.workspaceDir === "string" ? data.workspaceDir : null
      );
      return {
        success: true,
        ...updated,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update session workspace",
      };
    }
  },
  "GET /api/sessions/:sessionId/artifacts": (_body, params) => {
    const sessionId = params!.sessionId;
    return {
      sessionId,
      artifacts: listArtifacts(sessionId),
    };
  },
  "GET /api/sessions/:sessionId/artifacts/:artifactName": (_body, params) => {
    const sessionId = params!.sessionId;
    const artifactName = params!.artifactName;
    const result = readArtifact({ sessionId, name: artifactName });
    return {
      sessionId,
      artifact: result.artifact,
      content: result.content,
      truncated: result.truncated,
      totalChars: result.totalChars,
    };
  },
  "DELETE /api/sessions/:sessionId/artifacts/:artifactName": (_body, params) => {
    const sessionId = params!.sessionId;
    const artifactName = params!.artifactName;
    const result = deleteArtifact({ sessionId, name: artifactName });
    return {
      success: true,
      ...result,
    };
  },
  "GET /api/artifacts": (_body, params) => {
    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId.trim().length > 0
        ? params.sessionId.trim()
        : null;
    if (sessionId) {
      return {
        sessionId,
        artifacts: listArtifacts(sessionId),
      };
    }
    return {
      artifacts: listAllArtifacts(),
    };
  },
  "POST /api/sessions/:sessionId/revert": async (body, params) => {
    const data = (body || {}) as {
      messageIndex?: number | string;
      messageRole?: string;
      messageContent?: string;
      messageTimestamp?: string;
    };
    const messageIndexRaw =
      typeof data.messageIndex === "number" ? data.messageIndex : Number(data.messageIndex);
    const messageIndex =
      Number.isInteger(messageIndexRaw) && messageIndexRaw >= 0 ? messageIndexRaw : undefined;
    const messageRole = typeof data.messageRole === "string" ? data.messageRole : undefined;
    const messageContent =
      typeof data.messageContent === "string" ? data.messageContent : undefined;
    const messageTimestamp =
      typeof data.messageTimestamp === "string" ? data.messageTimestamp : undefined;

    if (messageIndex === undefined && !messageContent?.trim() && !messageTimestamp?.trim()) {
      return {
        success: false,
        error:
          "Provide messageIndex or messageContent/messageTimestamp so the target message can be resolved",
      };
    }

    try {
      const reverted = await revertSessionToMessage(params!.sessionId, {
        messageIndex,
        messageRole: messageRole as ChatMessage["role"] | undefined,
        messageContent,
        messageTimestamp,
      });
      const sanitizedMessages = sanitizeSessionMessages(
        reverted.messages.filter((message) => message.role !== "system")
      ).map((m) => ({
        ...m,
        timestamp: normalizeTimestamp(m.timestamp),
      }));

      return {
        success: true,
        sessionId: reverted.sessionId,
        keptCount: reverted.keptCount,
        removedCount: reverted.removedCount,
        removedFromIndex: reverted.removedFromIndex,
        messagesList: sanitizedMessages,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to revert session",
      };
    }
  },
  "DELETE /api/sessions/:sessionId": async (_body, params) => {
    await deleteSession(params!.sessionId);
    return { success: true, message: "Session deleted" };
  },

  "POST /api/subagents/spawn": async (body) => {
    const data = body as {
      task: string;
      model?: string;
      timeout?: number;
      timeoutSeconds?: number;
      runTimeoutSeconds?: number;
      label?: string;
      agentId?: string;
      cleanup?: "keep" | "delete";
      workspaceDir?: string;
      maxActiveChildren?: number;
      requesterSessionId?: string;
    };
    if (!data.task) {
      return { error: "task is required", success: false };
    }

    const result = await handleSessionsSpawn({
      task: data.task,
      model: data.model,
      runTimeoutSeconds: data.runTimeoutSeconds,
      timeoutSeconds: data.timeoutSeconds ?? data.timeout,
      label: data.label,
      agentId: data.agentId,
      cleanup: data.cleanup,
      workspaceDir: data.workspaceDir,
      maxActiveChildren: data.maxActiveChildren,
      _requesterSessionKey:
        typeof data.requesterSessionId === "string" && data.requesterSessionId.trim()
          ? data.requesterSessionId.trim()
          : "main",
    });

    return {
      success: result.status === "accepted",
      subagentId: result.runId,
      sessionKey: result.childSessionKey,
      status: result.status,
      warning: result.warning,
      modelApplied: result.modelApplied,
    };
  },
  "GET /api/subagents": (_body, params) => {
    const requesterSessionId =
      typeof params?.sessionId === "string" && params.sessionId.trim()
        ? params.sessionId.trim()
        : undefined;
    const runs = requesterSessionId
      ? subagentRegistry.getRunsByRequester(requesterSessionId)
      : subagentRegistry.listAllRuns();
    return runs.map(serializeSubagentSummary);
  },
  "POST /api/subagents/wait": async (body) => {
    const data = body as {
      runIds?: unknown;
      timeoutSeconds?: unknown;
      requesterSessionId?: unknown;
    };
    try {
      return await handleSessionsWait(
        {
          runIds: data.runIds,
          timeoutSeconds: data.timeoutSeconds,
        },
        {
          agentId: "api",
          sessionId:
            typeof data.requesterSessionId === "string" && data.requesterSessionId.trim()
              ? data.requesterSessionId.trim()
              : undefined,
        }
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unable to wait for subagents",
      };
    }
  },
  "GET /api/subagents/:id": (_body, params) => {
    const run = subagentRegistry.getRun(params!.id);
    if (!run) return { error: "Subagent not found" };
    return serializeSubagentDetail(run);
  },
  "POST /api/subagents/:id/kill": (_body, params) => {
    const killed = killSubagentSession(params!.id);
    return {
      success: killed,
      message: killed ? "Subagent killed" : "Subagent not found or inactive",
    };
  },
  "DELETE /api/subagents/:id": (_body, params) => {
    const run = subagentRegistry.getRun(params!.id);
    const result = subagentRegistry.clearSubagentRun(params!.id);
    if (result === "active")
      return { success: false, error: "Stop the subagent before clearing it" };
    if (result === "missing") return { success: false, error: "Subagent not found" };
    if (run) clearSubagentSession(run.childSessionKey);
    return { success: true };
  },
  "DELETE /api/subagents": (_body, params) => {
    const requesterSessionId =
      typeof params?.sessionId === "string" && params.sessionId.trim()
        ? params.sessionId.trim()
        : "";
    if (!requesterSessionId) {
      return { success: false, error: "sessionId is required" };
    }
    const completedRuns = subagentRegistry
      .getRunsByRequester(requesterSessionId)
      .filter((run) => !!run.endedAt);
    const cleared = subagentRegistry.clearSubagentRunsForRequester(requesterSessionId);
    completedRuns.forEach((run) => clearSubagentSession(run.childSessionKey));
    return { success: true, cleared };
  },
  "GET /api/loops": () => ({
    runs: listAgentLoopRuns(),
  }),
  "GET /api/loops/:id": (_body, params) => {
    const run = getAgentLoopRun(params!.id);
    if (!run) return { success: false, error: "Loop run not found" };
    return { success: true, run };
  },
  "POST /api/loops/:id/cancel": (_body, params) => {
    const cancelled = cancelAgentLoopRun(params!.id);
    if (!cancelled) return { success: false, error: "Loop run not found" };
    return { success: true };
  },

  "GET /api/system-prompt": () => {
    const config = tables.config.get("systemPrompt");
    return normalizeSystemPromptConfig(config?.value);
  },
  "PUT /api/system-prompt": (body) => {
    const data = body as Record<string, unknown>;
    tables.config.set("systemPrompt", JSON.stringify(data));
    return { success: true, message: "System prompt configuration saved" };
  },
  "GET /api/system-prompt/preview": async () => {
    const homeDir = config.getDefaultWorkspaceDir();
    const agents = agentManager.list();
    const candidates = agents.filter((a) => a.type !== "subagent" && a.type !== "worker");
    const isAutostart = (a: (typeof candidates)[number]): boolean => {
      try {
        const cfg = typeof a.config === "string" ? JSON.parse(a.config) : a.config;
        return Boolean((cfg as { autostart?: boolean } | null)?.autostart);
      } catch {
        return false;
      }
    };
    const agent =
      candidates.find((a) => (a as { status?: string }).status === "running") ||
      candidates.find(isAutostart) ||
      candidates[0] ||
      agents[0];
    let rawTools: unknown = agent?.tools;
    if (typeof rawTools === "string") {
      try {
        rawTools = JSON.parse(rawTools);
      } catch {
        rawTools = [];
      }
    }
    const tools = (Array.isArray(rawTools) ? rawTools : [])
      .map((t) => (typeof t === "string" ? t : (t as { name?: string })?.name))
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    const preview = buildSystemPrompt({
      modelDisplay: agent?.model || "unknown",
      tools: tools.length
        ? tools
        : ["read", "write", "exec", "browser", "memory_search", "message"],
      workspaceDir: homeDir,
      agentData: agent ? { name: agent.name } : undefined,
    });
    return { preview };
  },
  "GET /api/identity": () => {
    const config = tables.config.get("identity");
    return normalizeIdentityConfig(config?.value);
  },
  "PUT /api/identity": (body) => {
    const data = body as Record<string, unknown>;
    tables.config.set("identity", JSON.stringify(data));
    return { success: true, message: "Identity configuration saved" };
  },
};

cacheMetricsRoutes(routes);
prewarmMetricsRoutes(routes);
const routeMatcher = createRouteMatcher(Object.keys(routes));

function getCircuitBreakersStatus(): Record<string, { state: string; failureCount?: number }> {
  const breakers: Record<string, { state: string; failureCount?: number }> = {};

  const providers = providerManager.list();
  for (const provider of providers) {
    const state = getCircuitState(`llm:${provider.id}`);
    if (state) {
      breakers[`llm:${provider.id}`] = {
        state: state.state,
        failureCount: state.failureCount,
      };
    }
  }

  return breakers;
}

async function dispatchChannelWebhook(
  body: unknown,
  params: Record<string, string> | undefined,
  ctx?: { headers?: Record<string, string>; rawBody?: string }
): Promise<unknown> {
  const { channelId, ...query } = params || {};
  if (!channelId) return { status: 400, body: { error: "channelId required" } };
  const channel = channelManager.get(channelId);
  if (!channel) return { status: 404, body: { error: "channel not found" } };
  const adapter = channelManager.getAdapter(channel.type);
  if (!adapter?.handleWebhook) {
    return {
      status: 400,
      body: { error: `channel ${channel.type} does not accept webhooks` },
    };
  }
  const result = await adapter.handleWebhook(channelId, {
    body,
    rawBody: ctx?.rawBody ?? (body !== undefined ? JSON.stringify(body) : ""),
    headers: ctx?.headers ?? {},
    query: query as Record<string, string>,
  });
  if (result?.rawBody !== undefined) {
    return makeRawHttpResponse(
      result.rawBody,
      result.contentType || "text/plain",
      result.status || 200
    );
  }
  return result?.body !== undefined ? result.body : { ok: true };
}

export async function handleRequest(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  ip?: string;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  raw?: boolean;
}> {
  const startTime = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost:4269"}`);
  const method = req.method || "GET";
  const path = url.pathname;
  const requestOrigin = req.headers.origin || req.headers.Origin;
  const corsHeaders = buildCorsHeaders(requestOrigin);

  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: { ...corsHeaders, ...securityHeaders },
    };
  }

  const clientIp =
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    "127.0.0.1";

  const security = securityCheck(method, path, req.headers, clientIp);
  if (!security.passed) {
    const duration = Date.now() - startTime;
    log.warn(`Security check failed: ${security.error}`, {
      path,
      ip: clientIp,
    });
    recordApiMetrics(method, path, security.statusCode || 403, duration);
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: security.statusCode || 403,
      durationMs: duration,
      error: security.error,
    });
    return {
      status: security.statusCode || 403,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: { error: security.error },
    };
  }

  const { routeKey, params } = findRoute(method, path);

  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  if (!routeKey || !routes[routeKey]) {
    const duration = Date.now() - startTime;
    recordApiMetrics(method, path, 404, duration);
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 404,
      durationMs: duration,
    });
    return {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: { error: "Not found" },
    };
  }

  try {
    if (path.startsWith("/api/evals") && !config.getLabSettings().enabled) {
      if (!(method === "POST" && path === "/api/evals/benchmarks/cancel")) {
        throw new Error("Validation error: Lab is disabled in Settings");
      }
    }
    const result = await routes[routeKey](req.body, params, {
      clientIp,
      headers: req.headers,
      rawBody: req.rawBody,
      url: req.url,
      auth: security.auth,
    });
    const duration = Date.now() - startTime;

    if (isRawHttpResponse(result)) {
      recordApiMetrics(method, path, result.status, duration);
      logRequest({
        timestamp: new Date().toISOString(),
        method,
        path,
        status: result.status,
        durationMs: duration,
      });
      return {
        status: result.status,
        headers: {
          "Content-Type": result.contentType,
          ...corsHeaders,
          ...securityHeaders,
          ...security.headers,
        },
        body: result.body,
        raw: true,
      };
    }

    recordApiMetrics(method, path, 200, duration);
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 200,
      durationMs: duration,
    });
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: result,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = (error as Error).message;

    console.error(`[API Error] ${method} ${path}:`, error);

    let userMessage = "An unexpected error occurred";
    let errorCode = "INTERNAL_ERROR";
    let statusCode = 500;

    if (errorMessage.includes("No API credentials")) {
      userMessage = "API credentials not configured. Please add a provider with valid API keys.";
      errorCode = "MISSING_CREDENTIALS";
      statusCode = 400;
    } else if (errorMessage.includes("Rate limit")) {
      userMessage = "Rate limit exceeded. Please try again later.";
      errorCode = "RATE_LIMITED";
      statusCode = 429;
    } else if (errorMessage.includes("circuit breaker")) {
      userMessage = "Service temporarily unavailable. Please try again shortly.";
      errorCode = "SERVICE_UNAVAILABLE";
      statusCode = 503;
    } else if (errorMessage.includes("Agent is not running")) {
      userMessage = "Agent is not running. Start the agent and try again.";
      errorCode = "AGENT_NOT_RUNNING";
      statusCode = 409;
    } else if (errorMessage.includes("LLM API error")) {
      userMessage = `AI service error: ${errorMessage}`;
      errorCode = "LLM_ERROR";
      statusCode = 502;
    } else if (errorMessage.includes("not found")) {
      userMessage = errorMessage;
      errorCode = "NOT_FOUND";
      statusCode = 404;
    } else if (errorMessage.includes("already exists")) {
      userMessage = errorMessage;
      errorCode = "CONFLICT";
      statusCode = 409;
    } else if (
      errorMessage.includes("Validation") ||
      errorMessage.includes("required") ||
      errorMessage.startsWith("Refused:") ||
      errorMessage.startsWith("Invalid ")
    ) {
      userMessage = errorMessage;
      errorCode = "VALIDATION_ERROR";
      statusCode = 400;
    } else if (
      errorMessage.includes("Failed to launch browser") ||
      errorMessage.includes("Unable to launch a browser") ||
      errorMessage.includes("playwright chromium runtime is unavailable")
    ) {
      userMessage = errorMessage;
      errorCode = "BROWSER_UNAVAILABLE";
      statusCode = 503;
    } else {
      userMessage = "An error occurred while processing your request.";
    }

    // Intentional messages (validation, not-found, conflict) stay user-facing,
    // but redact any absolute filesystem paths they may carry so internals
    // never leak to clients outside development.
    if (process.env.NODE_ENV !== "development") {
      userMessage = userMessage.replace(
        /(?:[A-Za-z]:)?[\\/](?:Users|home|private|var|tmp|opt)[\\/][^\s"']*/g,
        "[path]"
      );
    }

    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: statusCode,
      durationMs: duration,
      error: errorMessage,
    });
    recordApiMetrics(method, path, statusCode, duration);
    return {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        ...securityHeaders,
        ...security.headers,
      },
      body: {
        error: userMessage,
        code: errorCode,
        message: process.env.NODE_ENV === "development" ? errorMessage : undefined,
        path,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

function findRoute(
  method: string,
  path: string
): { routeKey: string | null; params: Record<string, string> } {
  return routeMatcher.match(method, path);
}
