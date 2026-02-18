import { config } from "../core/config";
import { tables } from "../core/database";
import { agentManager, builtinTools } from "../core/agent";
import { providerManager, providers, type ProviderType } from "../core/providers";
import {
  channelManager,
  channels,
  processTelegramWebhook,
  securityManager,
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
  handleChat,
  getSession,
  getSessionMessages,
  listSessions,
  deleteSession,
  getChatRateLimitStatus,
  type ChatMessage,
} from "../api/chat";
import { getToolSchemasForLLM, getCircuitState } from "../core/tools/index";
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
import * as pwManager from "../core/browser/pw-manager";
import { homedir } from "os";
import { securityCheck, validateUrl } from "./security";
import { browseDirectory, readFileContent, writeFileContent, createItem } from "./ide-api";
import { createLogger } from "../core/logger";
import { openUrlInBrowser } from "../core/runtime/open-url";
import {
  walletManager,
  type WalletChain,
  type WalletAgentPolicy,
  type WalletPriceQuoteInput,
  type WalletSwapInput,
  type WalletSwapEthUniswapInput,
  type WalletTokenChain,
  type SolInstructionAccountMeta,
} from "../core/wallet";
import {
  normalizeTimestamp,
  getCombinedLogs,
  getLogStats,
  getDailyLogCounts,
  getModelMetrics,
  type MetricsEntry,
} from "./queries";

const log = createLogger("API");

// OAuth redirect flow state storage
const oauthCallbacks = new Map<
  string,
  { status: string; access_token?: string; refresh_token?: string; error?: string }
>();

interface LspDiagnosticLike {
  severity?: number;
  message?: string;
  source?: string;
  code?: string | number;
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
}

type SessionMessageView = ChatMessage & {
  tool_calls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
    status?: string;
    result?: unknown;
    error?: string;
  }>;
  _truncated?: string;
};

interface MetricTopKey {
  key: string;
  total: number;
}

interface ProviderMetricSummary {
  provider: string;
  hits: number;
  tokens: number;
  url: string;
}

const WALLET_CHAIN_SET = new Set<WalletChain>(["eth", "btc", "sol"]);
const WALLET_TOKEN_CHAIN_SET = new Set<WalletTokenChain>(["eth", "sol"]);

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseMetricMetadata(metadata?: string): Record<string, unknown> | null {
  return parseJsonObject(metadata);
}

function parseWalletChains(input: unknown): WalletChain[] | undefined {
  if (typeof input !== "string" || !input.trim()) return undefined;

  const values = input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!values.length) return undefined;

  const chains: WalletChain[] = [];
  for (const value of values) {
    if (!WALLET_CHAIN_SET.has(value as WalletChain)) {
      throw new Error(`Validation error: Unsupported chain '${value}'`);
    }
    chains.push(value as WalletChain);
  }

  return chains;
}

function parseWalletTokenChain(
  input: unknown,
  fallback: WalletTokenChain = "eth"
): WalletTokenChain {
  const value = String(input || fallback)
    .trim()
    .toLowerCase();
  if (!WALLET_TOKEN_CHAIN_SET.has(value as WalletTokenChain)) {
    throw new Error(
      `Validation error: Unsupported token chain '${value}'. Use one of: ${[...WALLET_TOKEN_CHAIN_SET].join(", ")}`
    );
  }
  return value as WalletTokenChain;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getDefaultSystemPromptConfig(): Record<string, unknown> {
  return {
    template: "default",
    customPrompt: "",
    defaultBasePrompt: "",
    identity: {
      name: "Cybara",
      emoji: "🧠",
      creature: "AI assistant",
      vibe: "Professional, helpful, and concise",
      theme: "dark",
    },
    features: {
      memoryEnabled: true,
      skillsEnabled: true,
      messagingEnabled: true,
      replyTagsEnabled: true,
    },
  };
}

function getDefaultIdentityConfig(): Record<string, unknown> {
  return {
    name: "Cybara",
    emoji: "🧠",
    creature: "AI assistant",
    vibe: "Professional, helpful, and concise",
    theme: "dark",
    avatar: "",
  };
}

function normalizeSystemPromptConfig(value: unknown): Record<string, unknown> {
  const defaults = getDefaultSystemPromptConfig();
  const parsed = parseJsonObject(value);
  if (!parsed) return defaults;

  const defaultIdentity = parseJsonObject(defaults.identity) || {};
  const defaultFeatures = parseJsonObject(defaults.features) || {};
  const parsedIdentity = parseJsonObject(parsed.identity) || {};
  const parsedFeatures = parseJsonObject(parsed.features) || {};

  return {
    ...defaults,
    ...parsed,
    identity: { ...defaultIdentity, ...parsedIdentity },
    features: { ...defaultFeatures, ...parsedFeatures },
  };
}

function normalizeIdentityConfig(value: unknown): Record<string, unknown> {
  const defaults = getDefaultIdentityConfig();
  const parsed = parseJsonObject(value);
  return parsed ? { ...defaults, ...parsed } : defaults;
}

// ============================================
// HELPER: Sanitize session messages for UI
// Truncates large tool results to prevent browser OOM crashes
// ============================================
function sanitizeSessionMessages(messages: SessionMessageView[]): SessionMessageView[] {
  const MAX_RESULT_SIZE = 500;
  const MAX_TOOL_CALLS = 20;

  return messages.map((msg) => {
    if (!msg || !msg.tool_calls || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
      return msg;
    }

    // Limit and truncate tool calls
    const sanitizedToolCalls = msg.tool_calls.slice(0, MAX_TOOL_CALLS).map((tc) => {
      const sanitized = { ...tc };

      // Truncate result
      if (tc.result !== undefined) {
        try {
          const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
          sanitized.result =
            resultStr.length > MAX_RESULT_SIZE
              ? resultStr.slice(0, MAX_RESULT_SIZE) + "... [truncated]"
              : tc.result;
        } catch {
          sanitized.result = "[Result too large to display]";
        }
      }

      // Truncate error
      if (tc.error && typeof tc.error === "string" && tc.error.length > 200) {
        sanitized.error = tc.error.slice(0, 200) + "...";
      }

      return sanitized;
    });

    return {
      ...msg,
      tool_calls: sanitizedToolCalls,
      _truncated:
        msg.tool_calls.length > MAX_TOOL_CALLS
          ? `Showing ${MAX_TOOL_CALLS} of ${msg.tool_calls.length} tool calls`
          : undefined,
    };
  });
}

// ============================================
// REQUEST/RESPONSE LOGGING
// ============================================

interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}

// Types are now imported from ./queries
// CountResult, ValueResult, MetricsEntry, LogEntry, AgentLogEntry, ChannelLogEntry
// normalizeTimestamp utility is also imported from ./queries

const requestLogs: RequestLog[] = [];
const MAX_LOGS = 1000;

function logRequest(log: RequestLog): void {
  requestLogs.unshift(log);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.pop();
  }

  // Console log for production monitoring
  const logLevel = log.status >= 500 ? "error" : log.status >= 400 ? "warn" : "info";
  console[logLevel](
    `[API] ${log.method} ${log.path} ${log.status} ${log.durationMs}ms${log.error ? ` - ${log.error}` : ""}`
  );
}

// ============================================
// CORS & SECURITY HEADERS
// ============================================

// In production, restrict CORS to same-origin. In dev, allow all.
const isProduction = process.env.NODE_ENV === "production";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": isProduction ? "" : "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

// Security headers applied to all responses
const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// ============================================
// ROUTES
// ============================================

type RouteHandler = (body?: unknown, params?: Record<string, string>) => Promise<unknown> | unknown;

const routes: Record<string, RouteHandler> = {
  // ===== HEALTH & STATUS =====
  "GET /api/health": () => {
    const now = new Date();
    return {
      status: "healthy",
      timestamp: now.toISOString(),
      uptime: process.uptime(),
      version: "1.0.0",
      checks: {
        database: checkDatabaseHealth(),
        agents: agentManager.getStats(),
        providers: providerManager.getStats(),
        memory: getMemoryUsage(),
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

  // ===== INFO =====
  "GET /api/info": () => ({
    name: "Cybara",
    version: "1.0.0",
    setupComplete: config.isSetupComplete(),
    stats: {
      agents: agentManager.getStats(),
      providers: providerManager.getStats(),
      channels: channelManager.getStats(),
      tasks: taskScheduler.getStats(),
    },
  }),

  // ===== SETUP =====
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

  // ===== WALLET =====
  "GET /api/wallet/status": () => walletManager.getStatus(),
  "GET /api/wallet/rpc": () => walletManager.getRpcConfig(),
  "GET /api/wallet/rpc/status": async () => await walletManager.getRpcStatus(),
  "PUT /api/wallet/rpc": (body) => {
    const data = body as { ethRpc?: string; solRpc?: string; btcApi?: string };
    return walletManager.setRpcConfig({
      ethRpc: data.ethRpc,
      solRpc: data.solRpc,
      btcApi: data.btcApi,
    });
  },
  "GET /api/wallet/agent-policy": () => walletManager.getAgentPolicy(),
  "PUT /api/wallet/agent-policy": (body) => {
    const data = (body || {}) as Partial<WalletAgentPolicy>;
    return walletManager.setAgentPolicy({
      allowNativeSend: data.allowNativeSend,
      allowTokenSend: data.allowTokenSend,
      allowEthContractWrite: data.allowEthContractWrite,
      allowSolProgramInstruction: data.allowSolProgramInstruction,
      allowEthSwaps: data.allowEthSwaps,
      allowedEthContracts: Array.isArray(data.allowedEthContracts)
        ? data.allowedEthContracts
        : undefined,
      allowedSolPrograms: Array.isArray(data.allowedSolPrograms)
        ? data.allowedSolPrograms
        : undefined,
    });
  },
  "POST /api/wallet/create": async (body) => {
    const data = body as { password?: string };
    return await walletManager.createWallet(data.password || "");
  },
  "POST /api/wallet/import": async (body) => {
    const data = body as { mnemonic?: string; password?: string };
    return await walletManager.importWallet(data.mnemonic || "", data.password || "");
  },
  "POST /api/wallet/unlock": async (body) => {
    const data = body as { password?: string };
    return await walletManager.unlock(data.password || "");
  },
  "POST /api/wallet/lock": () => walletManager.lock(),
  "GET /api/wallet/accounts": (_body, params) => {
    const count = params?.count ? Number(params.count) : undefined;
    const startIndex = params?.startIndex ? Number(params.startIndex) : undefined;
    const chains = parseWalletChains(params?.chains);
    return walletManager.getAccounts({ chains, count, startIndex });
  },
  "GET /api/wallet/receive": (_body, params) => {
    const chain = String(params?.chain || "eth").toLowerCase();
    const index = params?.index ? Number(params.index) : 0;
    return walletManager.getReceiveAddress(chain as WalletChain, index);
  },
  "GET /api/wallet/balances": async (_body, params) => {
    const count = params?.count ? Number(params.count) : undefined;
    const startIndex = params?.startIndex ? Number(params.startIndex) : undefined;
    const chains = parseWalletChains(params?.chains);
    return await walletManager.getBalances({ chains, count, startIndex });
  },
  "GET /api/wallet/tokens": async (_body, params) => {
    const chain = parseWalletTokenChain(params?.chain, "eth");
    const index = params?.index ? Number(params.index) : 0;
    const includeZero = String(params?.includeZero || "").toLowerCase() === "true";
    return await walletManager.getTokenBalances({
      chain,
      index,
      includeZero,
    });
  },
  "GET /api/wallet/token-transactions": async (_body, params) => {
    const chain = parseWalletTokenChain(params?.chain, "eth");
    const index = params?.index ? Number(params.index) : 0;
    const limit = params?.limit ? Number(params.limit) : undefined;
    const tokenAddress = params?.tokenAddress;
    const rpcUrl = params?.rpcUrl;

    return await walletManager.getTokenTransactions({
      chain,
      index,
      limit,
      tokenAddress,
      rpcUrl,
    });
  },
  "GET /api/wallet/transactions": async (_body, params) => {
    const chain = String(params?.chain || "").toLowerCase();
    if (!chain) {
      throw new Error("Validation error: chain is required");
    }
    const index = params?.index ? Number(params.index) : 0;
    const limit = params?.limit ? Number(params.limit) : undefined;
    const rpcUrl = params?.rpcUrl;
    return await walletManager.getTransactions({
      chain: chain as WalletChain,
      index,
      limit,
      rpcUrl,
    });
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
    return await walletManager.send({
      chain: String(data.chain || "").toLowerCase() as WalletChain,
      to: data.to || "",
      amount: data.amount || "",
      index: data.index,
      memo: data.memo,
      rpcUrl: data.rpcUrl,
      feeRate: data.feeRate,
    });
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

    return await walletManager.sendToken({
      chain: parseWalletTokenChain(data.chain, "eth"),
      tokenAddress: String(data.tokenAddress || data.mint || "").trim(),
      to: String(data.to || "").trim(),
      amount: String(data.amount || "").trim(),
      index: data.index,
      decimals: data.decimals,
      rpcUrl: data.rpcUrl,
      memo: data.memo,
    });
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
    return await walletManager.callEthContract({
      contractAddress: String(data.contractAddress || ""),
      abi: typeof data.abi === "string" ? data.abi : undefined,
      method: String(data.method || data.methodSignature || ""),
      methodSignature: typeof data.methodSignature === "string" ? data.methodSignature : undefined,
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
    });
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

    return await walletManager.sendSolProgramInstruction({
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
    });
  },
  "POST /api/wallet/swap-eth-uniswap": async (body) => {
    const data = (body || {}) as Partial<WalletSwapEthUniswapInput>;
    return await walletManager.swapEthOnUniswap({
      tokenOut: String(data.tokenOut || ""),
      amountEth: typeof data.amountEth === "string" ? data.amountEth : undefined,
      percent: typeof data.percent === "number" ? data.percent : undefined,
      minAmountOut: typeof data.minAmountOut === "string" ? data.minAmountOut : undefined,
      slippageBps: typeof data.slippageBps === "number" ? data.slippageBps : undefined,
      deadlineSeconds: typeof data.deadlineSeconds === "number" ? data.deadlineSeconds : undefined,
      index: typeof data.index === "number" ? data.index : undefined,
      recipient: typeof data.recipient === "string" ? data.recipient : undefined,
      rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
      dryRun: data.dryRun === true,
    });
  },
  "POST /api/wallet/price": async (body) => {
    const data = (body || {}) as Partial<WalletPriceQuoteInput> & {
      feedId?: string;
    };
    return await walletManager.getPriceQuote({
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
    });
  },
  "POST /api/wallet/swap": async (body) => {
    const data = (body || {}) as Partial<WalletSwapInput> & {
      tokenAddress?: string;
    };
    return await walletManager.swap({
      venue:
        data.venue === "uniswap_v2" || data.venue === "uniswap_v3" || data.venue === "jupiter"
          ? data.venue
          : "uniswap_v2",
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
      dryRun: data.dryRun === true,
    });
  },
  "POST /api/wallet/sign": async (body) => {
    const data = body as { message?: string; chain?: string; index?: number };
    return await walletManager.signMessage(
      data.message || "",
      (data.chain || "eth") as WalletChain,
      data.index || 0
    );
  },
  "DELETE /api/wallet": async (body) => {
    const data = (body || {}) as { password?: string };
    return await walletManager.deleteWallet(data.password);
  },
  "PUT /api/wallet/agent-access": (body) => {
    const data = body as { enabled?: boolean };
    return walletManager.setAgentAccessEnabled(data.enabled === true);
  },

  // ===== CONFIG =====
  "GET /api/config": () => config.getAll(),
  "PUT /api/config": (body) => {
    const data = body as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      config.set(key, value);
    }
    return { success: true };
  },

  // ===== AGENTS =====
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

  // Running agent messaging and history
  "POST /api/agents/:id/message": async (body, params) => {
    const data = body as { message: string };
    if (!data.message) throw new Error("Message content is required");
    const result = await agentManager.message(params!.id, data.message);
    return result;
  },
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
    const data = body as { message: string; sessionId?: string };
    return await handleChat({
      message: data.message,
      agentId: params!.id,
      sessionId: data.sessionId,
    });
  },

  // ===== TOOLS =====
  "GET /api/tools/builtin": () => builtinTools,
  "GET /api/tools": () => getToolSchemasForLLM(),
  "GET /api/tools/:name": (_body, params) => {
    const schemas = getToolSchemasForLLM();
    const found = schemas.find((t) => t.name === params!.name);
    return found || { error: "Tool not found" };
  },
  "POST /api/tools/execute": async (body) => {
    const data = body as { name: string; args: Record<string, unknown> };
    if (!data.name) throw new Error("Tool name is required");

    if (!hasTool(data.name)) {
      throw new Error(`Invalid tool: ${data.name}`);
    }

    return await executeTool(data.name, data.args, {
      agentId: "api",
      sessionId: "api",
      channel: "api",
      userId: "user",
    });
  },

  // ===== PROVIDERS =====
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
    return providerManager.create({
      provider: data.provider as Parameters<typeof providerManager.create>[0]["provider"],
      name: data.name,
      api_key: data.api_key,
      access_token: data.access_token,
      is_default: data.is_default,
    });
  },
  "PUT /api/providers/:id": (body, params) => ({
    success: providerManager.update(
      params!.id,
      body as Parameters<typeof providerManager.update>[1]
    ),
  }),
  "DELETE /api/providers/:id": (_body, params) => ({ success: providerManager.delete(params!.id) }),
  "GET /api/providers/:id/models": (_body, params) => providerManager.getModels(params!.id),
  "POST /api/providers/discover/ollama": async () => await providerManager.discoverOllamaModels(),

  // --- OAuth Device Code Flow ---
  "POST /api/providers/oauth/device-code": async (body) => {
    const { providerType } = body as { providerType: string };
    const config = providers[providerType as ProviderType] as Record<string, unknown>;
    if (!config) throw new Error(`Validation error: unknown provider '${providerType}'`);

    const oauthConfig = config.oauthConfig as
      | { clientId?: string; deviceCodeUrl?: string; scope?: string }
      | undefined;
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
    const config = providers[providerType as ProviderType] as Record<string, unknown>;
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

  // Open URL in system browser (works in Tauri and browser contexts)
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

  // OAuth redirect flow (for Google/Antigravity etc.)
  // Starts a localhost callback server and returns the auth URL
  "POST /api/providers/oauth/start": async (body) => {
    const { providerType } = body as { providerType: string };
    const providerConfig = providers[providerType as ProviderType] as Record<string, unknown>;
    if (!providerConfig) throw new Error(`Validation error: unknown provider '${providerType}'`);

    const oauthConfig = providerConfig.oauthConfig as
      | {
          authorizeUrl?: string;
          tokenUrl?: string;
          clientId?: string;
          clientSecret?: string;
          scope?: string;
          callbackPort?: number;
          callbackPath?: string;
        }
      | undefined;

    if (!oauthConfig?.authorizeUrl || !oauthConfig?.tokenUrl) {
      throw new Error(`Provider ${providerType} does not support OAuth redirect flow`);
    }

    // Generate PKCE verifier + challenge (S256)
    const { createHash, randomBytes } = await import("crypto");
    const pkceVerifier = randomBytes(32).toString("hex");
    const pkceChallenge = createHash("sha256").update(pkceVerifier).digest("base64url");

    // Generate random state for CSRF protection
    const state = randomBytes(16).toString("hex");

    // Use configured callback port & path, or defaults
    const callbackPort = oauthConfig.callbackPort || 0;
    const callbackPath = oauthConfig.callbackPath || "/callback";
    const redirectUri = `http://localhost:${callbackPort}${callbackPath}`;

    // Start a callback server on the configured port
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
            "<html><body style='font-family:system-ui;text-align:center;padding:60px;background:#0a0a0a;color:#fff'><h2>❌ Authorization Failed</h2><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
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

        // Exchange code for token (with PKCE verifier + client_secret)
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
          "<html><body style='font-family:system-ui;text-align:center;padding:60px;background:#0a0a0a;color:#fff'><h2>✅ Connected!</h2><p>You can close this tab and return to Cybara.</p></body></html>",
          { headers: { "Content-Type": "text/html" } }
        );
      },
    });

    // Store pending callback
    oauthCallbacks.set(state, { status: "pending" });

    // Build authorize URL with PKCE
    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId || "",
      redirect_uri: redirectUri,
      scope: oauthConfig.scope || "",
      code_challenge: pkceChallenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `${oauthConfig.authorizeUrl}?${authParams.toString()}`;

    // Auto-cleanup after 10 minutes
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

  // Poll for OAuth redirect callback result
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

  // ===== MCP REGISTRY =====
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

  // ===== LSP (Language Server Protocol) =====
  "GET /api/lsp/status": async () => {
    try {
      const manager = getLSPManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const availability: Record<string, { available: boolean; bundled: boolean }> = {};

      for (const lang of supported) {
        availability[lang] = {
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        };
      }

      return {
        status: "ok",
        workspace: process.cwd(),
        supported,
        available: availability,
        diagnosticsCount: manager.getAllDiagnostics().size,
      };
    } catch {
      // Manager not initialized, initialize with cwd
      try {
        const manager = initLSPManager(process.cwd());
        const supported = manager.getSupportedLanguages();
        return {
          status: "initialized",
          workspace: process.cwd(),
          supported,
          available: {},
          diagnosticsCount: 0,
        };
      } catch (err) {
        return { status: "error", error: String(err) };
      }
    }
  },
  "GET /api/lsp/languages": async () => {
    try {
      const manager = getLSPManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const result: Array<{ name: string; available: boolean; bundled: boolean }> = [];

      for (const lang of supported) {
        result.push({
          name: lang,
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        });
      }

      return { languages: result };
    } catch {
      return { languages: [] };
    }
  },
  "GET /api/lsp/diagnostics": () => {
    try {
      const manager = getLSPManager(process.cwd());
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

      return { files: result, total: result.reduce((sum, f) => sum + f.count, 0) };
    } catch {
      return { files: [], total: 0 };
    }
  },
  "GET /api/lsp/diagnostics/file": async (_body, params) => {
    const filePath = params?.path as string | undefined;
    if (!filePath) {
      return { success: false, error: "Missing 'path' parameter", diagnostics: [] };
    }
    try {
      const manager = getLSPManager(process.cwd());
      const diagnostics = await manager.getDiagnostics(filePath);
      return {
        success: true,
        path: filePath,
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
      return { success: false, error: String(e), diagnostics: [] };
    }
  },
  "GET /api/lsp/install-status": async () => {
    try {
      const manager = getLSPManager(process.cwd());
      const status = await manager.getInstallStatus();
      return { status };
    } catch {
      // If not initialized, create manager first
      try {
        const manager = initLSPManager(process.cwd());
        const status = await manager.getInstallStatus();
        return { status };
      } catch (err) {
        return { status: [], error: String(err) };
      }
    }
  },
  "POST /api/lsp/install": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getLSPManager(process.cwd());
      const result = await manager.installLSP(language);
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  "POST /api/lsp/uninstall": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getLSPManager(process.cwd());
      const result = await manager.uninstallLSP(language);
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ===== IDE (File Browser) =====
  "GET /api/ide/browse": async (_body, params) => {
    const path = params?.path as string | undefined;
    return await browseDirectory(path);
  },

  "GET /api/ide/read": async (_body, params) => {
    const path = params?.path as string | undefined;
    if (!path) {
      return { success: false, error: "Missing 'path' parameter" };
    }
    return await readFileContent(path);
  },

  "POST /api/ide/write": async (body) => {
    const { path, content } = body as { path?: string; content?: string };
    if (!path) {
      return { success: false, error: "Missing 'path' parameter" };
    }
    if (content === undefined) {
      return { success: false, error: "Missing 'content' parameter" };
    }
    return await writeFileContent(path, content);
  },

  "POST /api/ide/create": async (body) => {
    const { parentPath, name, type } = body as {
      parentPath?: string;
      name?: string;
      type?: "file" | "directory";
    };
    if (!parentPath) {
      return { success: false, error: "Missing 'parentPath' parameter" };
    }
    if (!name) {
      return { success: false, error: "Missing 'name' parameter" };
    }
    if (!type || (type !== "file" && type !== "directory")) {
      return {
        success: false,
        error: "Missing or invalid 'type' parameter (must be 'file' or 'directory')",
      };
    }
    return await createItem(parentPath, name, type);
  },

  // Git API routes
  "GET /api/git/status": async (_body, params) => {
    const { getGitStatus } = await import("./git-api");
    const path = (params?.path as string | undefined) || "~";
    return await getGitStatus(path);
  },

  "GET /api/git/branch": async (_body, params) => {
    const { getGitBranch } = await import("./git-api");
    const path = (params?.path as string | undefined) || "~";
    const branch = await getGitBranch(path);
    return { branch };
  },

  "GET /api/git/diff": async (_body, params) => {
    const { getGitDiff } = await import("./git-api");
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
      await adapter.start(channel.id, config as Record<string, unknown>);
    }

    return {
      success: adapter.isRunning(channel.id),
      running: adapter.isRunning(channel.id),
      type: channel.type,
      enabled: channel.enabled,
    };
  },
  "DELETE /api/channels/:id": (_body, params) => ({ success: channelManager.delete(params!.id) }),

  // Channel Security & Pairing
  "GET /api/channels/:id/pairings": (_body, params) => {
    const channelId = params!.id;
    const rawPairings = securityManager.getAllPairings(channelId);
    // Transform to camelCase for UI
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
      pairing_expiry_minutes?: number;
      max_pending_pairings?: number;
    };
    securityManager.setConfig(channelId, config as Parameters<typeof securityManager.setConfig>[1]);
    return { success: true, config: securityManager.getConfig(channelId) };
  },

  // ===== TASKS =====
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

  // ===== WEBHOOKS =====
  "POST /api/webhooks/telegram/:channelId": async (body, params) => {
    const { channelId } = params!;

    const success = await processTelegramWebhook(channelId, body as Record<string, unknown>);
    return { ok: success };
  },

  // ===== CHAT / CONVERSATIONS =====
  "POST /api/chat": async (body) => {
    const data = body as {
      message: string;
      agentId?: string;
      sessionId?: string;
      stream?: boolean;
      tools?: boolean;
    };
    return await handleChat(data);
  },
  "GET /api/chat/sessions": () => listSessions(),
  "GET /api/chat/sessions/:id": async (_body, params) => {
    const session = await getSession(params!.id);
    if (!session) return session;
    // Sanitize messages to prevent browser OOM
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

  // ===== MEMORY MANAGEMENT =====
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

  // ===== SKILLS =====
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
    // Load skills with full eligibility status
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
    const query = params?.q || "";
    if (!query) return { skills: [], registries: registryManager.list().map((r) => r.name) };
    const results = await registryManager.searchAll(query);
    return { skills: results };
  },
  "GET /api/skills/registry/browse": async () => {
    const results = await registryManager.browseAll();
    return { skills: results, registries: registryManager.list().map((r) => r.name) };
  },
  "POST /api/skills/install": async (body) => {
    const { slug, registry } = body as { slug: string; registry?: string };
    if (!slug) throw new Error("Skill slug is required");
    const result = await registryManager.install(slug, { registry });
    if (result.success) {
      clearSkillsCache(); // Invalidate cache so new skill appears in list
    }
    return result;
  },
  "DELETE /api/skills/:name": async (_body, params) => {
    const result = await registryManager.uninstall(params!.name);
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

  // ===== LOGS =====
  "GET /api/logs/system": async () => getCombinedLogs(),
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

  // ===== SESSIONS =====
  "GET /api/sessions": async () => {
    const sessions = await listSessions();

    const sessionsWithCounts = await Promise.all(
      sessions.map(async (session) => {
        const messages = await getSessionMessages(session.id);
        const lastMessage = messages[messages.length - 1];
        // Get the actual last activity timestamp from the last message
        const updatedAt = lastMessage?.timestamp ? lastMessage.timestamp : session.createdAt;
        return {
          id: session.id,
          agent_id: session.agentId,
          created_at: normalizeTimestamp(session.createdAt),
          updated_at: normalizeTimestamp(updatedAt),
          message_count: session.messageCount,
          last_message: lastMessage
            ? {
                role: lastMessage.role,
                content:
                  lastMessage.content.slice(0, 100) +
                  (lastMessage.content.length > 100 ? "..." : ""),
              }
            : null,
        };
      })
    );
    // Sort by updated_at (last activity) descending so most recent shows first
    return sessionsWithCounts.sort(
      (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    );
  },
  "GET /api/sessions/:sessionId": async (_body, params) => {
    const session = await getSession(params!.sessionId);
    if (!session) return { error: "Session not found" };
    const messages = await getSessionMessages(params!.sessionId);

    // Truncate large message content and sanitize tool calls to prevent browser OOM
    const MAX_CONTENT_SIZE = 10000; // 10KB per message max
    const sanitizedMessages = sanitizeSessionMessages(messages).map((m) => {
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
      id: session.id,
      agent_id: session.agentId,
      created_at: normalizeTimestamp(session.createdAt),
      updated_at: normalizeTimestamp(session.createdAt),
      messagesList: sanitizedMessages,
    };
  },
  "DELETE /api/sessions/:sessionId": async (_body, params) => {
    await deleteSession(params!.sessionId);
    return { success: true, message: "Session deleted" };
  },

  // ===== SUBAGENTS =====
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

  // ===== SYSTEM PROMPT & IDENTITY =====
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
    // Return a preview of what the system prompt would look like

    const homeDir = process.env.HOME || homedir();
    const preview = buildSystemPrompt({
      modelDisplay: "MiniMax-M2.1",
      tools: [
        "read",
        "write",
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

  // ===== BROWSER AUTOMATION =====
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

  // ===== SYSTEM STATUS (lightweight - for UI polling) =====
  "GET /api/system/status": () => {
    const metrics = tables.metrics;

    // Get last activity timestamp
    const lastActivity = (metrics.getByType("system_status") as MetricsEntry[]).find(
      (s) => s.key === "last_activity"
    );
    const lastActivityTime = lastActivity?.value ?? 0;
    const now = Date.now();
    const isThinking = lastActivityTime > 0 && now - lastActivityTime < 30000; // 30 second window

    // Get agent count from list
    const agentCount = agentManager.list().length;

    return {
      status: isThinking ? "thinking" : "idle",
      lastActivity: lastActivityTime,
      agentCount,
      timestamp: now,
    };
  },

  // ===== METRICS =====
  "GET /api/metrics/overview": () => {
    const metrics = tables.metrics;

    // Get totals for each metric type
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

    // Get tool calls by aggregating all tool_call entries
    const toolCallEntries = (metrics.getByType("tool_call") || []) as MetricsEntry[];
    const totalToolCalls = toolCallEntries.reduce((sum, entry) => sum + (entry.value || 0), 0);

    const toolStats = {
      totalCalls: totalToolCalls,
    };

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

    // Session and context metrics (OpenClaw parity)
    const sessionStats = {
      totalSessions: metrics.getTotal("session_event", "created") || 0,
      memoryFlushes: metrics.getTotal("memory_flush", "success") || 0,
      memoryFlushFailures: metrics.getTotal("memory_flush", "failure") || 0,
      compactions: metrics.getTotal("context_compaction", "tokens") || 0,
    };

    // Get context utilization warnings
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
      toolCalls: toolStats,
      apiCalls: apiStats,
      agentActivity: agentStats,
      sessions: sessionStats,
      contextHealth: contextStats,
    };
  },

  "GET /api/metrics/tokens": () => {
    const metrics = tables.metrics;

    // Get top models by token usage
    const topModels = metrics.getTopKeys("token_usage_by_model") as MetricTopKey[];
    const topProviders = metrics.getTopKeys("token_usage_by_provider") as MetricTopKey[];
    const recentTokens = metrics.getByType("token_usage") as MetricsEntry[];

    // Calculate total tokens from input + output
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

    // Get provider token entries with metadata (for URL)
    const providerTokenEntries = metrics.getByType("token_usage_by_provider") as MetricsEntry[];

    // Build provider map with URLs from token entries
    const providerMap = new Map<string, ProviderMetricSummary>();

    for (const entry of providerTokenEntries) {
      // Skip aggregate keys
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

    // Add API call hits from api_call entries
    const apiCalls = metrics.getByType("api_call") as MetricsEntry[];
    for (const entry of apiCalls) {
      // Skip aggregate keys
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

        // Update URL if we have one from metadata
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
    // Get daily aggregates for the last 30 days
    const days: Array<Record<string, string | number>> = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      // First try pre-aggregated metrics_daily table
      let dailyTotals = tables.metrics.getDailyTotals(dateStr) as Array<{
        type: string;
        total: number;
      }>;

      // If empty, fallback to aggregating from raw metrics table
      if (dailyTotals.length === 0) {
        dailyTotals = tables.metrics.getDailyTotalsFromRaw(dateStr);
      }

      const dayData: Record<string, string | number> = { date: dateStr };
      for (const total of dailyTotals) {
        dayData[total.type] = total.total;
      }

      // If still no metric data, count log entries as activity
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

  // Get per-model TPS (tokens per second) metrics
  "GET /api/metrics/models": () => ({ models: getModelMetrics() }),

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

// ============================================
// HELPER FUNCTIONS
// ============================================

function checkDatabaseHealth(): { status: string; error?: string } {
  try {
    // Simple check - try to list agents
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

function getCircuitBreakersStatus(): Record<string, { state: string; failureCount?: number }> {
  const breakers: Record<string, { state: string; failureCount?: number }> = {};

  // Get known circuit breaker states
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

// ============================================
// REQUEST HANDLER
// ============================================

export async function handleRequest(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}> {
  const startTime = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost:4269"}`);
  const method = req.method || "GET";
  const path = url.pathname;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: { ...corsHeaders, ...securityHeaders },
    };
  }

  // Security check - auth, rate limiting
  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    "127.0.0.1";

  const security = securityCheck(method, path, req.headers, clientIp);
  if (!security.passed) {
    const duration = Date.now() - startTime;
    log.warn(`Security check failed: ${security.error}`, { path, ip: clientIp });
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

  // Merge URL query params into params
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  if (!routeKey || !routes[routeKey]) {
    const duration = Date.now() - startTime;
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

    // Log full error for debugging
    console.error(`[API Error] ${method} ${path}:`, error);

    // Provide helpful error messages based on error type
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
      // Generic error - show simplified message to user
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

    // Prefer more specific routes:
    // 1) fewer dynamic segments
    // 2) more static segments
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
