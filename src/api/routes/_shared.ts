/**
 * Shared route helpers + types extracted from routes.ts.
 * Pure functions (parsing, metrics, storage, LSP normalization, session
 * sanitization) used across multiple route domains.
 */
import { existsSync, statSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import type { MetricsEntry } from "../queries";
import { cybaraDir, dataDir, memoryDir, logsDir, secureDir, userSkillsDir } from "../../core/paths";
import { getArtifactsRootDir } from "../../core/artifacts";
import { sanitizeTodoToolResult } from "../../core/session-plan";
import type { ChatMessage } from "../chat";
import type { WalletChain, WalletTokenChain } from "../../core/wallet";
import { sanitizeAssistantContent } from "../../core/llm/text-tool-calls";
import { sanitizeProcessThoughtText } from "../chat-formatting";
import { sanitizeToolMediaResult } from "../chat-media-result";
import {
  providerManager,
  providers,
  resolveProviderType,
  type ProviderType,
} from "../../core/providers";
import type { AuthResult } from "../security";

export interface LspDiagnosticLike {
  severity?: number;
  message?: string;
  source?: string;
  code?: string | number;
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
}

export interface LspLocationLike {
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

export interface LspSymbolLike {
  name?: string;
  kind?: number;
  detail?: string;
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  selectionRange?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  location?: {
    range?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
  };
  children?: LspSymbolLike[];
}

export interface NormalizedLspSymbol {
  name: string;
  kind: number;
  detail?: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  children?: NormalizedLspSymbol[];
}

export type SessionMessageView = ChatMessage & {
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

export interface MetricTopKey {
  key: string;
  total: number;
}

export interface ProviderMetricSummary {
  provider: string;
  hits: number;
  tokens: number;
  url: string;
}

export interface MetricTrend {
  current: number;
  previous: number;
  changePct: number;
  direction: "up" | "down" | "flat";
}

export interface TokenCallSnapshot {
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

export interface TokenCloudEntry {
  token: string;
  category: "model" | "provider" | "tool" | "term" | "pattern";
  weight: number;
  sharePct: number;
}
export const WALLET_CHAIN_SET = new Set<WalletChain>(["eth", "btc", "sol"]);
export const WALLET_TOKEN_CHAIN_SET = new Set<WalletTokenChain>(["eth", "sol"]);

export interface RouteContext {
  headers: Record<string, string>;
  rawBody?: string;
  url?: string;
  auth?: AuthResult;
}
export type RouteHandler = (
  body?: unknown,
  params?: Record<string, string>,
  ctx?: RouteContext
) => Promise<unknown> | unknown;
export function parseJsonObject(value: unknown): Record<string, unknown> | null {
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

export function parseMetricMetadata(metadata?: string): Record<string, unknown> | null {
  return parseJsonObject(metadata);
}

export function metricTimestampToMs(createdAt?: string): number | null {
  if (!createdAt) return null;
  const hasTimezone =
    createdAt.includes("Z") || createdAt.includes("+") || createdAt.slice(10).includes("-");
  const normalized = hasTimezone ? createdAt : createdAt.replace(" ", "T") + "Z";
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sumMetricValues(
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

export function buildMetricTrend(current: number, previous: number): MetricTrend {
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

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function localDateKeyFromMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function safeFileSizeBytes(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export async function safeDirSizeBytes(path: string): Promise<number> {
  try {
    if (!existsSync(path)) return 0;
    const stack = [path];
    let total = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
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
            total += (await stat(fullPath)).size;
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

export type StorageTopLevelEntry = {
  name: string;
  path: string;
  bytes: number;
  type: "directory" | "file";
};

export async function collectTopLevelStorageEntries(
  rootDir: string
): Promise<StorageTopLevelEntry[]> {
  try {
    if (!existsSync(rootDir)) return [];
    const entries = await readdir(rootDir, { withFileTypes: true });
    const topLevelEntries = await Promise.all(
      entries.map(async (entry): Promise<StorageTopLevelEntry | null> => {
        const fullPath = join(rootDir, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: fullPath,
            bytes: await safeDirSizeBytes(fullPath),
            type: "directory",
          };
        }
        if (entry.isFile()) {
          return {
            name: entry.name,
            path: fullPath,
            bytes: safeFileSizeBytes(fullPath),
            type: "file",
          };
        }
        return null;
      })
    );
    return topLevelEntries
      .filter((entry): entry is StorageTopLevelEntry => entry !== null)
      .sort((a, b) => b.bytes - a.bytes);
  } catch {
    return [];
  }
}

const STORAGE_METRICS_TTL_MS = 5 * 60_000;
type StorageMetrics = Awaited<ReturnType<typeof computeStorageMetrics>>;
let storageMetricsCache: { at: number; value: StorageMetrics } | null = null;
let storageMetricsInFlight: Promise<StorageMetrics> | null = null;

export function buildStorageMetrics(): Promise<StorageMetrics> {
  const now = Date.now();
  if (storageMetricsCache && now - storageMetricsCache.at < STORAGE_METRICS_TTL_MS) {
    return Promise.resolve(storageMetricsCache.value);
  }
  if (storageMetricsInFlight) return storageMetricsInFlight;
  const task = computeStorageMetrics()
    .then((value) => {
      storageMetricsCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (storageMetricsInFlight === task) storageMetricsInFlight = null;
    });
  storageMetricsInFlight = task;
  return task;
}

async function computeStorageMetrics() {
  const dbMainPath = join(dataDir, "platform.db");
  const dbWalPath = join(dataDir, "platform.db-wal");
  const dbShmPath = join(dataDir, "platform.db-shm");
  const artifactsDir = getArtifactsRootDir();
  const sessionsDir = join(cybaraDir, "sessions");
  const mediaDir = join(cybaraDir, "media");
  const channelsDir = join(cybaraDir, "channels");
  const topLevelEntries = await collectTopLevelStorageEntries(cybaraDir);
  const topLevelBytesByName = new Map(topLevelEntries.map((entry) => [entry.name, entry.bytes]));
  const topLevelTotalBytes = topLevelEntries.reduce((sum, entry) => sum + entry.bytes, 0);

  const databaseMainBytes = safeFileSizeBytes(dbMainPath);
  const databaseWalBytes = safeFileSizeBytes(dbWalPath);
  const databaseShmBytes = safeFileSizeBytes(dbShmPath);
  const databaseBytes = databaseMainBytes + databaseWalBytes + databaseShmBytes;
  const dataBytes = topLevelBytesByName.get("data") ?? (await safeDirSizeBytes(dataDir));
  const artifactsBytes =
    topLevelBytesByName.get("artifacts") ?? (await safeDirSizeBytes(artifactsDir));
  const logsBytes = topLevelBytesByName.get("logs") ?? (await safeDirSizeBytes(logsDir));
  const memoryBytes = topLevelBytesByName.get("memory") ?? (await safeDirSizeBytes(memoryDir));
  const secureBytes = topLevelBytesByName.get("secure") ?? (await safeDirSizeBytes(secureDir));
  const skillsBytes = topLevelBytesByName.get("skills") ?? (await safeDirSizeBytes(userSkillsDir));
  const sessionsBytes =
    topLevelBytesByName.get("sessions") ?? (await safeDirSizeBytes(sessionsDir));
  const mediaBytes = topLevelBytesByName.get("media") ?? (await safeDirSizeBytes(mediaDir));
  const channelsBytes =
    topLevelBytesByName.get("channels") ?? (await safeDirSizeBytes(channelsDir));

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

export const ACTIVE_SESSION_STATUSES = new Set([
  "thinking",
  "generating",
  "tool_executing",
  "compacting",
]);

export function isSessionStatusActive(status?: string): boolean {
  return typeof status === "string" && ACTIVE_SESSION_STATUSES.has(status);
}

export function buildTokenCallSnapshots(tokenUsageEntries: MetricsEntry[]): TokenCallSnapshot[] {
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

export function buildAssistantOutputCloud(
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

export function classifyModelBehavior(
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

export function parseWalletChains(input: unknown): WalletChain[] | undefined {
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

export function parseWalletTokenChain(
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

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSecretString(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  const compact = normalized.replace(/\r?\n/g, "");
  return compact.trim() || undefined;
}

export function buildGoogleAuthHeaders(
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

export function isLikelyGoogleApiKey(value: string): boolean {
  return /^AIza[0-9A-Za-z_-]+$/.test(value.trim());
}

export function formatChannelTestError(channelType: string, error: unknown): string {
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
export function getDefaultSystemPromptConfig(): Record<string, unknown> {
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

export function getDefaultIdentityConfig(): Record<string, unknown> {
  return {
    name: "Cybara",
    emoji: "🧠",
    creature: "AI assistant",
    vibe: "Professional, helpful, and concise",
    theme: "dark",
    avatar: "",
  };
}

export function normalizeSystemPromptConfig(value: unknown): Record<string, unknown> {
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

export function normalizeIdentityConfig(value: unknown): Record<string, unknown> {
  const defaults = getDefaultIdentityConfig();
  const parsed = parseJsonObject(value);
  return parsed ? { ...defaults, ...parsed } : defaults;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeArtifactSummary(value: unknown): Record<string, unknown> | undefined {
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

export function sanitizeArtifactToolResult(result: unknown): Record<string, unknown> | undefined {
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

export function isArtifactToolCall(toolCall: unknown): boolean {
  if (!isObjectRecord(toolCall)) return false;
  const name = typeof toolCall.name === "string" ? toolCall.name.toLowerCase() : "";
  if (name === "artifacts" || name === "artifact") return true;
  return !!sanitizeArtifactToolResult(toolCall.result);
}

function isTodoToolCall(toolCall: unknown): boolean {
  if (!isObjectRecord(toolCall)) return false;
  return typeof toolCall.name === "string" && toolCall.name.toLowerCase() === "todo";
}

export function sanitizeProcessActivities(
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
      entry.phase === "start" ||
      entry.phase === "result" ||
      entry.phase === "error" ||
      entry.phase === "blocked"
        ? entry.phase
        : "result";
    const rawText = typeof entry.text === "string" ? entry.text.trim() : "";
    const text = entry.toolName === "__thought" ? sanitizeProcessThoughtText(rawText) : rawText;
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

export function sanitizeSessionMessages(
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
    const content =
      msg?.role === "assistant" && typeof msg.content === "string"
        ? sanitizeAssistantContent(msg.content)
        : msg?.content;
    const sanitizedProcessActivities = sanitizeProcessActivities(
      msg.process_activities,
      PROCESS_OPTIONS
    );

    if (!msg || !msg.tool_calls || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
      if (!sanitizedProcessActivities && content === msg.content) {
        return msg;
      }
      return {
        ...msg,
        content,
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
          const todoResult = isTodoToolCall(tc) ? sanitizeTodoToolResult(tc.result) : undefined;
          const mediaResult = sanitizeToolMediaResult(tc.result);
          if (mediaResult) {
            sanitized.result = mediaResult;
          } else if (artifactResult) {
            sanitized.result = artifactResult;
          } else if (todoResult) {
            sanitized.result = todoResult;
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
      content,
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

export interface DictationAudioPayload {
  bytes: Uint8Array;
  mimeType: string;
}

export function decodeDictationAudioBase64(
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

export function pickDictationProvider(preferredProviderId?: string) {
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

export async function transcribeWithOpenAICompatibleProvider(input: {
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
