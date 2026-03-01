import { config } from "../core/config";
import { tables } from "../core/database";
import { agentManager, getBuiltinTools } from "../core/agent";
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
  handleChat,
  getSession,
  getSessionMessages,
  listSessions,
  deleteSession,
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
import * as pwManager from "../core/browser/pw-manager";
import { homedir } from "os";
import { dirname, isAbsolute, resolve, join } from "path";
import { createHash, randomBytes } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import { securityCheck, validateUrl } from "./security";
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
import {
  listArtifacts,
  readArtifact,
  deleteArtifact,
  listAllArtifacts,
  getArtifactsRootDir,
} from "../core/artifacts";
import { getSessionStatusSnapshot, listSessionStatusSnapshots } from "../core/status";
import { getSandboxRuntimeStatus, logSandboxRuntimeStatus } from "../core/sandbox";
import { cybaraDir, dataDir, logsDir, memoryDir, secureDir, userSkillsDir } from "../core/paths";
import type {
  WalletChain,
  WalletAgentPolicy,
  WalletPriceQuoteInput,
  WalletSwapInput,
  WalletSwapEthUniswapInput,
  WalletTokenChain,
  SolInstructionAccountMeta,
  WalletDappCallInput,
  WalletX402RequestInput,
  WalletRpcCallInput,
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

interface LspLocationLike {
  uri?: string;
  targetUri?: string;
  range?: {
    start?: { line?: number; character?: number };
  };
  targetSelectionRange?: {
    start?: { line?: number; character?: number };
  };
  targetRange?: {
    start?: { line?: number; character?: number };
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
  _tool_calls_total_count?: number;
  _tool_calls_hidden_count?: number;
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

interface MetricTrend {
  current: number;
  previous: number;
  changePct: number;
  direction: "up" | "down" | "flat";
}

interface TokenCallSnapshot {
  timestamp: string;
  timestampMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  provider: string;
  durationMs: number | null;
  tokensPerSecond: number | null;
}

interface TokenCloudEntry {
  token: string;
  category: "model" | "provider" | "tool" | "term" | "pattern";
  weight: number;
  sharePct: number;
}

const WALLET_CHAIN_SET = new Set<WalletChain>(["eth", "btc", "sol"]);
const WALLET_TOKEN_CHAIN_SET = new Set<WalletTokenChain>(["eth", "sol"]);
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

function metricTimestampToMs(createdAt?: string): number | null {
  if (!createdAt) return null;
  const hasTimezone =
    createdAt.includes("Z") || createdAt.includes("+") || createdAt.slice(10).includes("-");
  const normalized = hasTimezone ? createdAt : createdAt.replace(" ", "T") + "Z";
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumMetricValues(
  entries: MetricsEntry[],
  predicate: (entry: MetricsEntry, timestampMs: number | null) => boolean
): number {
  let total = 0;
  for (const entry of entries) {
    const timestampMs = metricTimestampToMs(entry.created_at);
    if (!predicate(entry, timestampMs)) continue;
    total += Number(entry.value || 0);
  }
  return total;
}

function buildMetricTrend(current: number, previous: number): MetricTrend {
  let changePct = 0;
  if (previous > 0) {
    changePct = ((current - previous) / previous) * 100;
  } else if (current > 0) {
    changePct = 100;
  }

  const rounded = Number(changePct.toFixed(2));
  const direction: MetricTrend["direction"] = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";

  return {
    current,
    previous,
    changePct: rounded,
    direction,
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function localDateKeyFromMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeFileSizeBytes(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function safeDirSizeBytes(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    const stack = [path];
    let total = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        try {
          if (entry.isDirectory()) {
            stack.push(fullPath);
            continue;
          }
          if (entry.isFile()) {
            total += statSync(fullPath).size;
          }
        } catch {
          continue;
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

type StorageTopLevelEntry = {
  name: string;
  path: string;
  bytes: number;
  type: "directory" | "file";
};

function collectTopLevelStorageEntries(rootDir: string): StorageTopLevelEntry[] {
  try {
    if (!existsSync(rootDir)) return [];
    const entries = readdirSync(rootDir, { withFileTypes: true });
    const topLevelEntries: StorageTopLevelEntry[] = [];
    for (const entry of entries) {
      const fullPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        topLevelEntries.push({
          name: entry.name,
          path: fullPath,
          bytes: safeDirSizeBytes(fullPath),
          type: "directory",
        });
        continue;
      }
      if (entry.isFile()) {
        topLevelEntries.push({
          name: entry.name,
          path: fullPath,
          bytes: safeFileSizeBytes(fullPath),
          type: "file",
        });
      }
    }
    return topLevelEntries.sort((a, b) => b.bytes - a.bytes);
  } catch {
    return [];
  }
}

function buildStorageMetrics() {
  const dbMainPath = join(dataDir, "platform.db");
  const dbWalPath = join(dataDir, "platform.db-wal");
  const dbShmPath = join(dataDir, "platform.db-shm");
  const artifactsDir = getArtifactsRootDir();
  const sessionsDir = join(cybaraDir, "sessions");
  const mediaDir = join(cybaraDir, "media");
  const channelsDir = join(cybaraDir, "channels");
  const topLevelEntries = collectTopLevelStorageEntries(cybaraDir);
  const topLevelBytesByName = new Map(topLevelEntries.map((entry) => [entry.name, entry.bytes]));
  const topLevelTotalBytes = topLevelEntries.reduce((sum, entry) => sum + entry.bytes, 0);

  const databaseMainBytes = safeFileSizeBytes(dbMainPath);
  const databaseWalBytes = safeFileSizeBytes(dbWalPath);
  const databaseShmBytes = safeFileSizeBytes(dbShmPath);
  const databaseBytes = databaseMainBytes + databaseWalBytes + databaseShmBytes;
  const dataBytes = topLevelBytesByName.get("data") ?? safeDirSizeBytes(dataDir);
  const artifactsBytes = topLevelBytesByName.get("artifacts") ?? safeDirSizeBytes(artifactsDir);
  const logsBytes = topLevelBytesByName.get("logs") ?? safeDirSizeBytes(logsDir);
  const memoryBytes = topLevelBytesByName.get("memory") ?? safeDirSizeBytes(memoryDir);
  const secureBytes = topLevelBytesByName.get("secure") ?? safeDirSizeBytes(secureDir);
  const skillsBytes = topLevelBytesByName.get("skills") ?? safeDirSizeBytes(userSkillsDir);
  const sessionsBytes = topLevelBytesByName.get("sessions") ?? safeDirSizeBytes(sessionsDir);
  const mediaBytes = topLevelBytesByName.get("media") ?? safeDirSizeBytes(mediaDir);
  const channelsBytes = topLevelBytesByName.get("channels") ?? safeDirSizeBytes(channelsDir);

  const categorizedBytes =
    dataBytes +
    artifactsBytes +
    logsBytes +
    memoryBytes +
    secureBytes +
    skillsBytes +
    sessionsBytes +
    mediaBytes +
    channelsBytes;
  const uncategorizedBytes = Math.max(0, topLevelTotalBytes - categorizedBytes);
  const accountedBytes = topLevelTotalBytes - uncategorizedBytes;

  return {
    totalBytes: topLevelTotalBytes,
    accountedBytes,
    uncategorizedBytes,
    directories: {
      cybaraDir,
      dataDir,
      logsDir,
      memoryDir,
      secureDir,
      artifactsDir,
      userSkillsDir,
      sessionsDir,
      mediaDir,
      channelsDir,
    },
    components: {
      database: {
        path: dbMainPath,
        bytes: databaseBytes,
        files: {
          main: { path: dbMainPath, bytes: databaseMainBytes },
          wal: { path: dbWalPath, bytes: databaseWalBytes },
          shm: { path: dbShmPath, bytes: databaseShmBytes },
        },
      },
      artifacts: { path: artifactsDir, bytes: artifactsBytes },
      logs: { path: logsDir, bytes: logsBytes },
      memory: { path: memoryDir, bytes: memoryBytes },
      secure: { path: secureDir, bytes: secureBytes },
      skills: { path: userSkillsDir, bytes: skillsBytes },
      sessions: { path: sessionsDir, bytes: sessionsBytes },
      media: { path: mediaDir, bytes: mediaBytes },
      channels: { path: channelsDir, bytes: channelsBytes },
      other: { path: cybaraDir, bytes: uncategorizedBytes },
      data: { path: dataDir, bytes: dataBytes },
    },
    topLevel: topLevelEntries,
  };
}

const ACTIVE_SESSION_STATUSES = new Set([
  "thinking",
  "generating",
  "tool_executing",
  "tool_completed",
]);

function isSessionStatusActive(status?: string): boolean {
  return typeof status === "string" && ACTIVE_SESSION_STATUSES.has(status);
}

function buildTokenCallSnapshots(tokenUsageEntries: MetricsEntry[]): TokenCallSnapshot[] {
  const inputByTimestamp = new Map<string, number>();
  const outputByTimestamp = new Map<string, number>();

  for (const entry of tokenUsageEntries) {
    if (!entry.created_at) continue;
    if (entry.key === "input") {
      inputByTimestamp.set(
        entry.created_at,
        (inputByTimestamp.get(entry.created_at) || 0) + Number(entry.value || 0)
      );
    } else if (entry.key === "output") {
      outputByTimestamp.set(
        entry.created_at,
        (outputByTimestamp.get(entry.created_at) || 0) + Number(entry.value || 0)
      );
    }
  }

  const snapshots: TokenCallSnapshot[] = [];
  for (const entry of tokenUsageEntries) {
    if (entry.key !== "all" || !entry.created_at) continue;

    const metadata = parseMetricMetadata(entry.metadata);
    const inputFromMetadata = toFiniteNumber(metadata?.inputTokens);
    const outputFromMetadata = toFiniteNumber(metadata?.outputTokens);
    const durationMs = toFiniteNumber(metadata?.durationMs);
    const model =
      toNonEmptyString(metadata?.model) ||
      toNonEmptyString(metadata?.modelId) ||
      toNonEmptyString(metadata?.modelName) ||
      "unknown";
    const provider = toNonEmptyString(metadata?.provider) || "unknown";

    const inputTokens =
      inputFromMetadata ?? toFiniteNumber(inputByTimestamp.get(entry.created_at)) ?? 0;
    const outputTokens =
      outputFromMetadata ?? toFiniteNumber(outputByTimestamp.get(entry.created_at)) ?? 0;
    const totalTokens = Number(entry.value || inputTokens + outputTokens);
    const tokensPerSecond =
      durationMs && durationMs > 0 ? Number(((outputTokens / durationMs) * 1000).toFixed(2)) : null;

    snapshots.push({
      timestamp: entry.created_at,
      timestampMs: metricTimestampToMs(entry.created_at),
      inputTokens,
      outputTokens,
      totalTokens,
      model,
      provider,
      durationMs,
      tokensPerSecond,
    });
  }

  snapshots.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
  return snapshots;
}

function buildAssistantOutputCloud(
  entries: Array<{ content?: string }>,
  totalOutputTokens: number,
  averageTokensPerCall: number
): TokenCloudEntry[] {
  const stopWords = new Set([
    "about",
    "after",
    "again",
    "agent",
    "also",
    "and",
    "any",
    "are",
    "because",
    "been",
    "before",
    "being",
    "between",
    "both",
    "but",
    "can",
    "could",
    "cybara",
    "does",
    "dont",
    "each",
    "for",
    "from",
    "have",
    "hello",
    "here",
    "how",
    "into",
    "just",
    "like",
    "main",
    "make",
    "model",
    "more",
    "need",
    "not",
    "now",
    "our",
    "out",
    "please",
    "should",
    "some",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "they",
    "this",
    "use",
    "using",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
    "you",
    "your",
  ]);

  const termWeights = new Map<string, number>();
  const patternWeights = new Map<string, number>();
  const cappedEntries = entries.slice(0, 600);
  const totalChars = cappedEntries.reduce((sum, entry) => sum + (entry.content?.length || 0), 0);

  for (const entry of cappedEntries) {
    if (!entry.content) continue;
    const content = entry.content.slice(0, 2000).toLowerCase();
    const tokens = content.match(/[a-z][a-z0-9_-]{2,}/g) || [];
    const cleanTokens = tokens.filter((term) => !stopWords.has(term) && !/^\d+$/.test(term));
    if (cleanTokens.length === 0) continue;

    const estimatedOutputTokens =
      totalChars > 0
        ? Math.max(1, (entry.content.length / totalChars) * Math.max(totalOutputTokens, 1))
        : Math.max(averageTokensPerCall, 1);

    const termCounts = new Map<string, number>();
    for (const term of cleanTokens) {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }

    const totalTermHits = cleanTokens.length;
    for (const [term, count] of termCounts) {
      if (stopWords.has(term)) continue;
      const weight = (count / totalTermHits) * estimatedOutputTokens;
      termWeights.set(term, (termWeights.get(term) || 0) + weight);
    }

    if (cleanTokens.length >= 2) {
      const patternCounts = new Map<string, number>();
      for (let i = 0; i < cleanTokens.length - 1; i++) {
        const first = cleanTokens[i];
        const second = cleanTokens[i + 1];
        if (!first || !second) continue;
        if (first === second) continue;
        const pattern = `${first} ${second}`;
        patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
      }

      const totalPatternHits = Math.max(
        1,
        Array.from(patternCounts.values()).reduce((sum, count) => sum + count, 0)
      );
      for (const [pattern, count] of patternCounts) {
        const weight = (count / totalPatternHits) * estimatedOutputTokens * 0.75;
        patternWeights.set(pattern, (patternWeights.get(pattern) || 0) + weight);
      }
    }
  }

  const termCloud = Array.from(termWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([token, weight]) => ({
      token,
      category: "term" as const,
      weight: Number(weight.toFixed(2)),
      sharePct: 0,
    }));

  const patternCloud = Array.from(patternWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, weight]) => ({
      token: pattern,
      category: "pattern" as const,
      weight: Number(weight.toFixed(2)),
      sharePct: 0,
    }));

  return [...termCloud, ...patternCloud];
}

function classifyModelBehavior(
  promptSharePct: number,
  avgTps: number,
  avgLatencyMs: number,
  avgTokensPerCall: number
): string {
  if (promptSharePct >= 75 && avgLatencyMs >= 3000) return "deliberative";
  if (promptSharePct <= 35 && avgTps >= 35) return "expansive";
  if (avgTps >= 55 && avgLatencyMs <= 2200) return "rapid";
  if (avgTokensPerCall >= 6000) return "deep-context";
  return "balanced";
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSecretString(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  const compact = normalized.replace(/\r?\n/g, "");
  return compact.trim() || undefined;
}

function buildGoogleAuthHeaders(
  providerAuthType: string,
  credentials: { apiKey?: string; accessToken?: string }
): Record<string, string> {
  const apiKey = credentials.apiKey?.trim();
  const accessToken = credentials.accessToken?.trim();
  const normalizedAuthType = providerAuthType.trim().toLowerCase();
  if (normalizedAuthType === "oauth" || normalizedAuthType === "token") {
    if (!accessToken) {
      return {};
    }
    return { Authorization: `Bearer ${accessToken}` };
  }
  if (!apiKey) {
    return {};
  }
  return { "x-goog-api-key": apiKey };
}

function isLikelyGoogleApiKey(value: string): boolean {
  return /^AIza[0-9A-Za-z_-]+$/.test(value.trim());
}

function formatChannelTestError(channelType: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.toLowerCase();

  if (channelType === "discord") {
    if (
      normalized.includes("invalid token") ||
      normalized.includes("tokeninvalid") ||
      normalized.includes("unauthorized")
    ) {
      return "Discord login failed: invalid bot token. Use the Bot token from Discord Developer Portal (without a 'Bot ' prefix).";
    }

    if (
      normalized.includes("disallowed intents") ||
      normalized.includes("used disallowed intents") ||
      normalized.includes("privileged intent")
    ) {
      return "Discord login failed: required gateway intents are disabled. Enable Message Content Intent in Discord Developer Portal > Bot.";
    }

    if (
      normalized.includes("enotfound") ||
      normalized.includes("eai_again") ||
      normalized.includes("fetch failed") ||
      normalized.includes("network") ||
      normalized.includes("timed out")
    ) {
      return `Discord network error: ${raw}`;
    }

    return `Discord test failed: ${raw}`;
  }

  return raw;
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

interface DictationAudioPayload {
  bytes: Uint8Array;
  mimeType: string;
}

function decodeDictationAudioBase64(
  rawBase64: string,
  fallbackMimeType: string
): DictationAudioPayload {
  const trimmed = rawBase64.trim();
  if (!trimmed) {
    throw new Error("Validation error: Audio payload is empty");
  }

  let mimeType = fallbackMimeType || "audio/webm";
  let base64 = trimmed;
  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1] || mimeType;
    base64 = dataUrlMatch[2] || "";
  }

  const normalized = base64.replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("Validation error: Audio payload is empty");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(normalized, "base64"));
  } catch {
    throw new Error("Validation error: Audio payload is not valid base64");
  }

  if (bytes.length === 0) {
    throw new Error("Validation error: Audio payload decoded to zero bytes");
  }

  const maxBytes = 25 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error("Validation error: Audio payload exceeds 25MB limit");
  }

  return { bytes, mimeType };
}

function pickDictationProvider(preferredProviderId?: string) {
  if (preferredProviderId) {
    const provider = providerManager.getWithCredentials(preferredProviderId);
    if (!provider) {
      throw new Error("Validation error: Requested dictation provider ID is invalid");
    }
    const resolved = resolveProviderType(provider.provider);
    if (resolved !== "openai" && resolved !== "openai-codex") {
      throw new Error(
        "Validation error: Requested dictation provider must be OpenAI or OpenAI Codex"
      );
    }
    return provider;
  }

  const providersWithCredentials = providerManager
    .list()
    .map((p) => providerManager.getWithCredentials(p.id))
    .filter(
      (provider): provider is NonNullable<typeof provider> =>
        !!provider &&
        !!(provider.api_key || provider.access_token) &&
        (() => {
          const resolved = resolveProviderType(provider.provider);
          return resolved === "openai" || resolved === "openai-codex";
        })()
    );

  if (providersWithCredentials.length === 0) {
    throw new Error(
      "No dictation provider configured. Add an OpenAI or OpenAI Codex provider with valid credentials."
    );
  }

  const defaultProvider = providersWithCredentials.find((provider) => !!provider.is_default);
  return defaultProvider || providersWithCredentials[0];
}

async function transcribeWithOpenAICompatibleProvider(input: {
  provider: ReturnType<typeof providerManager.getWithCredentials>;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  model?: string;
}): Promise<{ text: string; model: string }> {
  const provider = input.provider;
  if (!provider) {
    throw new Error("No dictation provider available");
  }

  const authToken = provider.api_key || provider.access_token;
  if (!authToken) {
    throw new Error("No API credentials available for dictation provider");
  }

  const providerInfo =
    providers[(resolveProviderType(provider.provider) || provider.provider) as ProviderType];
  const baseUrl = (
    provider.base_url ||
    providerInfo?.baseUrl ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const candidateModels = [input.model?.trim(), "gpt-4o-mini-transcribe", "whisper-1"].filter(
    (value): value is string => !!value
  );
  const uniqueModels = [...new Set(candidateModels)];

  const extension = input.fileName.includes(".")
    ? input.fileName.split(".").pop() || "webm"
    : input.mimeType.includes("ogg")
      ? "ogg"
      : input.mimeType.includes("wav")
        ? "wav"
        : "webm";

  let lastErrorText = "";
  for (const model of uniqueModels) {
    const formData = new FormData();
    const file = new File([input.bytes], `${input.fileName.replace(/\.[^.]+$/, "")}.${extension}`, {
      type: input.mimeType || "audio/webm",
    });
    formData.append("file", file);
    formData.append("model", model);

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      lastErrorText = errorText;
      continue;
    }

    const payload = (await response.json()) as { text?: string };
    const text = (payload.text || "").trim();
    if (!text) {
      throw new Error("Dictation transcription succeeded but returned empty text");
    }
    return { text, model };
  }

  throw new Error(
    `Dictation transcription failed: ${lastErrorText || "Provider returned an unsupported response"}`
  );
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
    | "replace"
    | "replace_preview"
    | "list_files",
  path: string | undefined,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  trackMetric("ide_operation", operation, 1, { path, success, ...metadata });
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

function normalizeDefinitionLocation(raw: unknown):
  | { uri: string; path: string; line: number; character: number }
  | null {
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeArtifactSummary(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) return undefined;
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : undefined;
  const name = typeof value.name === "string" ? value.name : undefined;
  const fileName = typeof value.fileName === "string" ? value.fileName : undefined;
  if (!sessionId || !name || !fileName) return undefined;
  return {
    sessionId,
    name,
    fileName,
    title: typeof value.title === "string" ? value.title : fileName,
  };
}

function sanitizeArtifactToolResult(result: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(result)) return undefined;
  const payload: Record<string, unknown> = {};

  if (typeof result.action === "string") {
    payload.action = result.action;
  }
  if (typeof result.sessionId === "string") {
    payload.sessionId = result.sessionId;
  }
  if (typeof result.fallback === "boolean") {
    payload.fallback = result.fallback;
  }
  if (typeof result.missing === "boolean") {
    payload.missing = result.missing;
  }
  if (typeof result.error === "string") {
    payload.error = result.error.length > 200 ? result.error.slice(0, 200) + "..." : result.error;
  }

  const artifact = sanitizeArtifactSummary(result.artifact);
  if (artifact) {
    payload.artifact = artifact;
  }

  if (Array.isArray(result.artifacts)) {
    const artifacts = result.artifacts
      .map((entry) => sanitizeArtifactSummary(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry)
      .slice(0, 20);
    if (artifacts.length > 0) {
      payload.artifacts = artifacts;
    }
  }

  if (Array.isArray(result.availableArtifacts)) {
    const availableArtifacts = result.availableArtifacts
      .map((entry) => sanitizeArtifactSummary(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry)
      .slice(0, 20);
    if (availableArtifacts.length > 0) {
      payload.availableArtifacts = availableArtifacts;
    }
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function isArtifactToolCall(toolCall: unknown): boolean {
  if (!isObjectRecord(toolCall)) return false;
  const name = typeof toolCall.name === "string" ? toolCall.name.toLowerCase() : "";
  if (name === "artifacts" || name === "artifact") return true;
  return !!sanitizeArtifactToolResult(toolCall.result);
}

function sanitizeProcessActivities(
  activities: unknown,
  options?: { maxItems?: number; maxTextLength?: number }
): SessionMessageView["process_activities"] | undefined {
  if (!Array.isArray(activities)) return undefined;
  const maxItems =
    typeof options?.maxItems === "number" && Number.isFinite(options.maxItems)
      ? Math.max(0, Math.floor(options.maxItems))
      : undefined;
  const maxTextLength =
    typeof options?.maxTextLength === "number" && Number.isFinite(options.maxTextLength)
      ? Math.max(0, Math.floor(options.maxTextLength))
      : undefined;
  const entries =
    typeof maxItems === "number" && maxItems > 0 ? activities.slice(-maxItems) : activities;

  const sanitized: NonNullable<SessionMessageView["process_activities"]> = [];
  for (const entry of entries) {
    if (!isObjectRecord(entry)) continue;
    const phase =
      entry.phase === "start" || entry.phase === "result" || entry.phase === "error"
        ? entry.phase
        : "result";
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!text) continue;
    const timestamp =
      typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
        ? entry.timestamp
        : Date.now();
    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id
        : `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const toolName =
      typeof entry.toolName === "string" && entry.toolName.trim() ? entry.toolName : undefined;
    const toolCallId =
      typeof entry.toolCallId === "string" && entry.toolCallId.trim()
        ? entry.toolCallId
        : undefined;

    sanitized.push({
      id,
      phase,
      text:
        typeof maxTextLength === "number" && maxTextLength > 0 && text.length > maxTextLength
          ? `${text.slice(0, maxTextLength)}...`
          : text,
      timestamp,
      toolName,
      toolCallId,
    });
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeSessionMessages(
  messages: SessionMessageView[],
  options?: { maxToolCalls?: number; includeFullToolCalls?: boolean }
): SessionMessageView[] {
  const truncateLargeFields = options?.includeFullToolCalls !== true;
  const MAX_RESULT_SIZE = truncateLargeFields ? 500 : 0;
  const MAX_ERROR_SIZE = truncateLargeFields ? 200 : 0;
  const PROCESS_OPTIONS = truncateLargeFields ? { maxItems: 240, maxTextLength: 500 } : undefined;
  const DEFAULT_MAX_TOOL_CALLS = 50;
  const maxToolCallsRaw = options?.maxToolCalls;
  const MAX_TOOL_CALLS =
    typeof maxToolCallsRaw === "number" && Number.isFinite(maxToolCallsRaw)
      ? Math.max(0, Math.floor(maxToolCallsRaw))
      : DEFAULT_MAX_TOOL_CALLS;

  return messages.map((msg) => {
    const sanitizedProcessActivities = sanitizeProcessActivities(
      msg.process_activities,
      PROCESS_OPTIONS
    );

    if (!msg || !msg.tool_calls || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
      if (!sanitizedProcessActivities) {
        return msg;
      }
      return {
        ...msg,
        process_activities: sanitizedProcessActivities,
      };
    }

    const indexedToolCalls = msg.tool_calls.map((toolCall, index) => ({
      toolCall,
      index,
      isArtifact: isArtifactToolCall(toolCall),
    }));
    const selectedIndexes = new Set<number>();
    for (const entry of indexedToolCalls.slice(0, MAX_TOOL_CALLS || indexedToolCalls.length)) {
      selectedIndexes.add(entry.index);
    }

    if (MAX_TOOL_CALLS > 0 && msg.tool_calls.length > MAX_TOOL_CALLS) {
      for (const entry of indexedToolCalls) {
        if (entry.index < MAX_TOOL_CALLS || !entry.isArtifact || selectedIndexes.has(entry.index)) {
          continue;
        }
        if (selectedIndexes.size < MAX_TOOL_CALLS) {
          selectedIndexes.add(entry.index);
          continue;
        }

        const removableIndex = [...selectedIndexes]
          .sort((a, b) => b - a)
          .find((index) => !indexedToolCalls[index]?.isArtifact);

        if (removableIndex === undefined) {
          continue;
        }

        selectedIndexes.delete(removableIndex);
        selectedIndexes.add(entry.index);
      }
    }

    const selectedToolCalls =
      MAX_TOOL_CALLS <= 0
        ? indexedToolCalls.map((entry) => ({
          toolCall: entry.toolCall,
          sourceIndex: entry.index,
        }))
        : [...selectedIndexes]
          .sort((a, b) => a - b)
          .map((index) => {
            const entry = indexedToolCalls[index];
            if (!entry) return null;
            return {
              toolCall: entry.toolCall,
              sourceIndex: entry.index,
            };
          })
          .filter(
            (
              entry
            ): entry is {
              toolCall: NonNullable<SessionMessageView["tool_calls"]>[number];
              sourceIndex: number;
            } => !!entry
          );

    const sanitizedToolCalls = selectedToolCalls.map(({ toolCall: tc, sourceIndex }) => {
      const sanitized = { ...tc };
      if (
        typeof (sanitized as { timeline_index?: unknown }).timeline_index !== "number" ||
        !Number.isFinite((sanitized as { timeline_index?: unknown }).timeline_index as number)
      ) {
        (sanitized as { timeline_index: number }).timeline_index = sourceIndex;
      }

      if (tc.result !== undefined) {
        try {
          const artifactResult =
            tc.name === "artifacts" || tc.name === "artifact"
              ? sanitizeArtifactToolResult(tc.result)
              : undefined;
          if (artifactResult) {
            sanitized.result = artifactResult;
          } else {
            const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
            sanitized.result =
              MAX_RESULT_SIZE > 0 && resultStr.length > MAX_RESULT_SIZE
                ? resultStr.slice(0, MAX_RESULT_SIZE) + "... [truncated]"
                : tc.result;
          }
        } catch {
          sanitized.result = "[Result too large to display]";
        }
      }

      if (
        MAX_ERROR_SIZE > 0 &&
        tc.error &&
        typeof tc.error === "string" &&
        tc.error.length > MAX_ERROR_SIZE
      ) {
        sanitized.error = tc.error.slice(0, MAX_ERROR_SIZE) + "...";
      }

      return sanitized;
    });

    return {
      ...msg,
      tool_calls: sanitizedToolCalls,
      process_activities: sanitizedProcessActivities,
      _tool_calls_total_count: msg.tool_calls.length,
      _tool_calls_hidden_count:
        MAX_TOOL_CALLS > 0 && msg.tool_calls.length > sanitizedToolCalls.length
          ? msg.tool_calls.length - sanitizedToolCalls.length
          : 0,
      _truncated:
        MAX_TOOL_CALLS > 0 && msg.tool_calls.length > MAX_TOOL_CALLS
          ? `Showing ${MAX_TOOL_CALLS} of ${msg.tool_calls.length} tool calls`
          : undefined,
    };
  });
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

function buildCorsHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = { ...corsBaseHeaders };
  if (!isProduction) {
    headers["Access-Control-Allow-Origin"] = origin || "*";
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

  "GET /api/info": () => ({
    name: "Cybara",
    version: "1.0.0",
    setupComplete: config.isSetupComplete(),
    homeDir: process.env.HOME || homedir(),
    stats: {
      agents: agentManager.getStats(),
      providers: providerManager.getStats(),
      channels: channelManager.getStats(),
      tasks: taskScheduler.getStats(),
    },
  }),

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
    ...config.getAll(),
    dangerous_tool_policy: config.getDangerousToolPolicy(),
    tool_approval_mode: config.getToolApprovalMode(),
    web_tool_url_policy: config.getWebToolUrlPolicy(),
    sandbox_runtime: config.getSandboxRuntime(),
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
          : "api",
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
      allowDangerousTools: data.context?.allowDangerousTools === true,
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
  "POST /api/providers/discover/ollama": async () => await providerManager.discoverOllamaModels(),

  "POST /api/providers/oauth/device-code": async (body) => {
    const { providerType } = body as { providerType: string };
    const resolvedProviderType = resolveProviderType(providerType);
    const config = providers[resolvedProviderType as ProviderType] as Record<string, unknown>;
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
      const normalizedLocations = (Array.isArray(definitions) ? definitions : definitions ? [definitions] : [])
        .map((location) => normalizeDefinitionLocation(location))
        .filter((location): location is { uri: string; path: string; line: number; character: number } => !!location);
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
    const {
      path,
      query,
      replacement,
      caseSensitive,
      wholeWord,
      files,
    } = body as {
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

  "GET /api/sessions": async (_body, params) => {
    const parseQueryNumber = (raw: string | undefined): number | undefined => {
      if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const limit = parseQueryNumber(params?.limit);
    const offset = parseQueryNumber(params?.offset);
    const sessions = await listSessions({
      limit: typeof limit === "number" ? Math.min(500, Math.max(1, limit)) : undefined,
      offset: typeof offset === "number" ? Math.max(0, offset) : undefined,
    });

    return sessions.map((session) => {
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
    });
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
    };
  },

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
      toolCalls: toolStats,
      apiCalls: apiStats,
      agentActivity: agentStats,
      sessions: sessionStats,
      contextHealth: contextStats,
    };
  },

  "GET /api/metrics/storage": () => {
    return buildStorageMetrics();
  },

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
