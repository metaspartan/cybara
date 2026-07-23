import { dirname } from "path";
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
import { forkSession } from "../core/agent-eval";
import { cancelAgentLoopRun, getAgentLoopRun, listAgentLoopRuns } from "../core/agent-loop";
import { deleteArtifact, listAllArtifacts, listArtifacts, readArtifact } from "../core/artifacts";
import { getAppVersion, getBuildProvenance, getReleaseRepositoryUrl } from "../core/build-info";
import { channelManager } from "../core/channels";
import { listChatCapabilities, listChatCommands } from "../core/chat/capability-mentions";
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
} from "../core/checkpoint";
import { config, redactSandboxRuntimeConfig } from "../core/config";
import { setCybaraHomeOverride } from "../core/cybara-home";
import { tables } from "../core/database";
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
  listPluginChannelContributions,
  listPluginCommands,
  listPluginProviderContributions,
} from "../core/plugins/runtime";
import { providerManager } from "../core/providers";
import {
  getAllPricing,
  getRouterStatus,
  type RouterConfig,
  selectProviderWithLiveUsage,
} from "../core/router";
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
import { agentRoutes } from "./agent-routes";
import { channelRoutes } from "./channel-routes";
import { getClientIp } from "./client-ip";
import { getCybaraDataDirConfigInfo, getCybaraDataDirInfo } from "./data-dir-info";
import { gatewayAuthSettingsResponse, updateGatewayHostSetting } from "./gateway-network";
import { buildJourney } from "./journey";
import { mobileRoutes } from "./mobile";
import { mobileSimulatorRoutes } from "./routes/mobile-simulator-routes";
import { discoverMarketplacePlugins, installMarketplacePlugin } from "./plugin-marketplace";
import { pollProviderDeviceCodeOAuth, startProviderDeviceCodeOAuth } from "./provider-oauth-device";
import { pollProviderRedirectOAuth, startProviderRedirectOAuth } from "./provider-oauth-redirect";
import { providerRoutes } from "./provider-routes";
import { getCombinedLogs, getCombinedLogsPage, getLogStats, normalizeTimestamp } from "./queries";
import { cacheMetricsRoutes, prewarmMetricsRoutes } from "./route-cache";
import { createRouteMatcher } from "./route-matcher";
import {
  isRawHttpResponse,
  normalizeIdentityConfig,
  normalizeOptionalString,
  normalizeSystemPromptConfig,
  type RouteHandler,
  sanitizeSessionMessages,
  type SessionMessageView,
} from "./routes/_shared";
import { accountConnectorRoutes } from "./routes/account-connectors";
import { browserSupervisionRoutes } from "./routes/browser-supervision";
import { evalRoutes } from "./routes/evals";
import { externalTelemetryRoutes } from "./routes/external-telemetry";
import { getProcessMemoryUsage, healthRoutes } from "./routes/health";
import { ideLspRoutes } from "./routes/ide-lsp-routes";
import { integrationCredentialRoutes } from "./routes/integration-credential-routes";
import { mcpRoutes } from "./routes/mcp";
import { metricsRoutes } from "./routes/metrics";
import { nearbyRoutes } from "./routes/nearby";
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
import { sessionEventRoutes } from "./routes/session-events";
import {
  latestSessionModelMetadata,
  type SessionModelMetadata,
  sessionModelMetadata,
  sessionModelMetadataSnapshot,
} from "./routes/session-model-metadata";
import { formatSkillInstallSpec } from "./routes/skill-formatting";
import { speechRoutes } from "./routes/speech";
import { toolCapabilityPolicyRoutes } from "./routes/tool-capability-policy";
import { walletRoutes } from "./routes/wallet";
import { webResearchRoutes } from "./routes/web-research-routes";
import {
  clearGatewayPassword,
  getGatewayAuthSettings,
  revealGatewayApiKey,
  rotateGatewayApiKey,
  securityCheck,
  setGatewayBasePath,
  setGatewayPassword,
  setGatewayRemoteAccessSettings,
  setRequireAuthForLocalhost,
  type SecurityCheckResult,
  validateUrl,
} from "./security";
import { serializeSubagentDetail, serializeSubagentSummary } from "./subagents";

const log = createLogger("API");

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
  ...mobileSimulatorRoutes,
  ...metricsRoutes,
  ...evalRoutes,
  ...speechRoutes,
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
  ...providerRoutes,
  ...channelRoutes,
  ...agentRoutes,
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
    const workspaceDir =
      typeof data.context?.workspaceDir === "string" && data.context.workspaceDir.trim()
        ? data.context.workspaceDir.trim()
        : config.getDefaultWorkspaceDir();
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
      workspaceDir,
      permissions: contextPermissions,
      enforcePermissions: data.context?.enforcePermissions === true,
      allowDangerousTools: false,
      confineToWorkspace: true,
    };

    return await executeTool(data.name, data.args, {
      ...context,
    });
  },

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
  "POST /api/router/select": async (body) => {
    const { preferredProviderId } = body as { preferredProviderId?: string };
    const selected = await selectProviderWithLiveUsage(preferredProviderId);
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

  "POST /api/providers/oauth/start": (body, _params, ctx) => startProviderRedirectOAuth(body, ctx),
  "POST /api/providers/oauth/callback-status": (body, _params, ctx) =>
    pollProviderRedirectOAuth(body, ctx),
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
      workspaceDir?: string | null;
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
        use_model_router: session.useModelRouter,
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
      use_model_router: "useModelRouter" in session && session.useModelRouter === true,
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
    const data = (body || {}) as {
      agentId?: string;
      agent_id?: string;
      useModelRouter?: boolean;
      use_model_router?: boolean;
    };
    const agentId =
      typeof data.agentId === "string" && data.agentId.trim()
        ? data.agentId.trim()
        : typeof data.agent_id === "string" && data.agent_id.trim()
          ? data.agent_id.trim()
          : "";
    try {
      return await updateSessionAgent(
        params!.sessionId,
        agentId || undefined,
        data.useModelRouter === true || data.use_model_router === true
      );
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
      const sanitizedRevertedMessage = sanitizeSessionMessages([reverted.revertedMessage])[0];

      return {
        success: true,
        sessionId: reverted.sessionId,
        keptCount: reverted.keptCount,
        removedCount: reverted.removedCount,
        removedFromIndex: reverted.removedFromIndex,
        revertedMessage: {
          ...sanitizedRevertedMessage,
          timestamp: normalizeTimestamp(sanitizedRevertedMessage?.timestamp),
        },
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
      providerType: agent?.provider_id
        ? providerManager.get(agent.provider_id)?.provider
        : undefined,
      executionMode: agent?.type === "planner" ? "plan" : "execute",
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

export async function handleRequest(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  ip?: string;
  security?: SecurityCheckResult;
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

  const clientIp = getClientIp(req.headers, req.ip);

  const security = req.security ?? securityCheck(method, path, req.headers, clientIp);
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
