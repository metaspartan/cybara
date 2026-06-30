import { config } from "../core/config";
import { cacheMetricsRoutes } from "./route-cache";
import { mobileRoutes } from "./mobile";
import {
  parseJsonObject,
  parseMetricMetadata,
  metricTimestampToMs,
  sumMetricValues,
  buildMetricTrend,
  localDateKeyFromMs,
  buildStorageMetrics,
  isSessionStatusActive,
  buildTokenCallSnapshots,
  buildAssistantOutputCloud,
  classifyModelBehavior,
  parseWalletChains,
  parseWalletTokenChain,
  parseJsonArray,
  parseOptionalNumber,
  normalizeOptionalString,
  normalizeSecretString,
  buildGoogleAuthHeaders,
  isLikelyGoogleApiKey,
  formatChannelTestError,
  normalizeSystemPromptConfig,
  normalizeIdentityConfig,
  sanitizeSessionMessages,
  decodeDictationAudioBase64,
  pickDictationProvider,
  transcribeWithOpenAICompatibleProvider,
  type LspDiagnosticLike,
  type LspLocationLike,
  type LspSymbolLike,
  type NormalizedLspSymbol,
  type SessionMessageView,
  type MetricTopKey,
  type ProviderMetricSummary,
  type TokenCloudEntry,
} from "./routes/_shared";
import { tables } from "../core/database";
import { agentManager, getBuiltinTools, type AgentMessage } from "../core/agent";
import {
  providerManager,
  providers,
  resolveProviderType,
  type ProviderType,
} from "../core/providers";
import { resolveGeminiCliOAuthClientConfig } from "../core/gemini-cli-oauth";
import {
  channelManager,
  channels,
  processTelegramWebhook,
  securityManager,
  whatsappAdapter,
} from "../core/channels";
import { taskScheduler } from "../core/scheduler";
import { mcpManager } from "../core/mcp";
import { mcpRegistry } from "../core/mcp-registry";
import { getLSPManager, initLSPManager } from "../core/lsp";
import * as subagentRegistry from "../core/subagent-registry";
import {
  getSkills,
  getSkill,
  getSkillCategories,
  executeSkill,
  loadAllSkills,
  createEligibilityContext,
  getSkillsStatusReport,
  registryManager,
  clearSkillsCache,
  createLocalSkill,
} from "../core/skills/index";
import {
  installLocalPluginFromPath,
  listInstalledPlugins,
  uninstallLocalPlugin,
  validatePluginAtPath,
} from "../core/plugins";
import {
  handleChat,
  getSession,
  getSessionMessages,
  listSessions,
  listSessionPage,
  deleteSession,
  setSessionPinned,
  revertSessionToMessage,
  updateSessionWorkspace,
  updateSessionTitle,
  getChatRateLimitStatus,
  type ChatMessage,
} from "../api/chat";
import {
  getToolSchemasForLLM,
  getDangerousToolNames,
  getCircuitState,
  type ToolContext,
} from "../core/tools/index";
import { executeTool, hasTool } from "../core/tools/handlers/index";
import { handleSessionsSpawn } from "../core/tools/handlers/channel";
import {
  handleMemoryList,
  handleMemorySearch,
  handleMemoryDelete,
  handleMemoryEdit,
  handleMemoryCreate,
} from "../api/memory/memory-api";
import {
  searchAllLogs,
  getRecentActivity,
  getSessionMessages as getLogSessionMessages,
  getAgentLogs,
} from "../core/logging";
import { buildSystemPrompt } from "../core/system-prompt";
import { getAppVersion, getReleaseRepositoryUrl } from "../core/build-info";
import { checkForUpdate, isUpdateCheckDisabled } from "../core/update-check";
import { getPendingApprovals, getAlwaysAllowlist, resolveApproval } from "../core/tool-approval";
import { discoverProviderModels } from "../core/model-discovery";
import { listCheckpoints, deleteCheckpoint } from "../core/checkpoint";
import { getRouterStatus, selectProvider, getAllPricing, type RouterConfig } from "../core/router";
import { getSystemMonitorSnapshot } from "../core/system-monitor";
import * as pwManager from "../core/browser/pw-manager";
import { homedir } from "os";
import { dirname, isAbsolute, resolve } from "path";
import { createHash, randomBytes } from "crypto";
import { securityCheck, validateUrl } from "./security";
// fs + paths imports moved to ./routes/_shared.ts (used by extracted helpers).
import {
  browseDirectory,
  readFileContent,
  writeFileContent,
  createItem,
  renameItem,
  searchWorkspace,
  replaceInWorkspace,
  previewReplaceInWorkspace,
  listWorkspaceFiles,
  getFileBlame,
  revealInSystemExplorer,
  openInSystemTerminal,
  getFilePermalink,
  getFileHistoryUrl,
} from "./ide-api";
import { getGitStatus, getGitBranch, getGitDiff } from "./git-api";
import { createLogger } from "../core/logger";
import { openUrlInBrowser } from "../core/runtime/open-url";
import { trackApiCall, trackFileOperation, trackMetric } from "../core/metrics";
import {
  startAgentLoop,
  listAgentLoopRuns,
  getAgentLoopRun,
  cancelAgentLoopRun,
} from "../core/agent-loop";
import { listArtifacts, readArtifact, deleteArtifact, listAllArtifacts } from "../core/artifacts";
import { getSessionStatusSnapshot, listSessionStatusSnapshots } from "../core/status";
import { getSandboxRuntimeStatus, logSandboxRuntimeStatus } from "../core/sandbox";
import { workspaceIndexer } from "../core/workspace-indexer";
import type {
  WalletChain,
  WalletAgentPolicy,
  WalletPriceQuoteInput,
  WalletSwapInput,
  WalletSwapEthUniswapInput,
  SolInstructionAccountMeta,
  WalletDappCallInput,
  WalletX402RequestInput,
  WalletRpcCallInput,
} from "../core/wallet";
import {
  normalizeTimestamp,
  getCombinedLogs,
  getCombinedLogsPage,
  getLogStats,
  getDailyLogCounts,
  getModelMetrics,
  type MetricsEntry,
} from "./queries";

const log = createLogger("API");

const oauthCallbacks = new Map<
  string,
  { status: string; access_token?: string; refresh_token?: string; error?: string }
>();

type WalletModule = typeof import("../core/wallet");
type WalletManagerInstance = WalletModule["walletManager"];
let walletModulePromise: Promise<WalletModule> | null = null;

async function getWalletManager(): Promise<WalletManagerInstance> {
  if (!walletModulePromise) {
    walletModulePromise = import("../core/wallet");
  }

  try {
    const walletModule = await walletModulePromise;
    if (!walletModule.walletManager) {
      // Module imported but walletManager is undefined — module evaluation
      // likely failed partway through (e.g. WASM crash). Clear cache and retry.
      walletModulePromise = null;
      throw new Error(
        "Wallet module loaded but walletManager is undefined. " +
          "This usually means a native dependency (tiny-secp256k1 WASM) " +
          "failed during module initialization. Check server logs for details."
      );
    }
    return walletModule.walletManager;
  } catch (error) {
    walletModulePromise = null;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Wallet module unavailable: ${reason}`);
  }
}

async function withWalletManager<T>(
  callback: (manager: WalletManagerInstance) => Promise<T> | T
): Promise<T> {
  const walletManager = await getWalletManager();
  return await callback(walletManager);
}

function validateProviderCredentialShape(
  providerType: string,
  credentials: { apiKey?: string; accessToken?: string }
): void {
  if (providerType === "openai" && credentials.apiKey && !credentials.apiKey.startsWith("sk-")) {
    throw new Error("Validation error: OpenAI API key must start with 'sk-'");
  }

  if (providerType === "google" && credentials.apiKey) {
    const trimmed = credentials.apiKey.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      throw new Error(
        "Validation error: Google API key looks like a URL. Paste an AI Studio key (starts with 'AIza')."
      );
    }
    const looksLikeOAuthJson = trimmed.startsWith("{") && trimmed.endsWith("}");
    const looksLikeApiKey = isLikelyGoogleApiKey(trimmed);
    if (!looksLikeOAuthJson && !looksLikeApiKey) {
      throw new Error(
        "Validation error: Google API key format is invalid. Expected AI Studio key starting with 'AIza'."
      );
    }
  }
}

function resolveWorkspacePath(filePath?: string): string {
  if (!filePath || typeof filePath !== "string") {
    return process.cwd();
  }

  const trimmed = filePath.trim();
  if (!trimmed) return process.cwd();

  const absolute = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  return dirname(absolute);
}

function getOrInitLspManager(workspacePath?: string) {
  const resolvedWorkspace = workspacePath ? resolve(workspacePath) : resolve(process.cwd());
  try {
    const existing = getLSPManager();
    if (resolve(existing.getWorkspacePath()) !== resolvedWorkspace) {
      return initLSPManager(resolvedWorkspace);
    }
    return existing;
  } catch {
    return initLSPManager(resolvedWorkspace);
  }
}

function trackLspOperation(operation: string, metadata?: Record<string, unknown>, value = 1): void {
  trackMetric("lsp_operation", operation, value, metadata);
}

function trackIdeOperation(
  operation:
    | "browse"
    | "read"
    | "write"
    | "create"
    | "rename"
    | "search"
    | "blame"
    | "reveal"
    | "open_terminal"
    | "permalink"
    | "history_url"
    | "replace"
    | "replace_preview"
    | "list_files"
    | "index_status"
    | "index_workspace"
    | "index_reindex"
    | "index_stop"
    | "index_search"
    | "index_settings"
    | "index_embeddings"
    | "index_embedding_runtime"
    | "index_embedding_load"
    | "index_embedding_stop"
    | "inline_completion",
  path: string | undefined,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  trackMetric("ide_operation", operation, 1, { path, success, ...metadata });
}

function stripInlineCompletionFormatting(value: string): string {
  const withoutThinking = value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "");
  const withoutCodeFences = withoutThinking
    .replace(/^```[a-zA-Z0-9_-]*\s*/g, "")
    .replace(/```$/g, "");
  return withoutCodeFences.trim();
}

function sanitizeInlineCompletion(value: string, prefix: string, maxChars = 320): string {
  let next = stripInlineCompletionFormatting(value);
  if (!next) return "";

  if (prefix && next.toLowerCase().startsWith(prefix.toLowerCase())) {
    next = next.slice(prefix.length);
  }

  // Keep inline completion concise and deterministic for ghost text rendering.
  const maxLength = Math.max(24, Math.min(2000, Math.floor(maxChars)));
  if (next.length > maxLength) {
    next = next.slice(0, maxLength);
  }

  // Remove leading chatty labels if models ignore instruction.
  next = next.replace(/^(here(?:'s| is)\s+)?(?:the\s+)?(?:completion|suggestion)\s*[:-]\s*/i, "");
  return next;
}

function truncateInlineContext(value: string, maxChars: number): string {
  const text = typeof value === "string" ? value : "";
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function normalizeFileUriToPath(uri: string): string {
  if (!uri) return "";

  try {
    const url = new URL(uri);
    if (url.protocol === "file:") {
      let pathname = decodeURIComponent(url.pathname);
      if (process.platform === "win32" && pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }
      return pathname;
    }
  } catch {
    // Not a valid URL; fall back to prefix stripping.
  }

  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.slice("file://".length));
  }
  return uri;
}

function normalizeDefinitionLocation(
  raw: unknown
): { uri: string; path: string; line: number; character: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const location = raw as LspLocationLike;

  const uri =
    typeof location.uri === "string"
      ? location.uri
      : typeof location.targetUri === "string"
        ? location.targetUri
        : "";
  if (!uri) return null;

  const start =
    location.range?.start || location.targetSelectionRange?.start || location.targetRange?.start;
  const line = typeof start?.line === "number" ? start.line : 0;
  const character = typeof start?.character === "number" ? start.character : 0;

  return {
    uri,
    path: normalizeFileUriToPath(uri),
    line,
    character,
  };
}

function normalizeSymbolRange(raw: unknown): {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const range = raw as {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  const line = typeof range.start?.line === "number" ? range.start.line : 0;
  const character = typeof range.start?.character === "number" ? range.start.character : 0;
  const endLine = typeof range.end?.line === "number" ? range.end.line : line;
  const endCharacter = typeof range.end?.character === "number" ? range.end.character : character;
  return { line, character, endLine, endCharacter };
}

function normalizeLspSymbol(raw: unknown): NormalizedLspSymbol | null {
  if (!raw || typeof raw !== "object") return null;
  const symbol = raw as LspSymbolLike;
  const range =
    normalizeSymbolRange(symbol.range) ||
    normalizeSymbolRange(symbol.selectionRange) ||
    normalizeSymbolRange(symbol.location?.range);
  if (!range) return null;

  const children = (Array.isArray(symbol.children) ? symbol.children : [])
    .map((child) => normalizeLspSymbol(child))
    .filter((child): child is NormalizedLspSymbol => !!child);

  return {
    name: typeof symbol.name === "string" && symbol.name.trim() ? symbol.name : "(symbol)",
    kind: typeof symbol.kind === "number" && Number.isFinite(symbol.kind) ? symbol.kind : 13,
    detail: typeof symbol.detail === "string" && symbol.detail.trim() ? symbol.detail : undefined,
    line: range.line + 1,
    character: range.character + 1,
    endLine: range.endLine + 1,
    endCharacter: range.endCharacter + 1,
    children: children.length > 0 ? children : undefined,
  };
}

interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}

const requestLogs: RequestLog[] = [];
const MAX_LOGS = 1000;

function logRequest(log: RequestLog): void {
  requestLogs.unshift(log);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.pop();
  }

  const logLevel = log.status >= 500 ? "error" : log.status >= 400 ? "warn" : "info";
  console[logLevel](
    `[API] ${log.method} ${log.path} ${log.status} ${log.durationMs}ms${log.error ? ` - ${log.error}` : ""}`
  );
}

function recordApiMetrics(method: string, path: string, status: number, durationMs: number): void {
  trackApiCall(path, method, status, durationMs);
  trackMetric("api_status", String(status), 1, { method, path, durationMs });
}

const isProduction = process.env.NODE_ENV === "production";

const corsBaseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

// Config rows can hold secrets (session_secret, stored tokens, etc.). The
// config table accepts arbitrary keys, so redact anything whose key looks
// sensitive before returning it over the API.
const SECRET_CONFIG_KEY =
  /(secret|token|password|passwd|api[_-]?key|private[_-]?key|mnemonic|credential|seed)/i;
function redactSecretConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    out[key] =
      SECRET_CONFIG_KEY.test(key) && value != null && value !== "" ? "***redacted***" : value;
  }
  return out;
}

function parseBoundedQueryNumber(
  raw: string | undefined,
  min: number,
  max: number
): number | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function buildCorsHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = { ...corsBaseHeaders };
  // Never emit a wildcard for an API that exposes file/wallet/tool operations.
  // In dev, reflect the specific requesting origin (so the local web UI works)
  // rather than "*"; requests still require the API key / same-origin browser
  // signal to authenticate (see security.ts). In prod, omit CORS entirely.
  if (!isProduction && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
type RouteHandler = (body?: unknown, params?: Record<string, string>) => Promise<unknown> | unknown;
const routes: Record<string, RouteHandler> = {
  ...mobileRoutes,
  "GET /api/health": () => {
    const now = new Date();
    const system = getSystemMonitorSnapshot();
    return {
      status: "healthy",
      timestamp: now.toISOString(),
      uptime: process.uptime(),
      version: getAppVersion(),
      system,
      checks: {
        database: checkDatabaseHealth(),
        agents: agentManager.getStats(),
        providers: providerManager.getStats(),
        memory: getMemoryUsage(),
        system: getSystemMonitorHealth(system),
      },
    };
  },

  "GET /api/health/ready": () => ({
    ready: true,
    timestamp: new Date().toISOString(),
  }),

  "GET /api/health/live": () => ({
    live: true,
    timestamp: new Date().toISOString(),
  }),

  "GET /api/metrics": () => ({
    requestCount: requestLogs.length,
    recentRequests: requestLogs.slice(0, 100),
    rateLimits: {
      chat: getChatRateLimitStatus(),
    },
    circuitBreakers: getCircuitBreakersStatus(),
    memory: getMemoryUsage(),
    uptime: process.uptime(),
  }),

  "GET /api/info": () => ({
    name: "Cybara",
    version: getAppVersion(),
    releaseRepositoryUrl: getReleaseRepositoryUrl(),
    setupComplete: config.isSetupComplete(),
    homeDir: process.env.HOME || homedir(),
    stats: {
      agents: agentManager.getStats(),
      providers: providerManager.getStats(),
      channels: channelManager.getStats(),
      tasks: taskScheduler.getStats(),
    },
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
  "POST /api/setup/complete": () => {
    config.completeSetup();
    if (!agentManager.hasDefaultAgent()) {
      agentManager.createDefault();
    }
    return { success: true };
  },

  "GET /api/wallet/status": async () => {
    return await withWalletManager((walletManager) => walletManager.getStatus());
  },
  "GET /api/wallet/rpc": async () => {
    return await withWalletManager((walletManager) => walletManager.getRpcConfig());
  },
  "GET /api/wallet/rpc/status": async () => {
    return await withWalletManager(async (walletManager) => await walletManager.getRpcStatus());
  },
  "PUT /api/wallet/rpc": async (body) => {
    const data = body as { ethRpc?: string; solRpc?: string; btcApi?: string };
    return await withWalletManager((walletManager) =>
      walletManager.setRpcConfig({
        ethRpc: data.ethRpc,
        solRpc: data.solRpc,
        btcApi: data.btcApi,
      })
    );
  },
  "GET /api/wallet/agent-policy": async () => {
    return await withWalletManager((walletManager) => walletManager.getAgentPolicy());
  },
  "PUT /api/wallet/agent-policy": async (body) => {
    const data = (body || {}) as Partial<WalletAgentPolicy>;
    return await withWalletManager((walletManager) =>
      walletManager.setAgentPolicy({
        allowNativeSend: data.allowNativeSend,
        allowTokenSend: data.allowTokenSend,
        allowEthContractWrite: data.allowEthContractWrite,
        allowSolProgramInstruction: data.allowSolProgramInstruction,
        allowEthSwaps: data.allowEthSwaps,
        allowDappInteraction: data.allowDappInteraction,
        allowX402Payments: data.allowX402Payments,
        allowedEthContracts: Array.isArray(data.allowedEthContracts)
          ? data.allowedEthContracts
          : undefined,
        allowedSolPrograms: Array.isArray(data.allowedSolPrograms)
          ? data.allowedSolPrograms
          : undefined,
        allowedDappHosts: Array.isArray(data.allowedDappHosts) ? data.allowedDappHosts : undefined,
        allowedX402Networks: Array.isArray(data.allowedX402Networks)
          ? data.allowedX402Networks
          : undefined,
        x402MaxAmountAtomic:
          typeof data.x402MaxAmountAtomic === "string" ? data.x402MaxAmountAtomic : undefined,
      })
    );
  },
  "POST /api/wallet/create": async (body) => {
    const data = body as { password?: string };
    return await withWalletManager(
      async (walletManager) => await walletManager.createWallet(data.password || "")
    );
  },
  "POST /api/wallet/import": async (body) => {
    const data = body as { mnemonic?: string; password?: string };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.importWallet(data.mnemonic || "", data.password || "")
    );
  },
  "POST /api/wallet/unlock": async (body) => {
    const data = body as { password?: string };
    return await withWalletManager(
      async (walletManager) => await walletManager.unlock(data.password || "")
    );
  },
  "POST /api/wallet/lock": async () => {
    return await withWalletManager((walletManager) => walletManager.lock());
  },
  "GET /api/wallet/accounts": async (_body, params) => {
    const count = params?.count ? Number(params.count) : undefined;
    const startIndex = params?.startIndex ? Number(params.startIndex) : undefined;
    const chains = parseWalletChains(params?.chains);
    return await withWalletManager((walletManager) =>
      walletManager.getAccounts({ chains, count, startIndex })
    );
  },
  "GET /api/wallet/receive": async (_body, params) => {
    const chain = String(params?.chain || "eth").toLowerCase();
    const index = params?.index ? Number(params.index) : 0;
    return await withWalletManager((walletManager) =>
      walletManager.getReceiveAddress(chain as WalletChain, index)
    );
  },
  "GET /api/wallet/balances": async (_body, params) => {
    const count = params?.count ? Number(params.count) : undefined;
    const startIndex = params?.startIndex ? Number(params.startIndex) : undefined;
    const chains = parseWalletChains(params?.chains);
    return await withWalletManager(
      async (walletManager) => await walletManager.getBalances({ chains, count, startIndex })
    );
  },
  "GET /api/wallet/tokens": async (_body, params) => {
    const chain = parseWalletTokenChain(params?.chain, "eth");
    const index = params?.index ? Number(params.index) : 0;
    const includeZero = String(params?.includeZero || "").toLowerCase() === "true";
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getTokenBalances({
          chain,
          index,
          includeZero,
        })
    );
  },
  "GET /api/wallet/token-transactions": async (_body, params) => {
    const chain = parseWalletTokenChain(params?.chain, "eth");
    const index = params?.index ? Number(params.index) : 0;
    const limit = params?.limit ? Number(params.limit) : undefined;
    const tokenAddress = params?.tokenAddress;
    const rpcUrl = params?.rpcUrl;

    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getTokenTransactions({
          chain,
          index,
          limit,
          tokenAddress,
          rpcUrl,
        })
    );
  },
  "GET /api/wallet/transactions": async (_body, params) => {
    const chain = String(params?.chain || "").toLowerCase();
    if (!chain) {
      throw new Error("Validation error: chain is required");
    }
    const index = params?.index ? Number(params.index) : 0;
    const limit = params?.limit ? Number(params.limit) : undefined;
    const rpcUrl = params?.rpcUrl;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getTransactions({
          chain: chain as WalletChain,
          index,
          limit,
          rpcUrl,
        })
    );
  },
  "POST /api/wallet/send": async (body) => {
    const data = body as {
      chain?: string;
      to?: string;
      amount?: string;
      index?: number;
      memo?: string;
      rpcUrl?: string;
      feeRate?: number;
    };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.send({
          chain: String(data.chain || "").toLowerCase() as WalletChain,
          to: data.to || "",
          amount: data.amount || "",
          index: data.index,
          memo: data.memo,
          rpcUrl: data.rpcUrl,
          feeRate: data.feeRate,
        })
    );
  },
  "POST /api/wallet/send-token": async (body) => {
    const data = body as {
      chain?: string;
      tokenAddress?: string;
      mint?: string;
      to?: string;
      amount?: string;
      index?: number;
      decimals?: number;
      rpcUrl?: string;
      memo?: string;
    };

    return await withWalletManager(
      async (walletManager) =>
        await walletManager.sendToken({
          chain: parseWalletTokenChain(data.chain, "eth"),
          tokenAddress: String(data.tokenAddress || data.mint || "").trim(),
          to: String(data.to || "").trim(),
          amount: String(data.amount || "").trim(),
          index: data.index,
          decimals: data.decimals,
          rpcUrl: data.rpcUrl,
          memo: data.memo,
        })
    );
  },
  "POST /api/wallet/eth-contract": async (body) => {
    const data = body as {
      contractAddress?: string;
      abi?: string;
      method?: string;
      methodSignature?: string;
      args?: unknown[];
      index?: number;
      value?: string;
      gasLimit?: number | string;
      gasPriceGwei?: string;
      maxFeePerGasGwei?: string;
      maxPriorityFeePerGasGwei?: string;
      nonce?: number;
      readOnly?: boolean;
      rpcUrl?: string;
    };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.callEthContract({
          contractAddress: String(data.contractAddress || ""),
          abi: typeof data.abi === "string" ? data.abi : undefined,
          method: String(data.method || data.methodSignature || ""),
          methodSignature:
            typeof data.methodSignature === "string" ? data.methodSignature : undefined,
          args: parseJsonArray(data.args),
          index: data.index,
          value: data.value,
          gasLimit:
            typeof data.gasLimit === "number" || typeof data.gasLimit === "string"
              ? data.gasLimit
              : undefined,
          gasPriceGwei: typeof data.gasPriceGwei === "string" ? data.gasPriceGwei : undefined,
          maxFeePerGasGwei:
            typeof data.maxFeePerGasGwei === "string" ? data.maxFeePerGasGwei : undefined,
          maxPriorityFeePerGasGwei:
            typeof data.maxPriorityFeePerGasGwei === "string"
              ? data.maxPriorityFeePerGasGwei
              : undefined,
          nonce: parseOptionalNumber(data.nonce),
          readOnly: data.readOnly === true,
          rpcUrl: data.rpcUrl,
        })
    );
  },
  "POST /api/wallet/sol-instruction": async (body) => {
    const data = body as {
      programId?: string;
      keys?: SolInstructionAccountMeta[];
      accounts?: SolInstructionAccountMeta[];
      dataBase64?: string;
      dataHex?: string;
      dataUtf8?: string;
      index?: number;
      rpcUrl?: string;
      computeUnitLimit?: number;
      computeUnitPriceMicroLamports?: number;
      skipPreflight?: boolean;
    };

    return await withWalletManager(
      async (walletManager) =>
        await walletManager.sendSolProgramInstruction({
          programId: String(data.programId || ""),
          keys: Array.isArray(data.keys) ? data.keys : undefined,
          accounts: Array.isArray(data.accounts) ? data.accounts : undefined,
          dataBase64: typeof data.dataBase64 === "string" ? data.dataBase64 : undefined,
          dataHex: typeof data.dataHex === "string" ? data.dataHex : undefined,
          dataUtf8: typeof data.dataUtf8 === "string" ? data.dataUtf8 : undefined,
          index: data.index,
          rpcUrl: data.rpcUrl,
          computeUnitLimit: parseOptionalNumber(data.computeUnitLimit),
          computeUnitPriceMicroLamports: parseOptionalNumber(data.computeUnitPriceMicroLamports),
          skipPreflight: data.skipPreflight === true,
        })
    );
  },
  "POST /api/wallet/swap-eth-uniswap": async (body) => {
    const data = (body || {}) as Partial<WalletSwapEthUniswapInput>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.swapEthOnUniswap({
          tokenOut: String(data.tokenOut || ""),
          amountEth: typeof data.amountEth === "string" ? data.amountEth : undefined,
          percent: typeof data.percent === "number" ? data.percent : undefined,
          minAmountOut: typeof data.minAmountOut === "string" ? data.minAmountOut : undefined,
          slippageBps: typeof data.slippageBps === "number" ? data.slippageBps : undefined,
          deadlineSeconds:
            typeof data.deadlineSeconds === "number" ? data.deadlineSeconds : undefined,
          index: typeof data.index === "number" ? data.index : undefined,
          recipient: typeof data.recipient === "string" ? data.recipient : undefined,
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
          dryRun: data.dryRun === true,
        })
    );
  },
  "POST /api/wallet/price": async (body) => {
    const data = (body || {}) as Partial<WalletPriceQuoteInput> & {
      feedId?: string;
    };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getPriceQuote({
          source:
            data.source === "auto" ||
            data.source === "chainlink" ||
            data.source === "pyth" ||
            data.source === "jupiter"
              ? data.source
              : undefined,
          symbol: typeof data.symbol === "string" ? data.symbol : undefined,
          pair: typeof data.pair === "string" ? data.pair : undefined,
          feedAddress: typeof data.feedAddress === "string" ? data.feedAddress : undefined,
          pythFeedId:
            typeof data.pythFeedId === "string"
              ? data.pythFeedId
              : typeof data.feedId === "string"
                ? data.feedId
                : undefined,
          mint: typeof data.mint === "string" ? data.mint : undefined,
          quoteCurrency: typeof data.quoteCurrency === "string" ? data.quoteCurrency : undefined,
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
        })
    );
  },
  "GET /api/wallet/endpoints": async () => {
    return await withWalletManager((walletManager) => walletManager.getEndpointDirectory());
  },
  "GET /api/wallet/dapps": async () => {
    return await withWalletManager((walletManager) => walletManager.getDappDirectory());
  },
  "POST /api/wallet/rpc-call": async (body) => {
    const data = (body || {}) as Partial<WalletRpcCallInput>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.rpcCall({
          chain: data.chain === "sol" ? "sol" : "eth",
          method: String(data.method || ""),
          params: parseJsonArray(data.params),
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
          id: typeof data.id === "string" || typeof data.id === "number" ? data.id : undefined,
        })
    );
  },
  "POST /api/wallet/dapp": async (body) => {
    const data = (body || {}) as Partial<WalletDappCallInput> & {
      payload?: Record<string, unknown> | string;
      input?: Record<string, unknown> | string;
    };
    const payload = (parseJsonObject(data.payload) ||
      parseJsonObject(data.input) ||
      (data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
        ? (data.payload as Record<string, unknown>)
        : undefined) ||
      (data.input && typeof data.input === "object" && !Array.isArray(data.input)
        ? (data.input as Record<string, unknown>)
        : undefined) ||
      {}) as Record<string, unknown>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.executeDapp({
          adapter: typeof data.adapter === "string" ? data.adapter : "",
          payload,
        })
    );
  },
  "POST /api/wallet/x402": async (body) => {
    const data = (body || {}) as Partial<WalletX402RequestInput>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.x402Request({
          url: String(data.url || ""),
          method: typeof data.method === "string" ? data.method : undefined,
          headers:
            data.headers && typeof data.headers === "object" && !Array.isArray(data.headers)
              ? (data.headers as Record<string, string>)
              : undefined,
          body: data.body,
          network: typeof data.network === "string" ? data.network : undefined,
          maxAmountAtomic:
            typeof data.maxAmountAtomic === "string" ? data.maxAmountAtomic : undefined,
          index: parseOptionalNumber(data.index),
          timeoutMs: parseOptionalNumber(data.timeoutMs),
          dryRun: data.dryRun === true,
          parseJsonResponse:
            typeof data.parseJsonResponse === "boolean" ? data.parseJsonResponse : undefined,
        })
    );
  },
  "POST /api/wallet/swap": async (body) => {
    const data = (body || {}) as Partial<WalletSwapInput> & {
      tokenAddress?: string;
      execute?: boolean;
      broadcast?: boolean;
    };
    const explicitDryRun = typeof data.dryRun === "boolean" ? data.dryRun : undefined;
    const execute = data.execute === true || data.broadcast === true;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.swap({
          venue: typeof data.venue === "string" ? data.venue : "uniswap_v3",
          tokenOut:
            typeof data.tokenOut === "string"
              ? data.tokenOut
              : typeof data.tokenAddress === "string"
                ? data.tokenAddress
                : undefined,
          amountEth: typeof data.amountEth === "string" ? data.amountEth : undefined,
          percent: parseOptionalNumber(data.percent),
          minAmountOut: typeof data.minAmountOut === "string" ? data.minAmountOut : undefined,
          recipient: typeof data.recipient === "string" ? data.recipient : undefined,
          feeTier: parseOptionalNumber(data.feeTier),
          inputMint: typeof data.inputMint === "string" ? data.inputMint : undefined,
          outputMint: typeof data.outputMint === "string" ? data.outputMint : undefined,
          amount: typeof data.amount === "string" ? data.amount : undefined,
          amountRaw: typeof data.amountRaw === "string" ? data.amountRaw : undefined,
          index: parseOptionalNumber(data.index),
          slippageBps: parseOptionalNumber(data.slippageBps),
          deadlineSeconds: parseOptionalNumber(data.deadlineSeconds),
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
          wrapUnwrapSol: typeof data.wrapUnwrapSol === "boolean" ? data.wrapUnwrapSol : undefined,
          computeUnitPriceMicroLamports: parseOptionalNumber(data.computeUnitPriceMicroLamports),
          skipPreflight: data.skipPreflight === true,
          dryRun: explicitDryRun ?? !execute,
        })
    );
  },
  "POST /api/wallet/sign": async (body) => {
    const data = body as { message?: string; chain?: string; index?: number };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.signMessage(
          data.message || "",
          (data.chain || "eth") as WalletChain,
          data.index || 0
        )
    );
  },
  "DELETE /api/wallet": async (body) => {
    const data = (body || {}) as { password?: string };
    return await withWalletManager(
      async (walletManager) => await walletManager.deleteWallet(data.password)
    );
  },
  "PUT /api/wallet/agent-access": async (body) => {
    const data = body as { enabled?: boolean };
    return await withWalletManager((walletManager) =>
      walletManager.setAgentAccessEnabled(data.enabled === true)
    );
  },

  "GET /api/config": () => ({
    ...redactSecretConfig(config.getAll()),
    dangerous_tool_policy: config.getDangerousToolPolicy(),
    tool_approval_mode: config.getToolApprovalMode(),
    web_tool_url_policy: config.getWebToolUrlPolicy(),
    sandbox_runtime: config.getSandboxRuntime(),
    workspace_indexer: config.getWorkspaceIndexerSettings(),
  }),
  "GET /api/sandbox/status": () => getSandboxRuntimeStatus(),
  "PUT /api/config": (body) => {
    const data = body as Record<string, unknown>;
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
      config.set(key, value);
    }
    return { success: true };
  },

  "GET /api/agents": () => agentManager.list(),
  "POST /api/agents": (body) => {
    const data = body as Parameters<typeof agentManager.create>[0];
    return agentManager.create(data);
  },
  "POST /api/agents/default": () => {
    if (agentManager.hasDefaultAgent()) {
      return { error: "Default agent already exists" };
    }
    return agentManager.createDefault();
  },
  "GET /api/agents/:id": (_body, params) => agentManager.get(params!.id),
  "PUT /api/agents/:id": (body, params) =>
    agentManager.update(params!.id, body as Parameters<typeof agentManager.update>[1]),
  "POST /api/agents/:id/start": async (_body, params) => ({
    success: await agentManager.start(params!.id),
  }),
  "POST /api/agents/:id/stop": async (_body, params) => ({
    success: await agentManager.stop(params!.id),
  }),
  "DELETE /api/agents/:id": (_body, params) => ({ success: agentManager.delete(params!.id) }),

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
    const data = body as { message: string; sessionId?: string; workspaceDir?: string };
    return await handleChat({
      message: data.message,
      agentId: params!.id,
      sessionId: data.sessionId,
      workspaceDir: data.workspaceDir,
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
      return { success: false, error: `Invalid decision. Must be one of: ${valid.join(", ")}` };
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
    };

    return await executeTool(data.name, data.args, {
      ...context,
    });
  },

  "GET /api/providers": () => providerManager.list(),
  "GET /api/providers/available": () =>
    Object.entries(providers).map(([key, value]) => ({
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
  "GET /api/providers/health": () => {
    const providerRows = tables.providers.all() as Array<{
      id: string;
      provider: string;
      name: string;
      api_key?: string | null;
      access_token?: string | null;
      refresh_token?: string | null;
      is_default?: number | boolean;
    }>;

    const providerStates = providerRows.map((p) => {
      const providerInfo = providers[p.provider as ProviderType];
      const requiresCredentials = providerInfo?.authType !== "none";
      const hasCredentials = !!(p.api_key || p.access_token || p.refresh_token);
      const configured = requiresCredentials ? hasCredentials : true;
      return {
        id: p.id,
        provider: p.provider,
        name: p.name,
        configured,
        requiresCredentials,
        default: !!p.is_default,
      };
    });

    return {
      status: "healthy",
      summary: {
        total: providerStates.length,
        configured: providerStates.filter((p) => p.configured).length,
        unconfigured: providerStates.filter((p) => !p.configured).length,
      },
      providers: providerStates,
    };
  },
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
      is_default?: boolean;
    };

    const apiKey = normalizeSecretString(data.api_key);
    const accessToken = normalizeSecretString(data.access_token);
    const resolvedProviderType = resolveProviderType(data.provider);
    if (!resolvedProviderType) {
      throw new Error(`Validation error: unknown provider '${data.provider}'`);
    }
    validateProviderCredentialShape(resolvedProviderType, { apiKey, accessToken });

    return providerManager.create({
      provider: resolvedProviderType as Parameters<typeof providerManager.create>[0]["provider"],
      name: normalizeOptionalString(data.name) || data.name,
      api_key: apiKey,
      access_token: accessToken,
      is_default: data.is_default,
    });
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
        updates.base_url = normalizedBaseUrl;
      }
    }

    if ("is_default" in data) {
      updates.is_default = data.is_default === true;
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

    validateProviderCredentialShape(existing.provider, {
      apiKey: updates.api_key,
      accessToken: updates.access_token,
    });

    return {
      success: providerManager.update(params!.id, updates),
    };
  },
  "DELETE /api/providers/:id": (_body, params) => ({ success: providerManager.delete(params!.id) }),
  "GET /api/providers/:id/models": (_body, params) => providerManager.getModels(params!.id),
  "POST /api/providers/:id/models/discover": async (_body, params) =>
    await discoverProviderModels(params!.id),
  "POST /api/providers/discover/ollama": async () => await providerManager.discoverOllamaModels(),

  "GET /api/checkpoints": (_body, params) => {
    const workspaceDir = params?.workspace as string;
    if (!workspaceDir) return { checkpoints: [] };
    return { checkpoints: listCheckpoints(workspaceDir) };
  },
  "DELETE /api/checkpoints/:id": (_body, params) => {
    const workspaceDir = params?.workspace as string;
    const id = params?.id as string;
    if (!workspaceDir || !id) return { success: false, error: "workspace and id are required" };
    return { success: deleteCheckpoint(workspaceDir, id) };
  },

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

  "POST /api/providers/oauth/device-code": async (body) => {
    const { providerType } = body as { providerType: string };
    const resolvedProviderType = resolveProviderType(providerType);
    const config = providers[resolvedProviderType as ProviderType] as Record<string, unknown>;
    if (!config) throw new Error(`Validation error: unknown provider '${providerType}'`);

    const oauthConfig = config.oauthConfig as
      { clientId?: string; deviceCodeUrl?: string; scope?: string } | undefined;
    if (!oauthConfig?.deviceCodeUrl || !oauthConfig?.clientId) {
      throw new Error(`Provider ${providerType} does not support device code OAuth flow`);
    }

    const res = await fetch(oauthConfig.deviceCodeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId,
        scope: oauthConfig.scope || "",
      }),
    });

    if (!res.ok) {
      throw new Error(`Device code request failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    return {
      device_code: json.device_code,
      user_code: json.user_code,
      verification_uri: json.verification_uri,
      expires_in: json.expires_in,
      interval: json.interval,
    };
  },

  "POST /api/providers/oauth/poll": async (body) => {
    const { providerType, deviceCode } = body as { providerType: string; deviceCode: string };
    const resolvedProviderType = resolveProviderType(providerType);
    const config = providers[resolvedProviderType as ProviderType] as Record<string, unknown>;
    if (!config) throw new Error(`Validation error: unknown provider '${providerType}'`);

    const oauthConfig = config.oauthConfig as { clientId?: string; tokenUrl?: string } | undefined;
    if (!oauthConfig?.tokenUrl || !oauthConfig?.clientId) {
      throw new Error(`Provider ${providerType} does not support device code OAuth flow`);
    }

    const res = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) {
      throw new Error(`Token poll failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as Record<string, string>;

    if ("access_token" in json && typeof json.access_token === "string") {
      return { status: "success", access_token: json.access_token };
    }

    const error = json.error || "unknown";
    if (error === "authorization_pending") {
      return { status: "pending" };
    }
    if (error === "slow_down") {
      return { status: "slow_down" };
    }
    if (error === "expired_token") {
      return { status: "expired" };
    }
    if (error === "access_denied") {
      return { status: "denied" };
    }

    return { status: "error", error };
  },

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

  "POST /api/providers/oauth/start": async (body) => {
    const { providerType } = body as { providerType: string };
    const resolvedProviderType = resolveProviderType(providerType);
    const providerConfig = providers[resolvedProviderType as ProviderType] as Record<
      string,
      unknown
    >;
    if (!providerConfig) throw new Error(`Validation error: unknown provider '${providerType}'`);

    const oauthConfigRaw = providerConfig.oauthConfig as
      | {
          authorizeUrl?: string;
          tokenUrl?: string;
          clientId?: string;
          clientSecret?: string;
          scope?: string;
          callbackPort?: number;
          callbackPath?: string;
          authorizeParams?: Record<string, string>;
        }
      | undefined;

    const oauthConfig = {
      ...(oauthConfigRaw || {}),
    };

    if (resolvedProviderType === "google-gemini-cli") {
      const clientConfig = resolveGeminiCliOAuthClientConfig();
      if (clientConfig?.clientId) {
        oauthConfig.clientId = clientConfig.clientId;
        if (clientConfig.clientSecret && !oauthConfig.clientSecret) {
          oauthConfig.clientSecret = clientConfig.clientSecret;
        }
      } else {
        const antigravityConfig = (providers.antigravity as Record<string, unknown>)
          ?.oauthConfig as { clientId?: string; clientSecret?: string } | undefined;
        if (antigravityConfig?.clientId) {
          oauthConfig.clientId = antigravityConfig.clientId;
          if (antigravityConfig.clientSecret && !oauthConfig.clientSecret) {
            oauthConfig.clientSecret = antigravityConfig.clientSecret;
          }
        } else {
          throw new Error(
            "Validation error: Provider google-gemini-cli requires Gemini CLI OAuth credentials. Install Gemini CLI or set CYBARA_GEMINI_OAUTH_CLIENT_ID."
          );
        }
      }
    }

    if (!oauthConfig.authorizeUrl || !oauthConfig.tokenUrl) {
      throw new Error(`Provider ${providerType} does not support OAuth redirect flow`);
    }
    if (!oauthConfig.clientId || typeof oauthConfig.clientId !== "string") {
      throw new Error(`Provider ${providerType} OAuth config is missing clientId`);
    }

    const pkceVerifier = randomBytes(32).toString("hex");
    const pkceChallenge = createHash("sha256").update(pkceVerifier).digest("base64url");

    const state = randomBytes(16).toString("hex");

    const callbackPort = oauthConfig.callbackPort || 0;
    const callbackPath = oauthConfig.callbackPath || "/callback";
    const redirectUri = `http://localhost:${callbackPort}${callbackPath}`;

    const renderOAuthCallbackHtml = (title: string, message: string, tone: "success" | "error") =>
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #1f2937 0%, #020617 60%);
        color: #e5e7eb;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .card {
        width: min(520px, calc(100vw - 2rem));
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(15,23,42,0.7);
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.35);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
        line-height: 1.2;
        color: ${tone === "success" ? "#86efac" : "#fca5a5"};
      }
      p { margin: 0; color: #cbd5e1; font-size: 15px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="card" role="main" aria-live="polite">
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

    const callbackServer = Bun.serve({
      port: callbackPort,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname !== callbackPath) {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          oauthCallbacks.set(state, { status: "error", error });
          setTimeout(() => {
            callbackServer.stop();
            oauthCallbacks.delete(state);
          }, 5000);
          return new Response(
            renderOAuthCallbackHtml("Authorization failed", "You can close this tab.", "error"),
            { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
          );
        }

        if (!code || returnedState !== state) {
          oauthCallbacks.set(state, {
            status: "error",
            error: "Invalid callback (state mismatch)",
          });
          setTimeout(() => {
            callbackServer.stop();
            oauthCallbacks.delete(state);
          }, 5000);
          return new Response("Invalid callback", { status: 400 });
        }

        try {
          const tokenParams: Record<string, string> = {
            code,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: pkceVerifier,
          };
          if (oauthConfig.clientId) tokenParams.client_id = oauthConfig.clientId;
          if (oauthConfig.clientSecret) tokenParams.client_secret = oauthConfig.clientSecret;

          const tokenRes = await fetch(oauthConfig.tokenUrl!, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams(tokenParams),
          });

          const tokenData = (await tokenRes.json()) as Record<string, unknown>;

          if (tokenData.access_token && typeof tokenData.access_token === "string") {
            oauthCallbacks.set(state, {
              status: "success",
              access_token: tokenData.access_token as string,
              refresh_token: (tokenData.refresh_token as string) || undefined,
            });
          } else {
            oauthCallbacks.set(state, {
              status: "error",
              error:
                (tokenData.error_description as string) ||
                (tokenData.error as string) ||
                "Token exchange failed",
            });
          }
        } catch (err) {
          oauthCallbacks.set(state, { status: "error", error: String(err) });
        }

        setTimeout(() => {
          callbackServer.stop();
          oauthCallbacks.delete(state);
        }, 5000);
        return new Response(
          renderOAuthCallbackHtml(
            "Connected",
            "You can close this tab and return to Cybara.",
            "success"
          ),
          { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
      },
    });

    oauthCallbacks.set(state, { status: "pending" });

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      code_challenge: pkceChallenge,
      code_challenge_method: "S256",
      state,
    });
    if (oauthConfig.scope && typeof oauthConfig.scope === "string") {
      authParams.set("scope", oauthConfig.scope);
    }
    const authorizeUrl = oauthConfig.authorizeUrl.toLowerCase();
    if (authorizeUrl.includes("accounts.google.com")) {
      authParams.set("access_type", "offline");
      authParams.set("prompt", "consent");
    }
    if (oauthConfig.authorizeParams) {
      for (const [key, value] of Object.entries(oauthConfig.authorizeParams)) {
        if (typeof value === "string" && value.length > 0) {
          authParams.set(key, value);
        }
      }
    }

    const authUrl = `${oauthConfig.authorizeUrl}?${authParams.toString()}`;

    setTimeout(() => {
      callbackServer.stop();
      oauthCallbacks.delete(state);
    }, 600_000);

    log.info(
      `OAuth started for ${providerType}: callback on port ${callbackServer.port}, path ${callbackPath}`
    );

    return {
      auth_url: authUrl,
      state,
      callback_port: callbackServer.port,
    };
  },

  "POST /api/providers/oauth/callback-status": async (body) => {
    const { state } = body as { state: string };
    const result = oauthCallbacks.get(state);
    if (!result) {
      return { status: "not_found" };
    }
    return result;
  },
  "GET /api/mcp": () => mcpManager.list(),
  "GET /api/mcp/servers": () => mcpManager.list(), // Legacy alias
  "POST /api/mcp/servers": (body) =>
    mcpManager.create(body as Parameters<typeof mcpManager.create>[0]), // Legacy alias
  "GET /api/mcp/tools": () => mcpManager.getToolDefinitions(),
  "POST /api/mcp": (body) => mcpManager.create(body as Parameters<typeof mcpManager.create>[0]),
  "GET /api/mcp/:id": (_body, params) => {
    const server = mcpManager.get(params!.id);
    if (!server) return { error: "MCP server not found" };
    const status = mcpManager.getStatus(params!.id);
    return { ...server, ...status };
  },
  "PUT /api/mcp/:id": (body, params) => ({
    success: mcpManager.update(params!.id, body as Parameters<typeof mcpManager.update>[1]),
  }),
  "DELETE /api/mcp/:id": (_body, params) => ({ success: mcpManager.delete(params!.id) }),
  "POST /api/mcp/:id/start": async (_body, params) => await mcpManager.start(params!.id),
  "POST /api/mcp/:id/stop": async (_body, params) => ({
    success: await mcpManager.stop(params!.id),
  }),
  "POST /api/mcp/:id/restart": async (_body, params) => await mcpManager.restart(params!.id),
  "POST /api/mcp/:id/call": async (body, params) => {
    const data = body as { tool: string; args: Record<string, unknown> };
    return await mcpManager.callTool(params!.id, data.tool, data.args);
  },

  "GET /api/mcp/registry/search": async (_body, params) => {
    const query = params?.q || "";
    const registry = params?.registry || undefined;
    return await mcpRegistry.search(query, registry);
  },
  "GET /api/mcp/registry/popular": () => mcpRegistry.getPopular(20),
  "GET /api/mcp/registry/categories": () => mcpRegistry.getCategories(),
  "GET /api/mcp/registry/category/:cat": (_body, params) => mcpRegistry.getByCategory(params!.cat),
  "GET /api/mcp/registry/servers/:id": (_body, params) => {
    const server = mcpRegistry.getDetails(params!.id);
    if (!server) return { error: "Server not found in registry" };
    return server;
  },
  "GET /api/mcp/registry/registries": () => mcpRegistry.getRegistries(),
  "POST /api/mcp/registry/install": async (body) => {
    const data = body as { package?: string; id?: string };
    if (data.id) {
      const server = mcpRegistry.getDetails(data.id);
      if (!server) return { success: false, error: "Server not found in registry" };
      return await mcpRegistry.installServer(server);
    }
    if (data.package) {
      return await mcpRegistry.installByPackage(data.package);
    }
    return { success: false, error: "Must provide 'id' or 'package'" };
  },

  "GET /api/lsp/status": async () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const availability: Record<string, { available: boolean; bundled: boolean }> = {};

      for (const lang of supported) {
        availability[lang] = {
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        };
      }

      trackLspOperation("status", {
        workspace: manager.getWorkspacePath(),
        supportedCount: supported.length,
        diagnosticsCount: manager.getAllDiagnostics().size,
        success: true,
      });
      return {
        status: "ok",
        workspace: process.cwd(),
        supported,
        available: availability,
        diagnosticsCount: manager.getAllDiagnostics().size,
      };
    } catch (err) {
      trackLspOperation("status", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { status: "error", error: String(err) };
    }
  },
  "GET /api/lsp/languages": async () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const result: Array<{ name: string; available: boolean; bundled: boolean }> = [];

      for (const lang of supported) {
        result.push({
          name: lang,
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        });
      }

      trackLspOperation("languages", {
        workspace: manager.getWorkspacePath(),
        languageCount: result.length,
        success: true,
      });
      return { languages: result };
    } catch (err) {
      trackLspOperation("languages", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { languages: [] };
    }
  },
  "GET /api/lsp/active": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      trackLspOperation("active_servers", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", servers: [] };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    try {
      const manager = getOrInitLspManager(workspacePath);
      const active = await manager.getActiveServersForFile(normalizedPath);
      trackLspOperation("active_servers", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        languageId: active.languageId,
        serverCount: active.servers.length,
        activeCount: active.servers.filter((server) => server.available).length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        languageId: active.languageId,
        servers: active.servers,
      };
    } catch (error) {
      trackLspOperation("active_servers", {
        workspace: workspacePath,
        filePath: normalizedPath,
        success: false,
        error: String(error),
      });
      return { success: false, error: String(error), servers: [] };
    }
  },
  "GET /api/lsp/diagnostics": () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const all = manager.getAllDiagnostics();
      const result: Array<{ file: string; count: number; errors: number; warnings: number }> = [];

      for (const [uri, diags] of all) {
        const typedDiags = diags as LspDiagnosticLike[];
        result.push({
          file: uri.replace("file://", ""),
          count: typedDiags.length,
          errors: typedDiags.filter((d) => d.severity === 1).length,
          warnings: typedDiags.filter((d) => d.severity === 2).length,
        });
      }

      trackLspOperation("diagnostics", {
        workspace: manager.getWorkspacePath(),
        files: result.length,
        total: result.reduce((sum, f) => sum + f.count, 0),
        success: true,
      });
      return { files: result, total: result.reduce((sum, f) => sum + f.count, 0) };
    } catch (err) {
      trackLspOperation("diagnostics", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { files: [], total: 0 };
    }
  },
  "GET /api/lsp/diagnostics/file": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      trackLspOperation("diagnostics_file", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", diagnostics: [] };
    }
    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    try {
      const manager = getOrInitLspManager(workspacePath);
      const diagnostics = await manager.getDiagnostics(normalizedPath);
      trackLspOperation("diagnostics_file", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        diagnosticsCount: diagnostics.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        diagnostics: (diagnostics as LspDiagnosticLike[]).map((d) => ({
          line: d.range?.start?.line ?? 0,
          character: d.range?.start?.character ?? 0,
          endLine: d.range?.end?.line ?? 0,
          endCharacter: d.range?.end?.character ?? 0,
          severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
          message: d.message,
          source: d.source,
          code: d.code,
        })),
      };
    } catch (e) {
      trackLspOperation("diagnostics_file", {
        workspace: workspacePath,
        filePath: normalizedPath,
        success: false,
        error: String(e),
      });
      return { success: false, error: String(e), diagnostics: [] };
    }
  },
  "GET /api/lsp/definition": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("definition", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const definitions = await manager.getDefinition(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(definitions) ? definitions : definitions ? [definitions] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("definition", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("definition", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/hover": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("hover", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const hover = await manager.getHover(normalizedPath, line, character);
      // Normalize the LSP Hover contents into a plain string for the UI.
      let text: string | null = null;
      if (hover) {
        const contents = (hover as { contents?: unknown }).contents;
        if (typeof contents === "string") {
          text = contents;
        } else if (Array.isArray(contents)) {
          text = contents
            .map((c) => (typeof c === "string" ? c : (c as { value?: string })?.value || ""))
            .filter(Boolean)
            .join("\n\n");
        } else if (contents && typeof contents === "object") {
          text = (contents as { value?: string }).value || null;
        }
      }
      trackLspOperation("hover", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        text,
      };
    } catch (errorValue) {
      trackLspOperation("hover", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/declaration": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("declaration", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const declarations = await manager.getDeclaration(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(declarations) ? declarations : declarations ? [declarations] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("declaration", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("declaration", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/type-definition": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("type_definition", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const definitions = await manager.getTypeDefinition(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(definitions) ? definitions : definitions ? [definitions] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("type_definition", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("type_definition", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/implementation": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("implementation", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const implementations = await manager.getImplementation(normalizedPath, line, character);
      const normalizedLocations = (
        Array.isArray(implementations) ? implementations : implementations ? [implementations] : []
      )
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      const location = normalizedLocations[0] || null;
      trackLspOperation("implementation", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        location,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("implementation", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/references": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    if (!filePath) {
      trackLspOperation("references", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;

    try {
      const manager = getOrInitLspManager(workspacePath);
      const references = await manager.getReferences(normalizedPath, line, character);
      const normalizedLocations = (references || [])
        .map((location) => normalizeDefinitionLocation(location))
        .filter(
          (location): location is { uri: string; path: string; line: number; character: number } =>
            !!location
        );
      trackLspOperation("references", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        resultCount: normalizedLocations.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        locations: normalizedLocations,
      };
    } catch (errorValue) {
      trackLspOperation("references", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue) };
    }
  },
  "GET /api/lsp/completion": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    const rawCharacter = params?.character as string | undefined;
    const prefix = typeof params?.prefix === "string" ? params.prefix : "";
    const rawLimit = params?.limit as string | undefined;

    if (!filePath) {
      trackLspOperation("completion", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", items: [] };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const parsedCharacter = Number.parseInt(rawCharacter || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 0) : 0;
    const character = Number.isFinite(parsedCharacter) ? Math.max(parsedCharacter, 0) : 0;
    const parsedLimit = Number.parseInt(rawLimit || "", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 80;
    const normalizedPrefix = prefix.trim().toLowerCase();

    try {
      const manager = getOrInitLspManager(workspacePath);
      const completions = await manager.getCompletions(normalizedPath, line, character);
      const filtered = completions
        .filter((item) =>
          normalizedPrefix
            ? item.label.toLowerCase().startsWith(normalizedPrefix) ||
              (item.filterText || "").toLowerCase().startsWith(normalizedPrefix)
            : true
        )
        .slice(0, limit)
        .map((item) => ({
          label: item.label,
          detail: item.detail,
          kind: item.kind,
          insertText: item.insertText || item.label,
          sortText: item.sortText,
        }));

      trackLspOperation("completion", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        line,
        character,
        count: filtered.length,
        success: true,
      });
      return {
        success: true,
        path: normalizedPath,
        line,
        character,
        items: filtered,
      };
    } catch (errorValue) {
      trackLspOperation("completion", {
        workspace: workspacePath,
        filePath: normalizedPath,
        line,
        character,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue), items: [] };
    }
  },
  "GET /api/lsp/symbols": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      trackLspOperation("symbols", { success: false, reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter", symbols: [] };
    }

    const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const workspacePath = resolveWorkspacePath(normalizedPath);

    try {
      const manager = getOrInitLspManager(workspacePath);
      const symbols = await manager.getDocumentSymbols(normalizedPath);
      const normalizedSymbols = (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => normalizeLspSymbol(symbol))
        .filter((symbol): symbol is NormalizedLspSymbol => !!symbol);

      trackLspOperation("symbols", {
        workspace: manager.getWorkspacePath(),
        filePath: normalizedPath,
        symbolCount: normalizedSymbols.length,
        success: true,
      });

      return {
        success: true,
        path: normalizedPath,
        symbols: normalizedSymbols,
      };
    } catch (errorValue) {
      trackLspOperation("symbols", {
        workspace: workspacePath,
        filePath: normalizedPath,
        success: false,
        error: String(errorValue),
      });
      return { success: false, error: String(errorValue), symbols: [] };
    }
  },
  "GET /api/lsp/install-status": async () => {
    try {
      const manager = getOrInitLspManager(process.cwd());
      const status = await manager.getInstallStatus();
      trackLspOperation("install_status", {
        workspace: manager.getWorkspacePath(),
        languageCount: status.length,
        success: true,
      });
      return { status };
    } catch (err) {
      trackLspOperation("install_status", {
        workspace: process.cwd(),
        success: false,
        error: String(err),
      });
      return { status: [], error: String(err) };
    }
  },
  "POST /api/lsp/install": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      trackLspOperation("install", { success: false, reason: "missing_language" });
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getOrInitLspManager(process.cwd());
      const result = await manager.installLSP(language);
      trackLspOperation("install", {
        workspace: manager.getWorkspacePath(),
        language,
        success: result.success === true,
      });
      return result;
    } catch (e) {
      trackLspOperation("install", {
        workspace: process.cwd(),
        language,
        success: false,
        error: String(e),
      });
      return { success: false, error: String(e) };
    }
  },
  "POST /api/lsp/uninstall": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      trackLspOperation("uninstall", { success: false, reason: "missing_language" });
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getOrInitLspManager(process.cwd());
      const result = await manager.uninstallLSP(language);
      trackLspOperation("uninstall", {
        workspace: manager.getWorkspacePath(),
        language,
        success: result.success === true,
      });
      return result;
    } catch (e) {
      trackLspOperation("uninstall", {
        workspace: process.cwd(),
        language,
        success: false,
        error: String(e),
      });
      return { success: false, error: String(e) };
    }
  },

  "GET /api/ide/index/status": (_body, params) => {
    const workspacePathRaw = params?.workspacePath as string | undefined;
    const workspacePath =
      typeof workspacePathRaw === "string" && workspacePathRaw.trim()
        ? workspacePathRaw.trim()
        : undefined;
    const status = workspaceIndexer.getStatus();
    trackIdeOperation("index_status", workspacePath, true, {
      state: status.state,
      indexedWorkspacePath: status.indexedWorkspacePath,
      filesIndexed: status.filesIndexed,
      filesScanned: status.filesScanned,
      directoriesScanned: status.directoriesScanned,
      skippedFiles: status.skippedFiles,
      isIndexing: status.isIndexing,
      semanticReady: status.semanticReady,
      semanticProvider: status.semanticProvider || "",
      semanticModel: status.semanticModel || "",
      semanticIndexedFiles: status.semanticIndexedFiles,
      semanticIndexedChunks: status.semanticIndexedChunks,
    });
    return { success: true, ...status };
  },

  "GET /api/ide/index/embeddings": async () => {
    try {
      const catalog = await workspaceIndexer.getEmbeddingCatalog();
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_embeddings", status.workspacePath || undefined, true, {
        selectedProvider: catalog.selected.provider,
        selectedModel: catalog.selected.model || "",
      });
      return {
        success: true,
        ...catalog,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embeddings", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "GET /api/ide/index/embedding/runtime": (_body, params) => {
    try {
      const provider =
        typeof (params?.provider as string | undefined) === "string"
          ? ((params?.provider as string | undefined) || "").trim()
          : "";
      const model =
        typeof (params?.model as string | undefined) === "string"
          ? ((params?.model as string | undefined) || "").trim()
          : "";
      const runtime = workspaceIndexer.getEmbeddingRuntimeStatus({
        provider: provider || undefined,
        model: model || undefined,
      });
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_embedding_runtime", status.workspacePath || undefined, true, {
        selectedProvider: runtime.selectedProvider,
        selectedModel: runtime.selectedModel,
        vectorProvider: runtime.vectorProvider,
        vectorModel: runtime.vectorModel,
        transformerSelectedModel: runtime.transformers.selectedModel,
        transformerSelectedState: runtime.transformers.selectedState,
        transformerLoadedCount: runtime.transformers.loadedModels.length,
      });
      return {
        success: true,
        ...runtime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embedding_runtime", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/workspace": async (body) => {
    const data = body as { workspacePath?: string };
    if (!data?.workspacePath || typeof data.workspacePath !== "string") {
      trackIdeOperation("index_workspace", undefined, false, { reason: "missing_workspace_path" });
      return { success: false, error: "Missing 'workspacePath' parameter" };
    }
    try {
      const status = await workspaceIndexer.setWorkspace(data.workspacePath);
      trackIdeOperation("index_workspace", data.workspacePath, true, {
        state: status.state,
        filesIndexed: status.filesIndexed,
      });
      return { success: true, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_workspace", data.workspacePath, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/reindex": async (body) => {
    const data = body as { workspacePath?: string };
    try {
      const status = await workspaceIndexer.reindex(
        typeof data?.workspacePath === "string" && data.workspacePath.trim()
          ? data.workspacePath
          : undefined
      );
      trackIdeOperation("index_reindex", data?.workspacePath, true, {
        state: status.state,
        filesIndexed: status.filesIndexed,
      });
      return { success: true, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_reindex", data?.workspacePath, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/stop": () => {
    const status = workspaceIndexer.stop();
    trackIdeOperation("index_stop", status.workspacePath || undefined, true, {
      state: status.state,
    });
    return { success: true, ...status };
  },

  "PUT /api/ide/index/settings": (body) => {
    try {
      const settings = workspaceIndexer.updateSettings(body);
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_settings", status.workspacePath || undefined, true, {
        enabled: settings.enabled,
        autoReindexOnWorkspaceSet: settings.autoReindexOnWorkspaceSet,
        includeHidden: settings.includeHidden,
        maxFiles: settings.maxFiles,
        maxFileSizeBytes: settings.maxFileSizeBytes,
        semanticEnabled: settings.semanticEnabled,
        semanticMaxFiles: settings.semanticMaxFiles,
        semanticMinScore: settings.semanticMinScore,
        embeddingProvider: settings.embeddingProvider,
        embeddingModel: settings.embeddingModel || "",
      });
      return { success: true, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_settings", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/embedding/load": async (body) => {
    const data = (body || {}) as { provider?: string; model?: string };
    try {
      const result = await workspaceIndexer.loadEmbeddingRuntime({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      const status = workspaceIndexer.getStatus();
      const runtime = workspaceIndexer.getEmbeddingRuntimeStatus({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      trackIdeOperation("index_embedding_load", status.workspacePath || undefined, result.success, {
        provider: result.provider,
        model: result.model,
      });
      return {
        ...result,
        status,
        runtime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embedding_load", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "POST /api/ide/index/embedding/stop": async (body) => {
    const data = (body || {}) as { provider?: string; model?: string };
    try {
      const result = await workspaceIndexer.stopEmbeddingRuntime({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      const status = workspaceIndexer.getStatus();
      trackIdeOperation("index_embedding_stop", status.workspacePath || undefined, result.success, {
        provider: result.provider,
        model: result.model,
      });
      const runtime = workspaceIndexer.getEmbeddingRuntimeStatus({
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
      });
      return {
        ...result,
        status,
        runtime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackIdeOperation("index_embedding_stop", undefined, false, { error: message });
      return { success: false, error: message };
    }
  },

  "GET /api/ide/index/search": async (_body, params) => {
    const path =
      typeof (params?.path as string | undefined) === "string"
        ? (params?.path as string | undefined) || "~"
        : "~";
    const query = (params?.query as string | undefined) || "";
    const parsedLimit = Number.parseInt((params?.limit as string | undefined) || "", 10);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const indexedResult = await workspaceIndexer.search(query, {
      workspacePath: path,
      limit,
    });

    if (indexedResult.success) {
      trackIdeOperation("index_search", path, true, {
        source: "index",
        queryLength: query.length,
        totalFiles: indexedResult.totalFiles,
        truncated: indexedResult.truncated,
        semanticMatches: indexedResult.semanticMatches || 0,
      });
      return indexedResult;
    }

    const fallback = await listWorkspaceFiles(path, { query, limit });
    const success = fallback.success !== false;
    trackIdeOperation("index_search", path, success, {
      source: "filesystem",
      queryLength: query.length,
      totalFiles: fallback.totalFiles,
      truncated: fallback.truncated,
      indexError: indexedResult.error,
      indexState: indexedResult.indexState,
    });
    return {
      ...fallback,
      source: "filesystem",
      indexed: false,
      indexState: indexedResult.indexState,
      indexError: indexedResult.error,
      workspacePath: path,
    };
  },

  "POST /api/ide/inline-completion": async (body) => {
    const data = body as {
      path?: string;
      before?: string;
      after?: string;
      prefix?: string;
      suffix?: string;
      agentId?: string;
      workspacePath?: string;
      maxChars?: number;
    };

    const path = typeof data.path === "string" ? data.path.trim() : "";
    const before = typeof data.before === "string" ? data.before : "";
    const after = typeof data.after === "string" ? data.after : "";
    const prefix = typeof data.prefix === "string" ? data.prefix : "";
    const suffix = typeof data.suffix === "string" ? data.suffix : "";
    const requestedMaxChars = Number.isFinite(Number(data.maxChars)) ? Number(data.maxChars) : 320;
    const maxChars = Math.max(40, Math.min(2000, Math.floor(requestedMaxChars)));

    if (!path) {
      trackIdeOperation("inline_completion", path || undefined, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }

    const requestedAgentId =
      typeof data.agentId === "string" && data.agentId.trim() ? data.agentId.trim() : "";
    const selectedAgent =
      (requestedAgentId ? agentManager.get(requestedAgentId) : undefined) ||
      agentManager.list().find((agent) => agent.status === "running") ||
      agentManager.list()[0];

    if (!selectedAgent) {
      trackIdeOperation("inline_completion", path, false, { reason: "no_agent_available" });
      return { success: false, error: "No available agent for inline completion" };
    }

    const provider = agentManager.resolveProvider(selectedAgent.id);
    if (!provider) {
      trackIdeOperation("inline_completion", path, false, {
        reason: "provider_unavailable",
        agentId: selectedAgent.id,
      });
      return { success: false, error: "Selected agent has no configured provider" };
    }

    const workspaceDirRaw =
      typeof data.workspacePath === "string" && data.workspacePath.trim()
        ? data.workspacePath.trim()
        : resolveWorkspacePath(path);
    const workspaceDir = workspaceDirRaw || undefined;
    const beforeContext = truncateInlineContext(before, 5000);
    const afterContext = (after || "").slice(0, 1800);
    const suffixContext = suffix.slice(0, 320);

    try {
      const messages: AgentMessage[] = [
        {
          role: "system",
          content: [
            "You are an IDE inline code completion engine.",
            "Return only the exact continuation text to insert at the cursor.",
            "Do not return markdown, backticks, labels, or explanations.",
            "Do not repeat code already present before the cursor.",
            "Prefer concise completions and keep style consistent with surrounding code.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `File: ${path}`,
            prefix ? `Already typed prefix: ${prefix}` : "Already typed prefix: (none)",
            suffixContext
              ? `Existing suffix hint: ${suffixContext}`
              : "Existing suffix hint: (none)",
            "",
            "Code before cursor:",
            beforeContext || "(empty)",
            "",
            "Code after cursor:",
            afterContext || "(empty)",
            "",
            "Return only the completion text now.",
          ].join("\n"),
        },
      ];

      const result = await agentManager.callLLM(provider, selectedAgent.model, messages, [], {
        agentId: selectedAgent.id,
        workspaceDir,
      });
      const completion = sanitizeInlineCompletion(result.content || "", prefix, maxChars);

      trackIdeOperation("inline_completion", path, true, {
        agentId: selectedAgent.id,
        providerId: provider.id,
        model: selectedAgent.model || "",
        completionLength: completion.length,
      });
      return {
        success: true,
        completion,
        agentId: selectedAgent.id,
        model: selectedAgent.model,
        provider: provider.provider,
      };
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      trackIdeOperation("inline_completion", path, false, {
        agentId: selectedAgent.id,
        error: message,
      });
      return { success: false, error: message };
    }
  },

  "GET /api/ide/browse": async (_body, params) => {
    const path = params?.path as string | undefined;
    const result = await browseDirectory(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("browse", path, success);
    trackFileOperation("search", path || process.cwd(), { success });
    return result;
  },

  "GET /api/ide/read": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      trackIdeOperation("read", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await readFileContent(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("read", path, success);
    trackFileOperation("read", path, { success });
    return result;
  },

  "GET /api/ide/blame": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      trackIdeOperation("blame", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const parsedMaxLines = Number.parseInt((params?.maxLines as string | undefined) || "", 10);
    const maxLines = Number.isFinite(parsedMaxLines) ? parsedMaxLines : undefined;
    const result = await getFileBlame(path, { maxLines });
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("blame", path, success, {
      lines: Array.isArray((result as { lines?: unknown }).lines)
        ? ((result as { lines: unknown[] }).lines || []).length
        : 0,
      truncated: (result as { truncated?: boolean }).truncated === true,
    });
    trackFileOperation("search", path, { success, operation: "blame" });
    return result;
  },

  "POST /api/ide/reveal": async (body) => {
    const { path } = body as { path?: string };
    if (!path || typeof path !== "string") {
      trackIdeOperation("reveal", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await revealInSystemExplorer(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("reveal", path, success);
    return result;
  },
  "POST /api/ide/open-terminal": async (body) => {
    const { path } = body as { path?: string };
    if (!path || typeof path !== "string") {
      trackIdeOperation("open_terminal", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await openInSystemTerminal(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("open_terminal", path, success);
    return result;
  },
  "GET /api/ide/permalink": async (_body, params) => {
    const path = params?.path as string | undefined;
    const rawLine = params?.line as string | undefined;
    if (!path) {
      trackIdeOperation("permalink", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const parsedLine = Number.parseInt(rawLine || "", 10);
    const line = Number.isFinite(parsedLine) ? Math.max(parsedLine, 1) : 1;
    const result = await getFilePermalink(path, line);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("permalink", path, success, { line });
    return result;
  },
  "GET /api/ide/history-url": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      trackIdeOperation("history_url", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    const result = await getFileHistoryUrl(path);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("history_url", path, success);
    return result;
  },

  "POST /api/ide/write": async (body) => {
    const { path, content } = body as { path?: string; content?: string };
    if (!path) {
      trackIdeOperation("write", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    if (content === undefined) {
      trackIdeOperation("write", path, false, { reason: "missing_content" });
      return { success: false, error: "Missing 'content' parameter" };
    }
    const result = await writeFileContent(path, content);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("write", path, success, { bytes: content.length });
    trackFileOperation("write", path, { success, bytes: content.length });
    return result;
  },

  "POST /api/ide/create": async (body) => {
    const { parentPath, name, type } = body as {
      parentPath?: string;
      name?: string;
      type?: "file" | "directory";
    };
    if (!parentPath) {
      trackIdeOperation("create", parentPath, false, { reason: "missing_parent_path" });
      return { success: false, error: "Missing 'parentPath' parameter" };
    }
    if (!name) {
      trackIdeOperation("create", parentPath, false, { reason: "missing_name" });
      return { success: false, error: "Missing 'name' parameter" };
    }
    if (!type || (type !== "file" && type !== "directory")) {
      trackIdeOperation("create", parentPath, false, { reason: "invalid_type" });
      return {
        success: false,
        error: "Missing or invalid 'type' parameter (must be 'file' or 'directory')",
      };
    }
    const createdPath = resolve(parentPath, name);
    const result = await createItem(parentPath, name, type);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("create", createdPath, success, { type });
    trackFileOperation("write", createdPath, { success, type, parentPath });
    return result;
  },

  "POST /api/ide/rename": async (body) => {
    const { path, newName } = body as {
      path?: string;
      newName?: string;
    };
    if (!path) {
      trackIdeOperation("rename", path, false, { reason: "missing_path" });
      return { success: false, error: "Missing 'path' parameter" };
    }
    if (!newName || typeof newName !== "string") {
      trackIdeOperation("rename", path, false, { reason: "missing_new_name" });
      return { success: false, error: "Missing 'newName' parameter" };
    }
    const result = await renameItem(path, newName);
    const success =
      !!result && typeof result === "object" && (result as { success?: boolean }).success !== false;
    trackIdeOperation("rename", path, success, { newName });
    trackFileOperation("write", path, { success, operation: "rename", newName });
    return result;
  },

  "GET /api/ide/search": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    const query = (params?.query as string | undefined) || "";
    const caseSensitive = params?.caseSensitive === "true";
    const wholeWord = params?.wholeWord === "true";
    const result = await searchWorkspace(path, query, { caseSensitive, wholeWord });
    const success = result.success !== false;
    trackIdeOperation("search", path, success, {
      queryLength: query.length,
      totalMatches: result.totalMatches,
    });
    trackFileOperation("search", path || process.cwd(), {
      success,
      queryLength: query.length,
      totalMatches: result.totalMatches,
    });
    return result;
  },

  "GET /api/ide/files": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    const query = (params?.query as string | undefined) || "";
    const parsedLimit = Number.parseInt((params?.limit as string | undefined) || "", 10);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const result = await listWorkspaceFiles(path, { query, limit });
    const success = result.success !== false;
    trackIdeOperation("list_files", path, success, {
      queryLength: query.length,
      totalFiles: result.totalFiles,
      truncated: result.truncated,
    });
    trackFileOperation("search", path || process.cwd(), {
      success,
      queryLength: query.length,
      totalFiles: result.totalFiles,
      truncated: result.truncated,
    });
    return result;
  },

  "POST /api/ide/replace": async (body) => {
    const { path, query, replacement, caseSensitive, wholeWord, files } = body as {
      path?: string;
      query?: string;
      replacement?: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      files?: string[];
    };
    if (!query || typeof query !== "string") {
      return { success: false, error: "Missing 'query' parameter" };
    }
    if (typeof replacement !== "string") {
      return { success: false, error: "Missing 'replacement' parameter" };
    }

    const targetPath = path || "~";
    const result = await replaceInWorkspace(targetPath, query, replacement, {
      caseSensitive: caseSensitive === true,
      wholeWord: wholeWord === true,
      files: Array.isArray(files) ? files : undefined,
    });

    const success = result.success !== false;
    trackIdeOperation("replace", targetPath, success, {
      queryLength: query.length,
      replacementLength: replacement.length,
      changedFiles: result.changedFiles.length,
      totalReplacements: result.totalReplacements,
    });
    trackFileOperation("write", targetPath || process.cwd(), {
      success,
      queryLength: query.length,
      totalReplacements: result.totalReplacements,
      changedFiles: result.changedFiles.length,
    });

    return result;
  },

  "POST /api/ide/replace/preview": async (body) => {
    const { path, query, replacement, caseSensitive, wholeWord, files, maxFiles } = body as {
      path?: string;
      query?: string;
      replacement?: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      files?: string[];
      maxFiles?: number;
    };
    if (!query || typeof query !== "string") {
      return { success: false, error: "Missing 'query' parameter" };
    }
    if (typeof replacement !== "string") {
      return { success: false, error: "Missing 'replacement' parameter" };
    }

    const targetPath = path || "~";
    const result = await previewReplaceInWorkspace(targetPath, query, replacement, {
      caseSensitive: caseSensitive === true,
      wholeWord: wholeWord === true,
      files: Array.isArray(files) ? files : undefined,
      maxFiles: Number.isFinite(maxFiles) ? maxFiles : undefined,
    });

    const success = result.success !== false;
    trackIdeOperation("replace_preview", targetPath, success, {
      queryLength: query.length,
      replacementLength: replacement.length,
      files: result.files.length,
      totalReplacements: result.totalReplacements,
      truncated: result.truncated,
    });
    trackFileOperation("search", targetPath || process.cwd(), {
      success,
      queryLength: query.length,
      totalReplacements: result.totalReplacements,
      files: result.files.length,
      truncated: result.truncated,
    });

    return result;
  },

  "GET /api/git/status": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    return await getGitStatus(path);
  },

  "GET /api/git/branch": async (_body, params) => {
    const path = (params?.path as string | undefined) || "~";
    const branch = await getGitBranch(path);
    return { branch };
  },

  "GET /api/git/diff": async (_body, params) => {
    const path = params?.path as string | undefined;
    const staged = params?.staged === "true";
    if (!path) {
      return { success: false, error: "Missing 'path' parameter" };
    }
    return await getGitDiff(path, staged);
  },

  "GET /api/channels": () => channelManager.list(),
  "GET /api/channels/available": () =>
    Object.entries(channels).map(([key, value]) => ({
      id: key,
      ...value,
      fields: value.fields,
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
    const data = body as { type?: string; name?: string; config?: Record<string, unknown> };
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
    return { success: channelManager.update(params!.id, { enabled: data.enabled }) };
  },
  "POST /api/channels/:id/test": async (_body, params) => {
    const channel = channelManager.get(params!.id);
    if (!channel) {
      throw new Error("Channel not found");
    }

    const adapter = channelManager.getAdapter(channel.type as keyof typeof channels);
    if (!adapter) {
      return { success: false, error: `No adapter registered for channel type: ${channel.type}` };
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
  "DELETE /api/channels/:id": (_body, params) => ({ success: channelManager.delete(params!.id) }),

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
    return { success: securityManager.removeAllowedSender(params!.id, params!.senderId) };
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
  "DELETE /api/tasks/:id": (_body, params) => ({ success: taskScheduler.delete(params!.id) }),

  "POST /api/webhooks/telegram/:channelId": async (body, params) => {
    const { channelId } = params!;

    const success = await processTelegramWebhook(channelId, body as Record<string, unknown>);
    return { ok: success };
  },

  "POST /api/chat": async (body) => {
    const data = body as {
      message: string;
      agentId?: string;
      sessionId?: string;
      workspaceDir?: string;
      stream?: boolean;
      tools?: boolean;
      images?: Array<{ data?: string; url?: string; mimeType?: string }>;
    };
    return await handleChat(data);
  },
  "POST /api/speech/dictate": async (body) => {
    const data = body as {
      audioBase64?: string;
      mimeType?: string;
      fileName?: string;
      model?: string;
      providerId?: string;
    };

    if (!data.audioBase64 || typeof data.audioBase64 !== "string") {
      throw new Error("Validation error: audioBase64 is required");
    }

    const fallbackMimeType =
      typeof data.mimeType === "string" && data.mimeType.trim()
        ? data.mimeType.trim()
        : "audio/webm";
    const decoded = decodeDictationAudioBase64(data.audioBase64, fallbackMimeType);
    const provider = pickDictationProvider(
      typeof data.providerId === "string" && data.providerId.trim()
        ? data.providerId.trim()
        : undefined
    );
    const result = await transcribeWithOpenAICompatibleProvider({
      provider,
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      fileName:
        typeof data.fileName === "string" && data.fileName.trim()
          ? data.fileName.trim()
          : "dictation.webm",
      model: typeof data.model === "string" ? data.model.trim() : undefined,
    });

    return {
      success: true,
      text: result.text,
      providerId: provider.id,
      providerType: provider.provider,
      model: result.model,
    };
  },
  "GET /api/chat/sessions": () => listSessions(),
  "GET /api/chat/sessions/:id": async (_body, params) => {
    const session = await getSession(params!.id);
    if (!session) return session;
    const sessionObj = session as Record<string, unknown>;
    return {
      ...session,
      messages: Array.isArray(session.messages)
        ? sanitizeSessionMessages(session.messages)
        : session.messages,
      messagesList: Array.isArray(sessionObj.messagesList)
        ? sanitizeSessionMessages(sessionObj.messagesList as SessionMessageView[])
        : undefined,
    };
  },
  "GET /api/chat/sessions/:id/messages": async (_body, params) => {
    const messages = await getSessionMessages(params!.id);
    return sanitizeSessionMessages(messages);
  },
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
  "GET /api/skills/categories": () => getSkillCategories(),
  "GET /api/skills/status": async () => {
    const homeDir = process.env.HOME || homedir();
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
        install: s.install,
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

    const results = await registryManager.searchAll(query, { registry, dedupe, limit });
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

    const results = await registryManager.browseAll({ registry, dedupe, limit, maxPages, sort });
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
    const result = await registryManager.install(slug, { registry, allowSuspicious });
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
  "GET /api/plugins": (_body, params) => {
    const workspaceDir = typeof params?.workspaceDir === "string" ? params.workspaceDir : undefined;
    return {
      plugins: listInstalledPlugins({ workspaceDir }).map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author,
        homepage: plugin.manifest.homepage,
        source: plugin.source,
        rootDir: plugin.rootDir,
        skillDirs: plugin.skillDirs,
        skillCount: plugin.skillDirs.length,
      })),
    };
  },
  "GET /api/plugins/validate": (_body, params) => {
    const targetPath = typeof params?.path === "string" ? params.path.trim() : "";
    if (!targetPath) {
      throw new Error("Plugin path is required");
    }
    return validatePluginAtPath(targetPath);
  },
  "POST /api/plugins/install": (body) => {
    const { path } = body as { path?: string };
    if (!path || !path.trim()) {
      throw new Error("Plugin path is required");
    }
    const plugin = installLocalPluginFromPath(path);
    clearSkillsCache();
    return {
      success: true,
      plugin: {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        source: plugin.source,
        skillDirs: plugin.skillDirs,
      },
    };
  },
  "DELETE /api/plugins/:id": (_body, params) => {
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
      return {
        id: session.id,
        agent_id: session.agentId,
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
    const MAX_CONTENT_SIZE = includeFullToolCalls ? 0 : 10000;
    const sanitizedMessages = sanitizeSessionMessages(messages, {
      maxToolCalls: includeFullToolCalls ? 0 : 50,
      includeFullToolCalls,
    }).map((m) => {
      const truncatedContent =
        MAX_CONTENT_SIZE > 0 && typeof m.content === "string" && m.content.length > MAX_CONTENT_SIZE
          ? m.content.slice(0, MAX_CONTENT_SIZE) +
            `\n\n... [content truncated, ${m.content.length - MAX_CONTENT_SIZE} chars omitted]`
          : m.content;
      return {
        ...m,
        content: truncatedContent,
        timestamp: normalizeTimestamp(m.timestamp),
      };
    });

    return {
      id: session.id,
      agent_id: session.agentId,
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
      pinned: "pinned" in session && session.pinned === true,
      workspace_dir:
        "workspaceDir" in session && typeof session.workspaceDir === "string"
          ? session.workspaceDir
          : null,
      messagesList: sanitizedMessages,
    };
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
      return { success: true, sessionId: params!.sessionId, pinned: result.pinned };
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
      const MAX_CONTENT_SIZE = 10000;
      const sanitizedMessages = sanitizeSessionMessages(reverted.messages).map((m) => {
        const truncatedContent =
          typeof m.content === "string" && m.content.length > MAX_CONTENT_SIZE
            ? m.content.slice(0, MAX_CONTENT_SIZE) +
              `\n\n... [content truncated, ${m.content.length - MAX_CONTENT_SIZE} chars omitted]`
            : m.content;
        return {
          ...m,
          content: truncatedContent,
          timestamp: normalizeTimestamp(m.timestamp),
        };
      });

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
      label?: string;
      agentId?: string;
    };
    if (!data.task) {
      return { error: "task is required", success: false };
    }

    const result = await handleSessionsSpawn({
      task: data.task,
      model: data.model,
      timeoutSeconds: data.timeout,
      label: data.label,
      agentId: data.agentId,
      _requesterSessionKey: "main", // API spawns are from main
    });

    return {
      success: result.status === "accepted",
      subagentId: result.runId,
      sessionKey: result.childSessionKey,
      status: result.status,
      warning: result.warning,
    };
  },
  "GET /api/subagents": () => {
    const runs = subagentRegistry.listAllRuns();
    return runs.map((run) => ({
      id: run.runId,
      label: run.label || run.task.slice(0, 50),
      status:
        run.outcome?.status === "ok"
          ? "completed"
          : run.outcome?.status === "error"
            ? "failed"
            : run.outcome?.status === "timeout"
              ? "timeout"
              : run.startedAt
                ? "running"
                : "pending",
      createdAt: new Date(run.createdAt).toISOString(),
      task: run.task.slice(0, 200),
      sessionKey: run.childSessionKey,
    }));
  },
  "GET /api/subagents/:id": (_body, params) => {
    const run = subagentRegistry.getRun(params!.id);
    if (!run) return { error: "Subagent not found" };
    return {
      id: run.runId,
      label: run.label || run.task.slice(0, 50),
      status:
        run.outcome?.status === "ok"
          ? "completed"
          : run.outcome?.status === "error"
            ? "failed"
            : run.outcome?.status === "timeout"
              ? "timeout"
              : run.startedAt
                ? "running"
                : "pending",
      createdAt: new Date(run.createdAt).toISOString(),
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : undefined,
      endedAt: run.endedAt ? new Date(run.endedAt).toISOString() : undefined,
      task: run.task,
      sessionKey: run.childSessionKey,
      outcome: run.outcome,
    };
  },
  "POST /api/subagents/:id/kill": (_body, params) => {
    const released = subagentRegistry.releaseSubagentRun(params!.id);
    return { success: released, message: released ? "Subagent killed" : "Subagent not found" };
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
    const homeDir = process.env.HOME || homedir();
    const preview = buildSystemPrompt({
      modelDisplay: "MiniMax-M2.1",
      tools: [
        "read",
        "write",
        "artifacts",
        "exec",
        "browser",
        "wallet",
        "memory_search",
        "memory_get",
        "message",
        "sessions_spawn",
      ],
      workspaceDir: homeDir,
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

  "GET /api/browser/status": async () => {
    const getStatus = pwManager.getStatus;
    return await getStatus();
  },
  "GET /api/browser/tabs": async () => {
    const getAllPages = pwManager.getAllPages;
    return { tabs: await getAllPages() };
  },
  "POST /api/browser/tabs": async () => {
    const createPage = pwManager.createPage;
    const id = await createPage();
    return { success: true, data: { id } };
  },
  "DELETE /api/browser/tabs/:id": async (_body, params) => {
    const closePage = pwManager.closePage;
    const closed = await closePage(params!.id);
    if (!closed) return { error: "Page not found" };
    return { success: true, message: "Page closed" };
  },
  "POST /api/browser/tabs/:id/navigate": async (body, params) => {
    const navigate = pwManager.navigate;
    const { url, waitUntil } = body as {
      url: string;
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
    };
    if (!url) return { error: "URL is required" };
    const result = await navigate(params!.id, url, { waitUntil });
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/snapshot": async (_body, params) => {
    const getSnapshot = pwManager.getSnapshot;
    const result = await getSnapshot(params!.id);
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/screenshot": async (_body, params) => {
    const screenshot = pwManager.screenshot;
    const screenshotBuffer = await screenshot(params!.id, { fullPage: true });
    return {
      success: true,
      data: {
        screenshot: screenshotBuffer.toString("base64"),
        contentType: "image/png",
      },
    };
  },
  "POST /api/browser/tabs/:id/click": async (body, params) => {
    const click = pwManager.click;
    const { selector, button, doubleClick } = body as {
      selector: string;
      button?: "left" | "right" | "middle";
      doubleClick?: boolean;
    };
    if (!selector) return { error: "Selector is required" };
    await click(params!.id, selector, { button, doubleClick });
    return { success: true, message: "Clicked element" };
  },
  "POST /api/browser/tabs/:id/type": async (body, params) => {
    const type = pwManager.type;
    const { selector, text, submit, clear } = body as {
      selector: string;
      text: string;
      submit?: boolean;
      clear?: boolean;
    };
    if (!selector || typeof text !== "string") return { error: "Selector and text are required" };
    await type(params!.id, selector, text, { submit, clear });
    return { success: true, message: "Typed text" };
  },
  "POST /api/browser/close": async () => {
    const closeAll = pwManager.closeAll;
    await closeAll();
    return { success: true, message: "Browser closed" };
  },

  "GET /api/status/sessions": (_body, params) => {
    const sessionId =
      typeof params?.sessionId === "string" && params.sessionId.trim().length > 0
        ? params.sessionId.trim()
        : null;
    const activeSnapshots = listSessionStatusSnapshots();

    if (sessionId) {
      const snapshot = getSessionStatusSnapshot(sessionId);
      return {
        sessionId,
        active: snapshot ? isSessionStatusActive(snapshot.status) : false,
        session: snapshot,
        activeSessionIds: activeSnapshots.map((entry) => entry.sessionId),
      };
    }

    return {
      activeSessions: activeSnapshots,
      activeSessionIds: activeSnapshots.map((entry) => entry.sessionId),
      count: activeSnapshots.length,
    };
  },

  "GET /api/system/status": () => {
    const metrics = tables.metrics;
    const lastActivity = (metrics.getByType("system_status") as MetricsEntry[]).find(
      (s) => s.key === "last_activity"
    );
    const lastActivityTime = lastActivity?.value ?? 0;
    const now = Date.now();
    const isThinking = lastActivityTime > 0 && now - lastActivityTime < 30000; // 30 second window
    const agentCount = agentManager.list().length;
    return {
      status: isThinking ? "thinking" : "idle",
      lastActivity: lastActivityTime,
      agentCount,
      timestamp: now,
      resources: getSystemMonitorSnapshot(),
    };
  },

  "GET /api/system/monitor": () => getSystemMonitorSnapshot(),

  "GET /api/metrics/overview": () => {
    const metrics = tables.metrics;
    const tokenTotals = {
      total:
        (metrics.getTotal("token_usage", "input") || 0) +
        (metrics.getTotal("token_usage", "output") || 0) +
        (metrics.getTotal("token_usage", "cache") || 0),
      input: metrics.getTotal("token_usage", "input") || 0,
      output: metrics.getTotal("token_usage", "output") || 0,
      cache: metrics.getTotal("token_usage", "cache") || 0,
    };
    const fileStats = {
      filesRead: metrics.getTotal("file_operation", "read") || 0,
      filesWritten: metrics.getTotal("file_operation", "write") || 0,
      filesEdited: metrics.getTotal("file_operation", "edit") || 0,
      filesSearched: metrics.getTotal("file_operation", "search") || 0,
    };
    const toolCallEntries = (metrics.getByType("tool_call") || []) as MetricsEntry[];
    const totalToolCalls = toolCallEntries.reduce((sum, entry) => sum + (entry.value || 0), 0);
    const apiStats = {
      totalCalls:
        (metrics.getTotal("api_call", "success") || 0) +
        (metrics.getTotal("api_call", "error") || 0),
      successfulCalls: metrics.getTotal("api_call", "success") || 0,
      failedCalls: metrics.getTotal("api_call", "error") || 0,
    };
    const agentStats = {
      totalExecutions:
        (metrics.getTotal("agent_execution", "all") || 0) +
        (metrics.getTotal("agent_execution", "message") || 0),
      totalMessages: metrics.getTotal("agent_execution", "message") || 0,
    };
    const sessionStats = {
      totalSessions: metrics.getTotal("session_event", "created") || 0,
      memoryFlushes: metrics.getTotal("memory_flush", "success") || 0,
      memoryFlushFailures: metrics.getTotal("memory_flush", "failure") || 0,
      compactions: metrics.getTotal("context_compaction", "tokens") || 0,
    };
    const contextWarnings = (metrics.getByType("context_warning") || []) as MetricsEntry[];
    const contextStats = {
      warnings: contextWarnings.length,
      criticalWarnings: contextWarnings.filter((w) => {
        try {
          const meta = w.metadata ? (JSON.parse(w.metadata) as { level?: string }) : undefined;
          return meta?.level === "critical";
        } catch {
          return false;
        }
      }).length,
    };
    return {
      tokenUsage: tokenTotals,
      fileOperations: fileStats,
      toolCalls: { totalCalls: totalToolCalls },
      apiCalls: apiStats,
      agentActivity: agentStats,
      sessions: sessionStats,
      contextHealth: contextStats,
    };
  },

  "GET /api/metrics/storage": () => buildStorageMetrics(),

  "GET /api/metrics/tokens": () => {
    const metrics = tables.metrics;

    const topModels = metrics.getTopKeys("token_usage_by_model") as MetricTopKey[];
    const topProviders = metrics.getTopKeys("token_usage_by_provider") as MetricTopKey[];
    const recentTokens = metrics.getByType("token_usage") as MetricsEntry[];

    const inputTokens = metrics.getTotal("token_usage", "input") || 0;
    const outputTokens = metrics.getTotal("token_usage", "output") || 0;
    const totalTokens = inputTokens + outputTokens;

    return {
      topModels: topModels.map((m) => ({
        model: m.key,
        tokens: m.total,
      })),
      topProviders: topProviders.map((p) => ({
        provider: p.key,
        tokens: p.total,
      })),
      recentUsage: recentTokens.slice(0, 50).map((t) => ({
        timestamp: t.created_at,
        tokens: t.value,
        metadata: parseMetricMetadata(t.metadata),
      })),
      totalTokens,
      estimatedCost: 0, // Disabled - billing varies too much between providers
    };
  },

  "GET /api/metrics/files": () => {
    const metrics = tables.metrics;

    const topRead = metrics.getTopKeys("file_read") as MetricTopKey[];
    const topWritten = metrics.getTopKeys("file_write") as MetricTopKey[];
    const topEdited = metrics.getTopKeys("file_edit") as MetricTopKey[];
    const recentOperations = metrics.getByType("file_operation") as MetricsEntry[];

    return {
      mostRead: topRead.map((f) => ({
        path: f.key,
        count: f.total,
      })),
      mostWritten: topWritten.map((f) => ({
        path: f.key,
        count: f.total,
      })),
      mostEdited: topEdited.map((f) => ({
        path: f.key,
        count: f.total,
      })),
      recentOperations: recentOperations.slice(0, 50).map((op) => ({
        timestamp: op.created_at,
        type: op.key,
        value: op.value,
        metadata: parseMetricMetadata(op.metadata),
      })),
    };
  },

  "GET /api/metrics/tools": () => {
    const metrics = tables.metrics;

    const topTools = metrics.getTopKeys("tool_call") as MetricTopKey[];
    const toolErrors = metrics.getTopKeys("tool_error") as MetricTopKey[];
    const recentCalls = metrics.getByType("tool_call") as MetricsEntry[];

    return {
      mostUsed: topTools.map((t) => ({
        tool: t.key,
        calls: t.total,
      })),
      mostErrors: toolErrors.map((t) => ({
        tool: t.key,
        errors: t.total,
      })),
      recentCalls: recentCalls.slice(0, 50).map((call) => ({
        timestamp: call.created_at,
        tool: call.key,
        duration: call.value,
        metadata: parseMetricMetadata(call.metadata),
      })),
    };
  },

  "GET /api/metrics/providers": () => {
    const metrics = tables.metrics;

    const providerTokenEntries = metrics.getByType("token_usage_by_provider") as MetricsEntry[];

    const providerMap = new Map<string, ProviderMetricSummary>();

    for (const entry of providerTokenEntries) {
      if (entry.key === "all" || entry.key === "input" || entry.key === "output") continue;

      const metadata = parseMetricMetadata(entry.metadata);
      const url = typeof metadata?.url === "string" ? metadata.url : "unknown";

      providerMap.set(entry.key, {
        provider: entry.key,
        hits: 0,
        tokens: entry.value || 0,
        url,
      });
    }

    const apiCalls = metrics.getByType("api_call") as MetricsEntry[];
    for (const entry of apiCalls) {
      if (entry.key === "all" || entry.key === "success" || entry.key === "error") continue;

      const metadata = parseMetricMetadata(entry.metadata);
      const url = typeof metadata?.url === "string" ? metadata.url : "unknown";

      if (!providerMap.has(entry.key)) {
        providerMap.set(entry.key, {
          provider: entry.key,
          hits: entry.value || 0,
          tokens: 0,
          url,
        });
      } else {
        const summary = providerMap.get(entry.key);
        if (!summary) continue;

        if (url !== "unknown") {
          summary.url = url;
        }
        summary.hits += entry.value || 0;
      }
    }

    return {
      providers: Array.from(providerMap.values()).map((p) => ({
        provider: p.provider,
        url: p.url,
        hits: p.hits,
        tokens: p.tokens,
      })),
    };
  },

  "GET /api/metrics/time-series": () => {
    const days: Array<Record<string, string | number>> = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      let dailyTotals = tables.metrics.getDailyTotals(dateStr) as Array<{
        type: string;
        total: number;
      }>;

      if (dailyTotals.length === 0) {
        dailyTotals = tables.metrics.getDailyTotalsFromRaw(dateStr);
      }

      const dayData: Record<string, string | number> = { date: dateStr };
      for (const total of dailyTotals) {
        dayData[total.type] = total.total;
      }

      const hasMetricData = Object.keys(dayData).some((k) => k !== "date");
      if (!hasMetricData) {
        try {
          const logCounts = getDailyLogCounts(dateStr);
          const totalActivity =
            logCounts.systemCount + logCounts.channelCount + logCounts.messageCount;

          if (totalActivity > 0) {
            dayData["activity"] = totalActivity;
            dayData["messages"] = logCounts.messageCount;
            dayData["channel_events"] = logCounts.channelCount;
          }
        } catch {
          // Tables might not exist, ignore
        }
      }

      days.push(dayData);
    }

    return { days };
  },

  "GET /api/metrics/models": () => ({ models: getModelMetrics() }),

  "GET /api/metrics/insights": () => {
    const metrics = tables.metrics;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const last24hStart = now - dayMs;
    const prev24hStart = now - dayMs * 2;

    const inputTokens = metrics.getTotal("token_usage", "input") || 0;
    const outputTokens = metrics.getTotal("token_usage", "output") || 0;
    const cacheTokens = metrics.getTotal("token_usage", "cache") || 0;
    const totalTokens = inputTokens + outputTokens + cacheTokens;

    const tokenUsageEntries = metrics.getByType("token_usage") as MetricsEntry[];
    const tokenAllLast24h = sumMetricValues(
      tokenUsageEntries,
      (entry, timestampMs) =>
        entry.key === "all" &&
        timestampMs !== null &&
        timestampMs >= last24hStart &&
        timestampMs < now
    );
    const tokenAllPrevious24h = sumMetricValues(
      tokenUsageEntries,
      (entry, timestampMs) =>
        entry.key === "all" &&
        timestampMs !== null &&
        timestampMs >= prev24hStart &&
        timestampMs < last24hStart
    );

    const modelTotals = metrics.getTopKeys("token_usage_by_model") as MetricTopKey[];
    const topModel = modelTotals[0];
    const topModelSharePct =
      topModel && totalTokens > 0 ? Number(((topModel.total / totalTokens) * 100).toFixed(2)) : 0;

    const providerTokenEntries = metrics.getByType("token_usage_by_provider") as MetricsEntry[];
    const providerApiEntries = metrics.getByType("api_call") as MetricsEntry[];
    const providerMap = new Map<string, { provider: string; tokens: number; calls: number }>();

    for (const entry of providerTokenEntries) {
      const provider = entry.key;
      if (!provider || provider === "all" || provider === "input" || provider === "output")
        continue;
      const current = providerMap.get(provider) || { provider, tokens: 0, calls: 0 };
      current.tokens += entry.value || 0;
      current.calls += 1;
      providerMap.set(provider, current);
    }

    for (const entry of providerApiEntries) {
      const provider = entry.key;
      if (!provider || provider === "all" || provider === "success" || provider === "error")
        continue;
      const current = providerMap.get(provider) || { provider, tokens: 0, calls: 0 };
      current.calls += entry.value || 0;
      providerMap.set(provider, current);
    }

    const providerEfficiency = Array.from(providerMap.values())
      .map((entry) => ({
        provider: entry.provider,
        tokens: entry.tokens,
        calls: entry.calls,
        tokensPerCall: entry.calls > 0 ? Number((entry.tokens / entry.calls).toFixed(2)) : 0,
        sharePct: totalTokens > 0 ? Number(((entry.tokens / totalTokens) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens);

    const toolCallEntries = (metrics.getByType("tool_call") as MetricsEntry[]).filter(
      (entry) => entry.key !== "all"
    );
    const toolErrorEntries = metrics.getByType("tool_error") as MetricsEntry[];
    const totalToolCalls = toolCallEntries.reduce((sum, entry) => sum + (entry.value || 0), 0);
    const totalToolErrors = toolErrorEntries.reduce((sum, entry) => sum + (entry.value || 0), 0);
    const toolSuccessRatePct =
      totalToolCalls > 0
        ? Number((((totalToolCalls - totalToolErrors) / totalToolCalls) * 100).toFixed(2))
        : 100;

    const toolUsage24hMap = new Map<string, number>();
    for (const entry of toolCallEntries) {
      const timestampMs = metricTimestampToMs(entry.created_at);
      if (timestampMs === null || timestampMs < last24hStart) continue;
      toolUsage24hMap.set(entry.key, (toolUsage24hMap.get(entry.key) || 0) + (entry.value || 0));
    }
    const toolUsage24h = Array.from(toolUsage24hMap.entries())
      .map(([tool, calls]) => ({ tool, calls }))
      .sort((a, b) => b.calls - a.calls);

    const modelInsightMap = new Map<
      string,
      {
        model: string;
        provider: string;
        avgTps: number;
        maxTps: number;
        minTps: number;
        avgLatencyMs: number;
        totalTokens: number;
        callCount: number;
      }
    >();

    for (const modelMetric of getModelMetrics()) {
      modelInsightMap.set(modelMetric.model, { ...modelMetric });
    }

    for (const topModelEntry of modelTotals) {
      const existing = modelInsightMap.get(topModelEntry.key);
      if (existing) {
        existing.totalTokens = Math.max(existing.totalTokens, topModelEntry.total);
      } else {
        modelInsightMap.set(topModelEntry.key, {
          model: topModelEntry.key,
          provider: "unknown",
          avgTps: 0,
          maxTps: 0,
          minTps: 0,
          avgLatencyMs: 0,
          totalTokens: topModelEntry.total,
          callCount: 0,
        });
      }
    }

    const modelInsights = Array.from(modelInsightMap.values())
      .map((model) => ({
        ...model,
        tokenSharePct:
          totalTokens > 0 ? Number(((model.totalTokens / totalTokens) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const contextWarningEntries = metrics.getByType("context_warning") as MetricsEntry[];
    let contextWarnings24h = 0;
    let criticalContextWarnings24h = 0;
    for (const entry of contextWarningEntries) {
      const timestampMs = metricTimestampToMs(entry.created_at);
      if (timestampMs === null || timestampMs < last24hStart) continue;
      contextWarnings24h += 1;
      const metadata = parseMetricMetadata(entry.metadata);
      if (metadata?.level === "critical") {
        criticalContextWarnings24h += 1;
      }
    }

    return {
      tokenBreakdown: {
        total: totalTokens,
        input: inputTokens,
        output: outputTokens,
        cache: cacheTokens,
        inputPct: totalTokens > 0 ? Number(((inputTokens / totalTokens) * 100).toFixed(2)) : 0,
        outputPct: totalTokens > 0 ? Number(((outputTokens / totalTokens) * 100).toFixed(2)) : 0,
        cachePct: totalTokens > 0 ? Number(((cacheTokens / totalTokens) * 100).toFixed(2)) : 0,
      },
      tokenTrend24h: buildMetricTrend(tokenAllLast24h, tokenAllPrevious24h),
      cacheEfficiency: {
        cacheTokens,
        cacheSharePct: totalTokens > 0 ? Number(((cacheTokens / totalTokens) * 100).toFixed(2)) : 0,
      },
      topModel:
        topModel && topModel.key
          ? {
              model: topModel.key,
              tokens: topModel.total,
              sharePct: topModelSharePct,
            }
          : null,
      providerEfficiency,
      modelInsights,
      toolReliability: {
        totalCalls: totalToolCalls,
        totalErrors: totalToolErrors,
        successRatePct: toolSuccessRatePct,
      },
      toolUsage24h,
      contextHealth24h: {
        warnings: contextWarnings24h,
        criticalWarnings: criticalContextWarnings24h,
      },
    };
  },

  "GET /api/metrics/token-analysis": () => {
    const metrics = tables.metrics;
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;

    const tokenUsageEntries = metrics.getByType("token_usage") as MetricsEntry[];
    const tokenCallSnapshots = buildTokenCallSnapshots(tokenUsageEntries);
    const tokenCalls = tokenCallSnapshots.filter(
      (entry) => entry.totalTokens > 0 || entry.inputTokens > 0 || entry.outputTokens > 0
    );

    const totalInput = tokenCalls.reduce((sum, entry) => sum + entry.inputTokens, 0);
    const totalOutput = tokenCalls.reduce((sum, entry) => sum + entry.outputTokens, 0);
    const totalTokens = tokenCalls.reduce((sum, entry) => sum + entry.totalTokens, 0);
    const callCount = tokenCalls.length;
    const averageTokensPerCall = callCount > 0 ? Number((totalTokens / callCount).toFixed(2)) : 0;

    const sortedCallTotals = tokenCalls.map((entry) => entry.totalTokens).sort((a, b) => a - b);
    const medianTokensPerCall =
      sortedCallTotals.length === 0
        ? 0
        : sortedCallTotals.length % 2 === 1
          ? sortedCallTotals[(sortedCallTotals.length - 1) / 2]!
          : Number(
              (
                (sortedCallTotals[sortedCallTotals.length / 2 - 1]! +
                  sortedCallTotals[sortedCallTotals.length / 2]!) /
                2
              ).toFixed(2)
            );

    const ratioBands = [
      { band: "very_input_heavy", min: 4, max: Number.POSITIVE_INFINITY, calls: 0 },
      { band: "input_heavy", min: 2, max: 4, calls: 0 },
      { band: "balanced", min: 0.75, max: 2, calls: 0 },
      { band: "output_heavy", min: 0.35, max: 0.75, calls: 0 },
      { band: "very_output_heavy", min: 0, max: 0.35, calls: 0 },
    ];

    let ratioSampleCount = 0;
    for (const entry of tokenCalls) {
      if (entry.inputTokens <= 0 && entry.outputTokens <= 0) continue;
      const ratio = entry.outputTokens > 0 ? entry.inputTokens / entry.outputTokens : Infinity;
      const match =
        ratioBands.find((band) => ratio >= band.min && ratio < band.max) ||
        (ratio === Infinity ? ratioBands[0] : undefined);
      if (match) {
        match.calls += 1;
        ratioSampleCount += 1;
      }
    }

    const startOfHeatmapWindow = new Date();
    startOfHeatmapWindow.setHours(0, 0, 0, 0);
    startOfHeatmapWindow.setDate(startOfHeatmapWindow.getDate() - 6);
    const heatmapStartMs = startOfHeatmapWindow.getTime();

    const heatmapByDate = new Map<
      string,
      { dayLabel: string; hourTotals: number[]; hourCalls: number[] }
    >();
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(startOfHeatmapWindow);
      date.setDate(startOfHeatmapWindow.getDate() + offset);
      const dateKey = localDateKeyFromMs(date.getTime());
      heatmapByDate.set(dateKey, {
        dayLabel: date.toLocaleDateString(undefined, { weekday: "short" }),
        hourTotals: Array.from({ length: 24 }, () => 0),
        hourCalls: Array.from({ length: 24 }, () => 0),
      });
    }

    for (const entry of tokenCalls) {
      if (entry.timestampMs === null || entry.timestampMs < heatmapStartMs) continue;
      const dateKey = localDateKeyFromMs(entry.timestampMs);
      const bucket = heatmapByDate.get(dateKey);
      if (!bucket) continue;
      const hour = new Date(entry.timestampMs).getHours();
      bucket.hourTotals[hour] += entry.totalTokens;
      bucket.hourCalls[hour] += 1;
    }

    let maxHeatmapBucket = 0;
    for (const bucket of heatmapByDate.values()) {
      for (const total of bucket.hourTotals) {
        if (total > maxHeatmapBucket) maxHeatmapBucket = total;
      }
    }

    const heatmapDays = Array.from(heatmapByDate.entries()).map(([date, bucket]) => ({
      date,
      dayLabel: bucket.dayLabel,
      hours: bucket.hourTotals.map((tokens, hour) => ({
        hour,
        tokens,
        calls: bucket.hourCalls[hour] || 0,
        intensity: maxHeatmapBucket > 0 ? Number((tokens / maxHeatmapBucket).toFixed(4)) : 0,
      })),
    }));

    let hottestHour: {
      date: string;
      dayLabel: string;
      hour: number;
      tokens: number;
      calls: number;
    } | null = null;

    for (const day of heatmapDays) {
      for (const hour of day.hours) {
        if (!hottestHour || hour.tokens > hottestHour.tokens) {
          hottestHour = {
            date: day.date,
            dayLabel: day.dayLabel,
            hour: hour.hour,
            tokens: hour.tokens,
            calls: hour.calls,
          };
        }
      }
    }

    const velocityHours = Array.from({ length: 24 }, (_, index) => {
      const end = now - (23 - index) * hourMs;
      const start = end - hourMs;
      let tokens = 0;
      let calls = 0;
      for (const entry of tokenCalls) {
        if (entry.timestampMs === null) continue;
        if (entry.timestampMs >= start && entry.timestampMs < end) {
          tokens += entry.totalTokens;
          calls += 1;
        }
      }

      const labelDate = new Date(end);
      const label = `${String(labelDate.getHours()).padStart(2, "0")}:00`;
      return { hour: label, tokens, calls };
    });

    const modelCloudEntries = (metrics.getTopKeys("token_usage_by_model") as MetricTopKey[]).map(
      (entry) => ({
        token: entry.key,
        category: "model" as const,
        weight: entry.total,
        sharePct: 0,
      })
    );

    const providerCloudEntries = (
      metrics.getTopKeys("token_usage_by_provider") as MetricTopKey[]
    ).map((entry) => ({
      token: entry.key,
      category: "provider" as const,
      weight: Number((entry.total * 0.8).toFixed(2)),
      sharePct: 0,
    }));

    const toolCloudEntries = (metrics.getTopKeys("tool_call") as MetricTopKey[])
      .filter((entry) => entry.key !== "all")
      .map((entry) => ({
        token: entry.key,
        category: "tool" as const,
        weight: Number((entry.total * Math.max(averageTokensPerCall, 1) * 0.6).toFixed(2)),
        sharePct: 0,
      }));

    const recentMessages = tables.sessionMessages.list() as Array<{
      role?: string;
      content?: string;
    }>;
    const assistantMessages = recentMessages.filter(
      (entry) =>
        entry.role === "assistant" &&
        typeof entry.content === "string" &&
        entry.content.trim().length > 0
    );
    const termCloudEntries = buildAssistantOutputCloud(
      assistantMessages,
      totalOutput,
      Math.max(averageTokensPerCall, 1)
    );

    const combinedCloud: TokenCloudEntry[] = [
      ...modelCloudEntries,
      ...providerCloudEntries,
      ...toolCloudEntries,
      ...termCloudEntries,
    ];

    const totalCloudWeight = combinedCloud.reduce((sum, entry) => sum + entry.weight, 0);
    const tokenCloud = combinedCloud
      .map((entry) => ({
        ...entry,
        sharePct:
          totalCloudWeight > 0 ? Number(((entry.weight / totalCloudWeight) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 36);

    const modelBehaviorMap = new Map<
      string,
      {
        model: string;
        provider: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        calls: number;
        durationTotalMs: number;
        durationSamples: number;
      }
    >();

    for (const entry of tokenCalls) {
      const key = `${entry.provider}:${entry.model}`;
      const current = modelBehaviorMap.get(key) || {
        model: entry.model,
        provider: entry.provider,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0,
        durationTotalMs: 0,
        durationSamples: 0,
      };

      current.inputTokens += entry.inputTokens;
      current.outputTokens += entry.outputTokens;
      current.totalTokens += entry.totalTokens;
      current.calls += 1;

      if (entry.durationMs !== null && entry.durationMs > 0) {
        current.durationTotalMs += entry.durationMs;
        current.durationSamples += 1;
      }

      modelBehaviorMap.set(key, current);
    }

    const modelThoughtProfiles = Array.from(modelBehaviorMap.values())
      .map((entry) => {
        const promptSharePct =
          entry.totalTokens > 0
            ? Number(((entry.inputTokens / entry.totalTokens) * 100).toFixed(2))
            : 0;
        const responseSharePct =
          entry.totalTokens > 0
            ? Number(((entry.outputTokens / entry.totalTokens) * 100).toFixed(2))
            : 0;
        const avgTokensPerCall =
          entry.calls > 0 ? Number((entry.totalTokens / entry.calls).toFixed(2)) : 0;
        const avgLatencyMs =
          entry.durationSamples > 0
            ? Number((entry.durationTotalMs / entry.durationSamples).toFixed(2))
            : 0;
        const avgTps =
          entry.durationTotalMs > 0
            ? Number(((entry.outputTokens / entry.durationTotalMs) * 1000).toFixed(2))
            : 0;

        return {
          model: entry.model,
          provider: entry.provider,
          totalTokens: entry.totalTokens,
          calls: entry.calls,
          promptSharePct,
          responseSharePct,
          avgTokensPerCall,
          avgLatencyMs,
          avgTps,
          behavior: classifyModelBehavior(promptSharePct, avgTps, avgLatencyMs, avgTokensPerCall),
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 12);

    const topTokenBursts = [...tokenCalls]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 10)
      .map((entry) => ({
        timestamp: entry.timestamp,
        model: entry.model,
        provider: entry.provider,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.totalTokens,
        durationMs: entry.durationMs,
        tokensPerSecond: entry.tokensPerSecond,
      }));

    return {
      summary: {
        callCount,
        totalTokens,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        averageTokensPerCall,
        medianTokensPerCall,
        inputToOutputRatio: totalOutput > 0 ? Number((totalInput / totalOutput).toFixed(4)) : null,
        outputToInputRatio: totalInput > 0 ? Number((totalOutput / totalInput).toFixed(4)) : null,
      },
      promptOutputDistribution: {
        sampleCount: ratioSampleCount,
        bands: ratioBands.map((band) => ({
          band: band.band,
          calls: band.calls,
          sharePct:
            ratioSampleCount > 0 ? Number(((band.calls / ratioSampleCount) * 100).toFixed(2)) : 0,
        })),
      },
      tokenHeatmap: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
        maxBucketTokens: maxHeatmapBucket,
        hottestHour,
        days: heatmapDays,
      },
      hourlyVelocity24h: velocityHours,
      tokenCloud,
      modelThoughtProfiles,
      topTokenBursts,
      windows: {
        analyzedDays: 7,
        velocityHours: 24,
        newestCallAt: tokenCalls[tokenCalls.length - 1]?.timestamp || null,
        oldestCallAt: tokenCalls[0]?.timestamp || null,
        recent24hTokens: tokenCalls.reduce((sum, entry) => {
          if (entry.timestampMs === null || entry.timestampMs < now - dayMs) return sum;
          return sum + entry.totalTokens;
        }, 0),
      },
    };
  },

  "POST /api/metrics/track": (body) => {
    const data = body as {
      type: string;
      key: string;
      value: number;
      metadata?: Record<string, unknown>;
    };

    if (!data.type || !data.key || data.value === undefined) {
      throw new Error("type, key, and value are required");
    }

    const id = crypto.randomUUID();
    tables.metrics.add({
      id,
      type: data.type,
      key: data.key,
      value: data.value,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    });

    return { success: true, id };
  },
};

cacheMetricsRoutes(routes);

function checkDatabaseHealth(): { status: string; error?: string } {
  try {
    agentManager.list();
    return { status: "healthy" };
  } catch (error) {
    return { status: "unhealthy", error: (error as Error).message };
  }
}

function getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number; rss: number } {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
  };
}

function getSystemMonitorHealth(snapshot = getSystemMonitorSnapshot()): {
  status: string;
  cpuUsagePct: number;
  memoryUsedPct: number;
  diskUsedPct?: number;
} {
  const diskUsedPct = snapshot.disk?.usedPct;
  return {
    status: "healthy",
    cpuUsagePct: snapshot.cpu.usagePct,
    memoryUsedPct: snapshot.memory.usedPct,
    ...(typeof diskUsedPct === "number" ? { diskUsedPct } : {}),
  };
}

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
  ip?: string;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body?: unknown;
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
    log.warn(`Security check failed: ${security.error}`, { path, ip: clientIp });
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
    const result = await routes[routeKey](req.body, params);
    const duration = Date.now() - startTime;
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
      errorMessage.startsWith("Invalid ")
    ) {
      userMessage = errorMessage;
      errorCode = "VALIDATION_ERROR";
      statusCode = 400;
    } else {
      userMessage = "An error occurred while processing your request.";
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
  const keys = Object.keys(routes);
  let bestMatch: {
    routeKey: string;
    params: Record<string, string>;
    dynamicSegments: number;
    staticSegments: number;
  } | null = null;

  for (const key of keys) {
    const [routeMethod, routePath] = key.split(" ");
    if (routeMethod !== method) continue;

    const routeParts = routePath.split("/");
    const actualParts = path.split("/");

    if (routeParts.length !== actualParts.length) continue;

    const localParams: Record<string, string> = {};
    let dynamicSegments = 0;
    let staticSegments = 0;
    let match = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        localParams[routeParts[i].slice(1)] = actualParts[i];
        dynamicSegments += 1;
      } else if (routeParts[i] !== actualParts[i]) {
        match = false;
        break;
      } else {
        staticSegments += 1;
      }
    }

    if (!match) continue;

    if (!bestMatch) {
      bestMatch = { routeKey: key, params: localParams, dynamicSegments, staticSegments };
      continue;
    }

    if (
      dynamicSegments < bestMatch.dynamicSegments ||
      (dynamicSegments === bestMatch.dynamicSegments && staticSegments > bestMatch.staticSegments)
    ) {
      bestMatch = { routeKey: key, params: localParams, dynamicSegments, staticSegments };
    }
  }

  if (!bestMatch) return { routeKey: null, params: {} };
  return { routeKey: bestMatch.routeKey, params: bestMatch.params };
}
