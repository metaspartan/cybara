#!/usr/bin/env bun
import { getAppVersion } from "../core/build-info";
import { runMcpStdioServer } from "../core/mcp-host-server";
import { runGatewayForeground, startGatewayBackground } from "./gateway-process";
import { runMobileCommand } from "./commands/mobile";
import { runNearbyCommand } from "./commands/nearby";
import { rawHelp } from "./commands/help";
import { printCompletion } from "./commands/completion";
import { rawComputerUse } from "./commands/computer-use";
import { createCliPluginCommands } from "./commands/plugin-commands";
import { createCliProviderCommands } from "./commands/provider-commands";
import {
  accessibilityConfigLines,
  buildCliConfigPatch,
  parseCliConfigValue,
} from "./commands/config";
import { configureChatCli, rawAgent, rawChatCommand } from "./commands/chat";
import { runSubagentCommand } from "./commands/subagents";
import { printArtifacts, printJourney } from "./commands/resource-commands";
import { getFlagValue, hasFlag } from "./commands/args";
import { rawUpdate } from "./commands/update";
import { runEvalCommand } from "./commands/evals";
import { runSystemBackupCommand } from "./commands/system-backup";
import { runTelemetryCommand } from "./commands/telemetry";
import { runPermissionsCommand } from "./commands/permissions";
import { type MetricsResponse } from "./commands/status-contract";
import { rawDoctor, rawStatus } from "./commands/status";
import {
  configureWalletCli,
  rawWalletAccounts,
  rawWalletAgentAccess,
  rawWalletAgentPolicy,
  rawWalletBalances,
  rawWalletCreate,
  rawWalletDapp,
  rawWalletDapps,
  rawWalletEndpoints,
  rawWalletEthContractCall,
  rawWalletImport,
  rawWalletLock,
  rawWalletPrice,
  rawWalletReceive,
  rawWalletRevealSeed,
  rawWalletRpc,
  rawWalletRpcCall,
  rawWalletSend,
  rawWalletSendToken,
  rawWalletSolInstruction,
  rawWalletStatus,
  rawWalletSwap,
  rawWalletSwapEthUniswap,
  rawWalletTokenBalances,
  rawWalletTokenTransactions,
  rawWalletTransactions,
  rawWalletUnlock,
  rawWalletX402,
} from "./commands/wallet";
import {
  CLI_API_BASE as API_BASE,
  CLI_API_KEY,
  fetchCliAPI as fetchAPI,
  TUI_INPUT_OPTIONS,
  withCliAuthHeaders,
} from "./client";
import {
  type AgentItem,
  type LogEntry,
  type SessionInfo,
  type SkillItem,
  type TaskItem,
  sessionAgentLabel,
  sessionMessageCount,
  sessionUpdatedAt,
} from "./contracts";
import {
  rawLsp,
  rawLspInstall,
  rawLspUninstall,
  rawMcpAdd,
  rawMcpInstall,
  rawMcpList,
  rawMcpPopular,
  rawMcpSearch,
  rawPairCommand,
} from "./commands/integrations";
import {
  rawLoopCancel,
  rawLoopList,
  rawLoopShow,
  rawLoopStart,
} from "./commands/loops";

configureWalletCli({ apiBase: API_BASE, withAuthHeaders: withCliAuthHeaders });

async function runConnectorCliCommand(commandArgs: string[]): Promise<void> {
  const { runConnectorCommand } = await import("./commands/connectors");
  await runConnectorCommand(commandArgs, fetchAPI);
}

async function renderTUI(commandOverride?: string): Promise<void> {
  const [{ render }, { TUIApp }] = await Promise.all([
    import("ink"),
    import("./tui/components/app"),
  ]);
  render(<TUIApp command={commandOverride} />);
}

interface TokenAnalysisResponse {
  summary: {
    callCount: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    averageTokensPerCall: number;
    medianTokensPerCall: number;
    inputToOutputRatio: number | null;
    outputToInputRatio: number | null;
  };
  tokenHeatmap: {
    hottestHour: {
      date: string;
      dayLabel: string;
      hour: number;
      tokens: number;
      calls: number;
    } | null;
  };
  promptOutputDistribution: {
    sampleCount: number;
    bands: Array<{ band: string; calls: number; sharePct: number }>;
  };
  tokenCloud: Array<{
    token: string;
    category: "model" | "provider" | "tool" | "term" | "pattern";
    weight: number;
    sharePct: number;
  }>;
  modelThoughtProfiles: Array<{
    model: string;
    provider: string;
    totalTokens: number;
    calls: number;
    promptSharePct: number;
    responseSharePct: number;
    avgTokensPerCall: number;
    avgLatencyMs: number;
    avgTps: number;
    behavior: string;
  }>;
  topTokenBursts: Array<{
    timestamp: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number | null;
    tokensPerSecond: number | null;
  }>;
}

const pluginCommands = createCliPluginCommands(fetchAPI, API_BASE);
const {
  add: rawProviderAdd,
  available: rawProviderAvailable,
  delete: rawProviderDelete,
  discover: rawProviderDiscover,
  list: rawProviders,
  models: rawProviderModels,
  parseFlags: parseProviderFlags,
  parsePoolFlags: parseProviderPoolFlags,
  poolCreate: rawProviderPoolCreate,
  poolDelete: rawProviderPoolDelete,
  poolList: rawProviderPoolList,
  poolUpdate: rawProviderPoolUpdate,
  update: rawProviderUpdate,
} = createCliProviderCommands(fetchAPI, API_BASE, withCliAuthHeaders);

configureChatCli({
  apiBase: API_BASE,
  fetchAPI,
  withAuthHeaders: withCliAuthHeaders,
});

async function rawMigrate(args: string[]): Promise<void> {
  const { detectMigrationSources, normalizeMigrationSourceKind, runSourceMigration } =
    await import("../core/source-migration");
  const json = hasFlag(args, "--json", "-j");
  const subcommand = args.find((arg) => !arg.startsWith("--"));
  if (subcommand === "sources" || subcommand === "detect") {
    const sources = detectMigrationSources();
    if (json) {
      console.log(JSON.stringify({ sources }, null, 2));
      return;
    }
    console.log("Migration Sources");
    console.log("=================");
    for (const source of sources) {
      const status = source.exists ? "found" : "missing";
      console.log(
        `${status.padEnd(7)} ${source.kind.padEnd(12)} ${source.path}`,
      );
      if (source.exists) {
        console.log(
          `        memory=${source.detected.memoryFiles} skills=${source.detected.skillCount} config=${source.detected.configFiles}`,
        );
      }
    }
    return;
  }

  const sourceKind = normalizeMigrationSourceKind(
    getFlagValue(args, "--from") || subcommand,
  );
  const presetFlag = getFlagValue(args, "--preset");
  const skillConflictFlag = getFlagValue(args, "--skill-conflict");
  const apply = hasFlag(args, "--apply", "--execute", "--yes", "-y");
  const report = await runSourceMigration({
    sourceKind,
    sourcePath: getFlagValue(args, "--source"),
    preset: presetFlag === "full" ? "full" : "user-data",
    dryRun: !apply,
    overwrite: hasFlag(args, "--overwrite"),
    migrateSecrets: hasFlag(args, "--migrate-secrets"),
    skillConflict:
      skillConflictFlag === "overwrite" || skillConflictFlag === "rename"
        ? skillConflictFlag
        : "skip",
    workspaceTarget: getFlagValue(args, "--workspace-target"),
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(report.dryRun ? "Migration Preview" : "Migration Complete");
  console.log("=================");
  console.log(`source: ${report.sourceKind} ${report.sourceRoot}`);
  console.log(`target: ${report.targetRoot}`);
  console.log(
    `items: ${report.summary.migrated} migrated, ${report.summary.planned} planned, ${report.summary.conflict} conflicts, ${report.summary.skipped} skipped, ${report.summary.error} errors`,
  );
  for (const warning of report.warnings) {
    console.log(`warning: ${warning}`);
  }
  for (const entry of report.items) {
    console.log(
      `${entry.status.padEnd(9)} ${entry.category.padEnd(9)} ${entry.name}`,
    );
    if (entry.detail) console.log(`          ${entry.detail}`);
  }
  if (report.reportPath) console.log(`report: ${report.reportPath}`);
  if (report.dryRun) {
    console.log("");
    console.log("Apply with: cybara migrate --apply");
  }
}

async function rawMetrics(): Promise<void> {
  const data = await fetchAPI<MetricsResponse>("/api/metrics/overview");
  if (!data) {
    console.error("ERROR: Failed to fetch metrics from", API_BASE);
    process.exit(1);
  }

  console.log("CYBARA METRICS");
  console.log("==============");
  console.log("");
  console.log("TOKEN USAGE");
  console.log(`  total: ${data.tokenUsage?.total || 0}`);
  console.log(`  input: ${data.tokenUsage?.input || 0}`);
  console.log(`  output: ${data.tokenUsage?.output || 0}`);
  console.log(`  cache: ${data.tokenUsage?.cache || 0}`);
  console.log("");
  console.log("FILE OPERATIONS");
  console.log(`  files_read: ${data.fileOperations?.filesRead || 0}`);
  console.log(`  files_written: ${data.fileOperations?.filesWritten || 0}`);
  console.log(`  files_edited: ${data.fileOperations?.filesEdited || 0}`);
  console.log("");
  console.log("TOOL CALLS");
  console.log(`  total: ${data.toolCalls?.totalCalls || 0}`);
  console.log("");
  console.log("API CALLS");
  console.log(`  total: ${data.apiCalls?.totalCalls || 0}`);
  console.log(`  success: ${data.apiCalls?.successfulCalls || 0}`);
  console.log(`  failed: ${data.apiCalls?.failedCalls || 0}`);
}

async function rawMetricsAnalysis(): Promise<void> {
  const data = await fetchAPI<TokenAnalysisResponse>(
    "/api/metrics/token-analysis",
  );
  if (!data) {
    console.error("ERROR: Failed to fetch token analysis from", API_BASE);
    process.exit(1);
  }

  console.log("CYBARA TOKEN ANALYSIS");
  console.log("=====================");
  console.log("");
  console.log("SUMMARY");
  console.log(`  calls: ${data.summary?.callCount || 0}`);
  console.log(`  total_tokens: ${data.summary?.totalTokens || 0}`);
  console.log(
    `  avg_tokens_per_call: ${data.summary?.averageTokensPerCall || 0}`,
  );
  console.log(
    `  median_tokens_per_call: ${data.summary?.medianTokensPerCall || 0}`,
  );
  console.log(
    `  input_to_output_ratio: ${data.summary?.inputToOutputRatio !== null && data.summary?.inputToOutputRatio !== undefined ? `${data.summary.inputToOutputRatio}:1` : "n/a"}`,
  );
  console.log("");

  console.log("HEATMAP");
  const hottest = data.tokenHeatmap?.hottestHour;
  if (hottest) {
    console.log(
      `  hottest_window: ${hottest.dayLabel} ${String(hottest.hour).padStart(2, "0")}:00 (${hottest.tokens} tokens, ${hottest.calls} calls)`,
    );
  } else {
    console.log("  hottest_window: n/a");
  }
  console.log("");

  console.log("PROMPT/OUTPUT BANDS");
  for (const band of data.promptOutputDistribution?.bands || []) {
    console.log(`  ${band.band}: ${band.calls} calls (${band.sharePct}%)`);
  }
  console.log("");

  console.log("TOKEN CLOUD");
  const cloud = (data.tokenCloud || []).slice(0, 12);
  if (cloud.length === 0) {
    console.log("  no data");
  } else {
    for (const entry of cloud) {
      console.log(`  ${entry.token} [${entry.category}] ${entry.sharePct}%`);
    }
  }
  console.log("");

  console.log("MODEL THOUGHT PROFILES");
  const profiles = (data.modelThoughtProfiles || []).slice(0, 8);
  if (profiles.length === 0) {
    console.log("  no data");
  } else {
    for (const profile of profiles) {
      console.log(
        `  ${profile.model} (${profile.provider}) ${profile.behavior} | prompt=${profile.promptSharePct}% output=${profile.responseSharePct}% tps=${profile.avgTps} latency=${profile.avgLatencyMs}ms`,
      );
    }
  }
  console.log("");

  console.log("TOP TOKEN BURSTS");
  const bursts = (data.topTokenBursts || []).slice(0, 5);
  if (bursts.length === 0) {
    console.log("  no data");
  } else {
    for (const burst of bursts) {
      console.log(
        `  ${burst.timestamp} ${burst.model} (${burst.provider}) ${burst.totalTokens} tokens`,
      );
    }
  }
}

async function rawAgents(): Promise<void> {
  const data = await fetchAPI<AgentItem[]>("/api/agents/summary");
  if (!data) {
    console.error("ERROR: Failed to fetch agents from", API_BASE);
    process.exit(1);
  }

  const agents = Array.isArray(data) ? data : [];
  console.log("CYBARA AGENTS");
  console.log("=============");
  console.log(`total: ${agents.length}`);
  console.log("");

  if (agents.length === 0) {
    console.log("No agents configured");
    return;
  }

  for (const agent of agents) {
    console.log(`- ${agent.name}`);
    console.log(`  id: ${agent.id}`);
    console.log(`  type: ${agent.type}`);
    console.log(`  status: ${agent.status || "inactive"}`);
    if (agent.model) console.log(`  model: ${agent.model}`);
  }
}

async function rawTasks(): Promise<void> {
  const data = await fetchAPI<TaskItem[]>("/api/tasks");
  if (!data) {
    console.error("ERROR: Failed to fetch tasks from", API_BASE);
    process.exit(1);
  }

  const tasks = Array.isArray(data) ? data : [];
  console.log("CYBARA TASKS");
  console.log("============");
  console.log(`total: ${tasks.length}`);
  console.log("");

  if (tasks.length === 0) {
    console.log("No tasks scheduled");
    return;
  }

  for (const task of tasks) {
    console.log(`- ${task.name}`);
    console.log(`  id: ${task.id}`);
    console.log(`  status: ${task.status}`);
    if (task.schedule) console.log(`  schedule: ${task.schedule}`);
    if (task.session_id) console.log(`  chat: ${task.session_id}`);
    if (task.lastRun) console.log(`  last_run: ${task.lastRun}`);
  }
}

async function rawSkills(): Promise<void> {
  const data = await fetchAPI<{ skills: SkillItem[] }>("/api/skills/status");
  if (!data) {
    console.error("ERROR: Failed to fetch skills from", API_BASE);
    process.exit(1);
  }

  const skills = data.skills || [];
  const eligible = skills.filter((s) => s.eligible).length;

  console.log("CYBARA SKILLS");
  console.log("=============");
  console.log(`total: ${skills.length}`);
  console.log(`eligible: ${eligible}`);
  console.log(`blocked: ${skills.length - eligible}`);
  console.log("");

  if (skills.length === 0) {
    console.log("No skills installed");
    return;
  }

  console.log("ELIGIBLE:");
  for (const skill of skills.filter((s) => s.eligible)) {
    console.log(`  - ${skill.name} (${skill.source})`);
  }

  console.log("");
  console.log("BLOCKED:");
  for (const skill of skills.filter((s) => !s.eligible)) {
    console.log(`  - ${skill.name} (${skill.source})`);
  }
}

async function rawSessions(): Promise<void> {
  const [data, agents] = await Promise.all([
    fetchAPI<SessionInfo[]>("/api/sessions"),
    fetchAPI<AgentItem[]>("/api/agents/summary"),
  ]);
  if (!data) {
    console.error("ERROR: Failed to fetch sessions from", API_BASE);
    process.exit(1);
  }

  const sessions = Array.isArray(data) ? data : [];
  const agentsById = new Map(
    (Array.isArray(agents) ? agents : []).map((agent) => [agent.id, agent]),
  );

  console.log("CYBARA SESSIONS");
  console.log("===============");
  console.log(`total: ${sessions.length}`);
  console.log("");

  if (sessions.length === 0) {
    console.log("No active sessions");
    return;
  }

  for (const session of sessions.slice(0, 20)) {
    console.log(`- ${(session.title || session.id).slice(0, 80)}`);
    console.log(`  id: ${session.id.slice(0, 8)}...`);
    console.log(`  agent: ${sessionAgentLabel(session, agentsById)}`);
    console.log(`  messages: ${sessionMessageCount(session)}`);
    console.log(`  updated: ${sessionUpdatedAt(session) || "-"}`);
  }

  if (sessions.length > 20) {
    console.log(`\n... and ${sessions.length - 20} more sessions`);
  }
}

interface MemoryEntry {
  id: string;
  content: string;
  similarity?: number;
  createdAt: string;
}

async function rawMemory(query?: string): Promise<void> {
  const endpoint = query
    ? `/api/memory/search?query=${encodeURIComponent(query)}`
    : "/api/memory";

  const data = await fetchAPI<
    | MemoryEntry[]
    | {
        results?: Array<
          | MemoryEntry
          | {
              file?: string;
              entry?: {
                content?: string;
                timestamp?: string;
                date?: string;
                type?: string;
              };
            }
        >;
        memories?: Array<{
          file?: string;
          entries?: Array<{
            content?: string;
            timestamp?: string;
            date?: string;
            type?: string;
          }>;
        }>;
      }
  >(endpoint);
  if (!data) {
    console.error("ERROR: Failed to fetch memory from", API_BASE);
    process.exit(1);
  }

  const entries: Array<{ content: string; similarity?: number }> = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item.content === "string") {
        entries.push({ content: item.content, similarity: item.similarity });
      }
    }
  } else if (Array.isArray(data.results)) {
    for (const item of data.results) {
      if (item && typeof item === "object" && "entry" in item) {
        const wrapped = item as {
          entry?: { content?: string };
        };
        if (wrapped.entry && typeof wrapped.entry.content === "string") {
          entries.push({ content: wrapped.entry.content });
        }
        continue;
      }

      const flat = item as MemoryEntry;
      if (flat && typeof flat.content === "string") {
        entries.push({ content: flat.content, similarity: flat.similarity });
      }
    }
  } else if (Array.isArray(data.memories)) {
    for (const memory of data.memories) {
      for (const entry of memory.entries || []) {
        if (entry && typeof entry.content === "string") {
          entries.push({ content: entry.content });
        }
      }
    }
  }

  console.log("CYBARA MEMORY");
  console.log("=============");
  if (query) console.log(`query: "${query}"`);
  console.log(`results: ${entries.length}`);
  console.log("");

  if (entries.length === 0) {
    console.log("No memory entries found");
    return;
  }

  for (const entry of entries) {
    const preview = entry.content.slice(0, 80).replace(/\n/g, " ");
    console.log(`- ${preview}${entry.content.length > 80 ? "..." : ""}`);
    if (entry.similarity)
      console.log(`  similarity: ${(entry.similarity * 100).toFixed(1)}%`);
  }
}

async function rawLogs(count = 20): Promise<void> {
  const boundedCount = Math.max(1, Math.min(1000, Math.floor(count)));
  const logs = await fetchSystemLogs(boundedCount);

  console.log("CYBARA LOGS");
  console.log("===========");
  console.log(`showing: ${logs.length} entries`);
  console.log("");

  if (logs.length === 0) {
    console.log("No logs available");
    return;
  }

  for (const log of logs) {
    const level = (log.level || "info").toUpperCase().padEnd(5);
    const module = (log.module || log.source || log.logType || "log")
      .slice(0, 12)
      .padEnd(12);
    const timestamp = log.timestamp || log.created_at || "";
    const parsedTime = Date.parse(timestamp);
    const time = Number.isFinite(parsedTime)
      ? new Date(parsedTime).toLocaleTimeString()
      : "--:--:--";
    console.log(
      `[${time}] ${level} ${module} ${(log.message || "").slice(0, 60)}`,
    );
  }
}

async function fetchSystemLogs(count: number): Promise<LogEntry[]> {
  const boundedCount = Math.max(1, Math.min(1000, Math.floor(count)));
  const data = await fetchAPI<LogEntry[]>(
    `/api/logs/system?limit=${boundedCount}`,
  );
  if (!data) {
    console.error("ERROR: Failed to fetch logs from", API_BASE);
    process.exit(1);
  }
  return (Array.isArray(data) ? data : []).slice(0, boundedCount);
}

function parseLogCount(args: string[], fallback = 20): number {
  const flagValue = getFlagValue(args, "--tail") || getFlagValue(args, "-n");
  const raw = flagValue || args.find((arg) => /^\d+$/.test(arg));
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function rawLogsCommand(args: string[]): Promise<void> {
  const count = parseLogCount(args);
  if (!hasFlag(args, "--follow") && !hasFlag(args, "-f")) {
    await rawLogs(count);
    return;
  }

  const seen = new Set<string>();
  console.log("CYBARA LOGS");
  console.log("===========");
  console.log("following: Ctrl-C to stop");
  console.log("");

  for (;;) {
    const logs = await fetchSystemLogs(count);
    for (const log of logs.reverse()) {
      const key = [
        log.timestamp || log.created_at || "",
        log.level || "",
        log.module || log.source || log.logType || "",
        log.message || "",
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      const level = (log.level || "info").toUpperCase().padEnd(5);
      const module = (log.module || log.source || log.logType || "log")
        .slice(0, 12)
        .padEnd(12);
      const timestamp = log.timestamp || log.created_at || "";
      const parsedTime = Date.parse(timestamp);
      const time = Number.isFinite(parsedTime)
        ? new Date(parsedTime).toLocaleTimeString()
        : "--:--:--";
      console.log(
        `[${time}] ${level} ${module} ${(log.message || "").slice(0, 60)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

interface BrowserStatus {
  running: boolean;
  currentUrl?: string;
  profile?: string;
}

async function rawBrowser(): Promise<void> {
  const data = await fetchAPI<BrowserStatus>("/api/browser/status");
  if (!data) {
    console.error("ERROR: Failed to fetch browser status from", API_BASE);
    process.exit(1);
  }

  console.log("CYBARA BROWSER");
  console.log("==============");
  console.log(`status: ${data.running ? "running" : "stopped"}`);
  if (data.profile) console.log(`profile: ${data.profile}`);
  if (data.currentUrl) console.log(`url: ${data.currentUrl}`);
}

interface BrowserTab {
  id: string;
  url: string;
  title?: string;
}

async function rawBrowserProfiles(): Promise<void> {
  const data = await fetchAPI<{ tabs: BrowserTab[] }>("/api/browser/tabs");
  if (!data) {
    console.error("ERROR: Failed to fetch browser tabs from", API_BASE);
    process.exit(1);
  }

  const tabs = Array.isArray(data.tabs) ? data.tabs : [];

  console.log("BROWSER TABS");
  console.log("============");
  console.log(`total: ${tabs.length}`);
  console.log("");

  if (tabs.length === 0) {
    console.log("No open tabs");
    return;
  }

  for (const tab of tabs) {
    console.log(`- ${tab.title || tab.url}`);
    console.log(`  id: ${tab.id}`);
    console.log(`  url: ${tab.url}`);
  }
}

interface ChannelStatus {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  dmPolicy?: string;
}

async function rawChannels(): Promise<void> {
  const data = await fetchAPI<ChannelStatus[]>("/api/channels");
  if (!data) {
    console.error("ERROR: Failed to fetch channels from", API_BASE);
    process.exit(1);
  }

  const chans = Array.isArray(data) ? data : [];
  const enabled = chans.filter((c) => c.enabled).length;

  console.log("CYBARA CHANNELS");
  console.log("===============");
  console.log(`total: ${chans.length}`);
  console.log(`enabled: ${enabled}`);
  console.log("");

  if (chans.length === 0) {
    console.log("No channels configured");
    return;
  }

  for (const chan of chans) {
    const status = chan.enabled ? "✓" : "✗";
    console.log(`${status} ${chan.name} (${chan.type})`);
    if (chan.dmPolicy) console.log(`    policy: ${chan.dmPolicy}`);
  }
}

async function rawConfig(
  subCmd?: string,
  key?: string,
  value?: string,
): Promise<void> {
  if (subCmd === "accessibility") {
    const data = await fetchAPI<Record<string, unknown>>("/api/config");
    if (!data) {
      console.error("ERROR: Failed to fetch config");
      process.exit(1);
    }
    console.log("ACCESSIBILITY SETTINGS");
    console.log("======================");
    for (const line of accessibilityConfigLines(data)) console.log(`  ${line}`);
    console.log("");
    console.log(
      "Edit with: cybara config set chat_appearance.<setting> <value>",
    );
  } else if (subCmd === "get" && key) {
    const data = await fetchAPI<Record<string, unknown>>("/api/config");
    if (!data) {
      console.error("ERROR: Failed to fetch config");
      process.exit(1);
    }
    const val = (data as Record<string, unknown>)[key];
    console.log(
      val !== undefined
        ? `${key} = ${JSON.stringify(val)}`
        : `Key '${key}' not found`,
    );
  } else if (subCmd === "set" && key && value !== undefined) {
    const current = key.includes(".")
      ? await fetchAPI<Record<string, unknown>>("/api/config")
      : {};
    if (!current) {
      console.error("ERROR: Failed to fetch config");
      process.exit(1);
      return;
    }
    let coerced: unknown;
    let patch: Record<string, unknown>;
    try {
      coerced = parseCliConfigValue(value);
      patch = buildCliConfigPatch(current, key, coerced);
    } catch (error) {
      console.error(
        `ERROR: ${error instanceof Error ? error.message : "Invalid config value"}`,
      );
      process.exit(1);
      return;
    }
    const resp = await fetch(`${API_BASE}/api/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (resp.ok) {
      console.log(`✓ Set ${key} = ${JSON.stringify(coerced)}`);
    } else {
      console.error(`ERROR: Failed to set config: ${resp.status}`);
      process.exit(1);
    }
  } else {
    const data = await fetchAPI<Record<string, unknown>>("/api/config");
    if (!data) {
      console.error("ERROR: Failed to fetch config");
      process.exit(1);
    }
    console.log("CYBARA CONFIG");
    console.log("=============");
    for (const [k, v] of Object.entries(data)) {
      console.log(`  ${k} = ${JSON.stringify(v)}`);
    }
  }
}

async function rawRouter(args: string[]): Promise<void> {
  const subCmd = args[0];

  if (subCmd === "status" || !subCmd) {
    const status = await fetchAPI<{
      enabled: boolean;
      strategy: string;
      globalSpendToday: number;
      globalSpendLimitDaily?: number;
      routes: Array<{
        providerId: string;
        weight: number;
        enabled: boolean;
        available: boolean;
        reason?: string;
        requestsIn5hWindow: number;
        requestsInWeekWindow: number;
        spendToday: number;
        spendThisWeek: number;
        priceInputPerM?: number;
        priceOutputPerM?: number;
      }>;
    }>("/api/router/status");
    if (!status) {
      console.error("ERROR: Failed to fetch router status");
      process.exit(1);
    }
    console.log("MODEL ROUTER");
    console.log("============");
    console.log(`  Enabled:     ${status.enabled ? "yes" : "no"}`);
    console.log(`  Strategy:    ${status.strategy}`);
    console.log(
      `  Global Spend: $${status.globalSpendToday.toFixed(4)}${status.globalSpendLimitDaily ? ` / $${status.globalSpendLimitDaily} (daily limit)` : ""}`,
    );
    console.log("");
    console.log("ROUTES");
    console.log("------");
    for (const route of status.routes) {
      const state = !route.enabled
        ? "DISABLED"
        : route.available
          ? "available"
          : `BLOCKED (${route.reason})`;
      console.log(`  ${route.providerId}`);
      console.log(`    Weight:    ${route.weight}`);
      console.log(`    State:     ${state}`);
      console.log(`    5h reqs:   ${route.requestsIn5hWindow}`);
      console.log(`    Week reqs: ${route.requestsInWeekWindow}`);
      console.log(`    Today:     $${route.spendToday.toFixed(4)}`);
      console.log(`    Week:      $${route.spendThisWeek.toFixed(4)}`);
      if (route.priceInputPerM || route.priceOutputPerM) {
        console.log(
          `    Price:     $${route.priceInputPerM ?? 0}/M in, $${route.priceOutputPerM ?? 0}/M out`,
        );
      }
      console.log("");
    }
    return;
  }

  if (subCmd === "enable" || subCmd === "disable") {
    const current =
      (await fetchAPI<Record<string, unknown>>("/api/router/config")) ||
      ({ strategy: "weighted", fallbackToAny: true, routes: {} } as Record<
        string,
        unknown
      >);
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...current, enabled: subCmd === "enable" }),
    });
    console.log(resp.ok ? `✓ Router ${subCmd}d` : `ERROR: ${resp.status}`);
    return;
  }

  if (subCmd === "strategy") {
    const valid = [
      "weighted",
      "round_robin",
      "lowest_cost",
      "priority",
      "usage_aware",
      "mixture_of_agents",
    ];
    const next = args[1];
    if (!next || !valid.includes(next)) {
      console.error(
        `ERROR: usage: cybara router strategy <${valid.join("|")}>`,
      );
      process.exit(1);
    }
    const current =
      (await fetchAPI<Record<string, unknown>>("/api/router/config")) ||
      ({ enabled: false, fallbackToAny: true, routes: {} } as Record<
        string,
        unknown
      >);
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...current, strategy: next }),
    });
    console.log(
      resp.ok ? `✓ Router strategy set to ${next}` : `ERROR: ${resp.status}`,
    );
    return;
  }

  if (subCmd === "set" && args[1]) {
    const providerId = args[1];
    const flags = args.slice(2);
    const routeConfig: Record<string, unknown> = { weight: 50, enabled: true };
    for (const flag of flags) {
      const [k, v] = flag.split("=");
      if (!k || v === undefined) continue;
      const num = Number(v);
      switch (k) {
        case "weight":
          routeConfig.weight = num;
          break;
        case "limit5h":
          routeConfig.limit5h = num;
          break;
        case "limitWeekly":
          routeConfig.limitWeekly = num;
          break;
        case "spendDaily":
          routeConfig.spendLimitDaily = num;
          break;
        case "spendWeekly":
          routeConfig.spendLimitWeekly = num;
          break;
        case "priceIn":
          routeConfig.priceInputPerM = num;
          break;
        case "priceOut":
          routeConfig.priceOutputPerM = num;
          break;
        case "enabled":
          routeConfig.enabled = v === "true";
          break;
      }
    }
    const currentResp =
      await fetchAPI<Record<string, unknown>>("/api/router/config");
    const current = currentResp ?? {
      enabled: true,
      strategy: "weighted",
      fallbackToAny: true,
      routes: {},
    };
    const routes = (current.routes ?? {}) as Record<string, unknown>;
    routes[providerId] = routeConfig;
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...current, enabled: true, routes }),
    });
    console.log(
      resp.ok ? `✓ Route set for ${providerId}` : `ERROR: ${resp.status}`,
    );
    return;
  }

  console.log("Router Commands:");
  console.log(
    "  cybara router status              Show router status + route availability",
  );
  console.log("  cybara router enable              Enable the router");
  console.log("  cybara router disable             Disable the router");
  console.log(
    "  cybara router strategy <name>     Set strategy (weighted|round_robin|lowest_cost|priority|usage_aware|mixture_of_agents)",
  );
  console.log("  cybara router set <id> <flags>    Configure a route");
  console.log(
    "    Flags: weight=70 limit5h=100 limitWeekly=500 spendDaily=5 spendWeekly=20",
  );
  console.log("           priceIn=10 priceOut=30 enabled=true");
}

const args = process.argv.slice(2);
const command = args[0];

function wantsForegroundStart(rest: string[]): boolean {
  return hasFlag(rest, "--foreground", "--attach", "-f");
}

async function launchGateway(rest: string[]): Promise<void> {
  if (wantsForegroundStart(rest)) {
    process.exitCode = await runGatewayForeground();
    return;
  }
  const processInfo = startGatewayBackground();
  console.log(`Cybara gateway starting in the background (pid ${processInfo.pid}).`);
  console.log(`  Logs:   ${processInfo.logPath}`);
  console.log("  Status: cybara status");
  console.log("  Follow: cybara gateway logs --follow");
  console.log("  Attach instead next time with: cybara start --foreground");
}

function shouldExitAfterMain(): boolean {
  if (!command) return false;
  if (command === "mcp" && args[1] === "serve") return false;
  if (command === "chat") return false;
  if (command === "dev") return false;
  if (command === "start") return !wantsForegroundStart(args.slice(1));
  if (command === "gateway" && ["start", "run"].includes(args[1] || "")) {
    return !wantsForegroundStart(args.slice(2));
  }
  return ![
    "wizard",
    "setup",
    "install",
    "configure",
    "onboard",
    "tui",
  ].includes(command);
}

function getVersion(): string {
  return getAppVersion();
}

async function rawGatewayRestart(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/system/restart`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    supervised?: boolean;
    message?: string;
    error?: string;
  };
  if (!response.ok || result.success === false) {
    console.error(
      `ERROR: ${result.error || `Gateway restart failed (${response.status})`}`,
    );
    process.exit(1);
  }
  console.log(result.message || "Gateway restart requested.");
  if (typeof result.supervised === "boolean") {
    console.log(`supervised: ${result.supervised ? "yes" : "no"}`);
  }
}

async function rawGateway(args: string[]): Promise<void> {
  switch (args[0] || "status") {
    case "status":
    case "health":
      await rawStatus();
      break;
    case "logs":
      await rawLogsCommand(args.slice(1));
      break;
    case "restart":
      await rawGatewayRestart();
      break;
    case "start":
    case "run":
      launchGateway(args.slice(1));
      break;
    default:
      console.log("Gateway Commands:");
      console.log("  cybara gateway status          - Show gateway health");
      console.log("  cybara gateway health          - Alias for status");
      console.log("  cybara gateway logs [--tail N] - Show gateway logs");
      console.log("  cybara gateway logs --follow   - Follow gateway logs");
      console.log("  cybara gateway restart         - Restart the gateway");
      console.log(
        "  cybara gateway start           - Start the local gateway (background)",
      );
      console.log(
        "  cybara gateway start --foreground - Start attached to this terminal",
      );
      break;
  }
}

async function rawModels(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "list" || subcommand === "providers") {
    await rawProviders();
    return;
  }
  if (subcommand === "available") {
    await rawProviderAvailable();
    return;
  }
  if (subcommand === "provider") {
    await rawProviderModels(args[1]);
    return;
  }
  await rawProviderModels(subcommand);
}

async function main() {
  if (command !== "chat" && hasFlag(args, "--help", "-h")) {
    rawHelp(getVersion(), API_BASE);
    return;
  }

  switch (command) {
    case "status":
      await rawStatus();
      break;
    case "health":
      await rawStatus();
      break;
    case "gateway":
      await rawGateway(args.slice(1));
      break;
    case "backup":
    case "backups":
      await runSystemBackupCommand(args.slice(1), fetchAPI);
      break;
    case "nearby":
      await runNearbyCommand(args.slice(1), fetchAPI);
      break;
    case "doctor":
      await rawDoctor();
      break;
    case "computer-use":
    case "computeruse":
      await rawComputerUse(args, fetchAPI, API_BASE);
      break;
    case "update":
      await rawUpdate({
        version: getFlagValue(args.slice(1), "--version"),
        checkOnly:
          hasFlag(args.slice(1), "--check", "-c") || args[1] === "check",
        force: hasFlag(args.slice(1), "--force", "-F"),
      });
      break;
    case "metrics":
      if (args[1] === "analysis" || args[1] === "token-analysis") {
        await rawMetricsAnalysis();
      } else {
        await rawMetrics();
      }
      break;
    case "eval":
    case "evals":
      await runEvalCommand(args.slice(1), fetchAPI);
      break;
    case "agents":
      await rawAgents();
      break;
    case "tasks":
      await rawTasks();
      break;
    case "skills":
      await rawSkills();
      break;
    case "plugin":
    case "plugins":
      switch (args[1]) {
        case "list":
        case undefined:
          await pluginCommands.list();
          break;
        case "discover":
          await pluginCommands.discover(args.slice(2).join(" "));
          break;
        case "enable":
        case "disable":
          if (!args[2]) {
            console.error(`Usage: cybara plugin ${args[1]} <plugin-id>`);
            process.exit(1);
          }
          await pluginCommands.setEnabled(args[2], args[1] === "enable");
          break;
        case "validate":
          if (!args[2]) {
            console.error("Usage: cybara plugin validate <folder-or-zip>");
            process.exit(1);
          }
          await pluginCommands.validate(args[2]);
          break;
        case "install":
          if (!args[2]) {
            console.error("Usage: cybara plugin install <folder-or-zip>");
            process.exit(1);
          }
          await pluginCommands.install(args[2]);
          break;
        case "apps":
          await runConnectorCliCommand(["list"]);
          break;
        case "configure":
        case "connect":
        case "disconnect":
        case "setup":
          await runConnectorCliCommand(args.slice(1));
          break;
        case "delete":
        case "remove":
        case "uninstall":
          if (!args[2]) {
            console.error("Usage: cybara plugin remove <plugin-id>");
            process.exit(1);
          }
          await pluginCommands.remove(args[2]);
          break;
        default:
          console.log("Plugin Commands:");
          console.log(
            "  cybara plugin list                - List installed plugins",
          );
          console.log(
            "  cybara plugin discover [query]    - Search the plugin catalog",
          );
          console.log(
            "  cybara plugin enable <plugin-id>  - Enable an installed plugin",
          );
          console.log(
            "  cybara plugin disable <plugin-id> - Disable an installed plugin",
          );
          console.log(
            "  cybara plugin validate <folder-or-zip>  - Validate a plugin bundle",
          );
          console.log(
            "  cybara plugin install <folder-or-zip>   - Install a local plugin bundle",
          );
          console.log(
            "  cybara plugin remove <plugin-id>  - Remove an installed local plugin",
          );
          console.log(
            "  cybara plugin apps                - List account apps",
          );
          console.log(
            "  cybara plugin connect <app-id>    - Connect an account app",
          );
          break;
      }
      break;

    case "provider":
    case "providers": {
      const provSubCmd = args[1];
      const provArg = args[2];
      switch (provSubCmd) {
        case "list":
        case undefined:
          await rawProviders();
          break;
        case "available":
          await rawProviderAvailable();
          break;
        case "add": {
          const flags = parseProviderFlags(args.slice(3));
          await rawProviderAdd(
            provArg,
            flags.name,
            flags.key,
            flags.token,
            flags.isDefault,
            flags.oauth,
          );
          break;
        }
        case "update": {
          const uFlags = parseProviderFlags(args.slice(3));
          await rawProviderUpdate(
            provArg,
            uFlags.name,
            uFlags.key,
            uFlags.token,
            uFlags.isDefault,
          );
          break;
        }
        case "pool": {
          const poolCommand = args[2] || "list";
          if (poolCommand === "list") await rawProviderPoolList();
          else if (poolCommand === "create") {
            await rawProviderPoolCreate(parseProviderPoolFlags(args.slice(3)));
          } else if (poolCommand === "update") {
            await rawProviderPoolUpdate(args[3], parseProviderPoolFlags(args.slice(4)));
          } else if (poolCommand === "delete" || poolCommand === "remove") {
            await rawProviderPoolDelete(args[3]);
          } else {
            console.log("Provider Pool Commands:");
            console.log("  cybara provider pool list");
            console.log(
              "  cybara provider pool create --name <name> --provider <type> --account <provider-id[:priority]>"
            );
            console.log(
              "  cybara provider pool update <pool-id> --name <name> --provider <type> --account <provider-id[:priority]>"
            );
            console.log("  Omit :priority to balance accounts by tracked plan usage");
            console.log("  cybara provider pool delete <pool-id>");
          }
          break;
        }
        case "delete":
        case "remove":
          await rawProviderDelete(provArg);
          break;
        case "models":
          await rawProviderModels(provArg);
          break;
        case "discover":
          await rawProviderDiscover();
          break;
        default:
          console.log("Provider Commands:");
          console.log(
            "  cybara provider              - List configured providers",
          );
          console.log(
            "  cybara provider available     - Show available provider types",
          );
          console.log("  cybara provider add <type>    - Add provider");
          console.log("    --name NAME   Display name");
          console.log("    --key KEY     API key");
          console.log("    --token TOK   Access token");
          console.log("    --oauth       Connect via OAuth device code flow");
          console.log("    --default     Set as default");
          console.log("  cybara provider update <id>   - Update provider");
          console.log("  cybara provider pool          - Manage named account pools");
          console.log("  cybara provider delete <id>   - Delete provider");
          console.log("  cybara provider models <id>   - List provider models");
          console.log(
            "  cybara provider discover      - Discover Ollama models",
          );
          break;
      }
      break;
    }
    case "model":
    case "models":
      await rawModels(args.slice(1));
      break;
    case "chat":
      await rawChatCommand(args.slice(1));
      break;
    case "agent":
      await rawAgent(args.slice(1));
      break;
    case "config":
      await rawConfig(args[1], args[2], args[3]);
      break;
    case "settings":
      await rawConfig(args[1], args[2], args[3]);
      break;
    case "telemetry":
      await runTelemetryCommand(args.slice(1), { fetchAPI });
      break;
    case "permissions":
      await runPermissionsCommand(args.slice(1), { fetchAPI });
      break;
    case "migrate":
    case "migration":
      await rawMigrate(args.slice(1));
      break;
    case "router":
      await rawRouter(args.slice(1));
      break;
    case "acp":
      await (await import("./commands/acp")).runAcpCommand(args.slice(1));
      break;
    case "sessions":
      await rawSessions();
      break;
    case "mobile":
      await runMobileCommand(args.slice(1), {
        apiBase: API_BASE,
        apiKey: CLI_API_KEY,
        fetchAPI,
        getFlagValue,
        hasFlag,
      });
      break;
    case "devices":
      await runMobileCommand(args[1] ? args.slice(1) : ["list"], {
        apiBase: API_BASE,
        apiKey: CLI_API_KEY,
        fetchAPI,
        getFlagValue,
        hasFlag,
      });
      break;
    case "memory":
      await rawMemory(args[1]);
      break;
    case "artifacts":
      await printArtifacts(fetchAPI, hasFlag(args, "--json", "-j"));
      break;
    case "journey":
      await printJourney(fetchAPI, hasFlag(args, "--json", "-j"));
      break;
    case "logs": {
      await rawLogsCommand(args.slice(1));
      break;
    }
    case "subagent":
    case "subagents":
      await runSubagentCommand(args.slice(1), {
        apiBase: API_BASE,
        withAuthHeaders: withCliAuthHeaders,
      });
      break;
    case "loop":
    case "loops":
      switch (args[1]) {
        case "list":
        case undefined:
          await rawLoopList(getFlagValue(args.slice(2), "--agent"));
          break;
        case "start":
          await rawLoopStart(args[2], args.slice(3));
          break;
        case "show":
        case "get":
          await rawLoopShow(args[2]);
          break;
        case "cancel":
        case "stop":
          await rawLoopCancel(args[2]);
          break;
        default:
          console.log("Loop Commands:");
          console.log(
            "  cybara loop list [--agent <id>]      - List loop runs",
          );
          console.log(
            "  cybara loop start <agent-id> <obj>   - Start loop run",
          );
          console.log(
            "  cybara loop show <run-id>            - Show loop details",
          );
          console.log(
            "  cybara loop cancel <run-id>          - Cancel loop run",
          );
          break;
      }
      break;
    case "browser":
      switch (args[1]) {
        case "tabs":
          await rawBrowserProfiles();
          break;
        default:
          await rawBrowser();
          break;
      }
      break;
    case "channels":
    case "channel":
      await rawChannels();
      break;
    case "wallet": {
      const walletSubCmd = args[1] || "status";
      const walletArgs = args.slice(2);

      switch (walletSubCmd) {
        case "status":
          await rawWalletStatus();
          break;
        case "create":
          await rawWalletCreate(getFlagValue(walletArgs, "--password"));
          break;
        case "import":
          await rawWalletImport(
            getFlagValue(walletArgs, "--password"),
            getFlagValue(walletArgs, "--mnemonic"),
          );
          break;
        case "unlock":
          await rawWalletUnlock(getFlagValue(walletArgs, "--password"));
          break;
        case "reveal-seed":
          await rawWalletRevealSeed(
            getFlagValue(walletArgs, "--password"),
            getFlagValue(walletArgs, "--confirm"),
          );
          break;
        case "lock":
          await rawWalletLock();
          break;
        case "accounts":
          await rawWalletAccounts(
            getFlagValue(walletArgs, "--chains"),
            getFlagValue(walletArgs, "--count"),
            getFlagValue(walletArgs, "--start"),
          );
          break;
        case "balances":
          await rawWalletBalances(
            getFlagValue(walletArgs, "--chains"),
            getFlagValue(walletArgs, "--count"),
            getFlagValue(walletArgs, "--start"),
          );
          break;
        case "tokens":
          await rawWalletTokenBalances(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
            walletArgs.includes("--include-zero"),
          );
          break;
        case "token-tx":
        case "token-transactions":
          await rawWalletTokenTransactions(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
            getFlagValue(walletArgs, "--limit"),
            getFlagValue(walletArgs, "--token"),
            getFlagValue(walletArgs, "--rpc"),
          );
          break;
        case "tx":
        case "transactions":
          await rawWalletTransactions(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
            getFlagValue(walletArgs, "--limit"),
          );
          break;
        case "receive":
          await rawWalletReceive(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
          );
          break;
        case "send":
          await rawWalletSend(walletArgs);
          break;
        case "send-token":
          await rawWalletSendToken(walletArgs);
          break;
        case "swap-eth-uniswap":
          await rawWalletSwapEthUniswap(walletArgs);
          break;
        case "price":
          await rawWalletPrice(walletArgs);
          break;
        case "swap":
          await rawWalletSwap(walletArgs);
          break;
        case "swap-quote":
          await rawWalletSwap(walletArgs, false);
          break;
        case "swap-execute":
          await rawWalletSwap(walletArgs, true);
          break;
        case "endpoints":
          await rawWalletEndpoints();
          break;
        case "dapps":
          await rawWalletDapps();
          break;
        case "rpc-call":
          await rawWalletRpcCall(walletArgs);
          break;
        case "dapp":
          await rawWalletDapp(walletArgs);
          break;
        case "x402":
          await rawWalletX402(walletArgs);
          break;
        case "contract-call":
          await rawWalletEthContractCall(walletArgs);
          break;
        case "sol-instruction":
          await rawWalletSolInstruction(walletArgs);
          break;
        case "agent-access":
          await rawWalletAgentAccess(walletArgs[0]);
          break;
        case "agent-policy":
          await rawWalletAgentPolicy(walletArgs[0], walletArgs.slice(1));
          break;
        case "rpc":
          await rawWalletRpc(walletArgs[0], walletArgs.slice(1));
          break;
        default:
          console.log("Wallet Commands:");
          console.log("  cybara wallet status");
          console.log("  cybara wallet create --password <password>");
          console.log(
            '  cybara wallet import --password <password> --mnemonic "<24 words>"',
          );
          console.log("  cybara wallet unlock --password <password>");
          console.log("  cybara wallet lock");
          console.log(
            "  cybara wallet accounts [--chains eth,btc,sol] [--count N] [--start N]",
          );
          console.log(
            "  cybara wallet balances [--chains eth,btc,sol] [--count N] [--start N]",
          );
          console.log(
            "  cybara wallet tokens <eth|sol> [--index N] [--include-zero]",
          );
          console.log(
            "  cybara wallet token-tx <eth|sol> [--index N] [--limit N] [--token ADDRESS]",
          );
          console.log("  cybara wallet receive <eth|btc|sol> [--index N]");
          console.log(
            "  cybara wallet tx <eth|btc|sol> [--index N] [--limit N]",
          );
          console.log(
            "  cybara wallet send <eth|btc|sol> --to <address> --amount <value> [--index N]",
          );
          console.log(
            "  cybara wallet send-token <eth|sol> --token <address|mint> --to <address> --amount <value> [--index N]",
          );
          console.log(
            "  cybara wallet swap-eth-uniswap --token <symbol|address> (--percent N | --amount-eth ETH) [--execute]",
          );
          console.log(
            "  cybara wallet price [BTC|BTC/USD|<solMint>] [--source auto|chainlink|pyth|jupiter]",
          );
          console.log(
            "  cybara wallet swap [<ethToken>] [--venue <uniswap_v3|uniswap_v2|jupiter>] [--execute] [--quote-only]",
          );
          console.log("  cybara wallet endpoints");
          console.log("  cybara wallet dapps");
          console.log(
            "  cybara wallet rpc-call <eth|sol> --method <rpc_method> [--params '[...]'] [--rpc URL]",
          );
          console.log(
            "  cybara wallet dapp --adapter <adapter> --json '{...}'",
          );
          console.log(
            "  cybara wallet x402 --url <https_url> [--method GET|POST] [--headers '{...}'] [--body-json '{...}' | --body TEXT] [--network eip155:8453] [--max-amount-atomic N] [--dry-run]",
          );
          console.log(
            "  cybara wallet swap-quote --venue <uniswap_v2|uniswap_v3|jupiter> ... (legacy alias)",
          );
          console.log(
            "  cybara wallet swap-execute --venue <uniswap_v2|uniswap_v3|jupiter> ... (legacy alias)",
          );
          console.log(
            "  cybara wallet contract-call --contract <address> (--abi '<json_or_signature>' | --signature '<name(types)>') [--method <name>]",
          );
          console.log(
            "  cybara wallet sol-instruction --program <programId> (--keys '[...]' | --accounts '[...]')",
          );
          console.log("  cybara wallet agent-access <on|off>");
          console.log("  cybara wallet agent-policy [show]");
          console.log("  cybara wallet agent-policy set --json '{...}'");
          console.log("  cybara wallet rpc [show]");
          console.log("  cybara wallet rpc status");
          console.log(
            "  cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]",
          );
          break;
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
      rawHelp(getVersion(), API_BASE);
      break;
    case "completion":
      printCompletion(args[1]);
      break;

    case "version":
    case "--version":
    case "-v":
      console.log(`cybara v${getVersion()}`);
      break;

    case "pair":
    case "pairing": {
      await rawPairCommand(args.slice(1));
      break;
    }

    case "connectors":
    case "connector":
      await runConnectorCliCommand(args.slice(1));
      break;

    case "mcp": {
      const mcpSubCmd = args[1];
      const mcpArg = args[2];
      switch (mcpSubCmd) {
        case "search":
          if (!mcpArg) {
            console.error("Usage: cybara mcp search <query>");
            process.exit(1);
          }
          await rawMcpSearch(mcpArg);
          break;
        case "install":
          if (!mcpArg) {
            console.error("Usage: cybara mcp install <package>");
            process.exit(1);
          }
          await rawMcpInstall(mcpArg);
          break;
        case "add": {
          const mcpUrl = args[3];
          if (!mcpArg || !mcpUrl) {
            console.error("Usage: cybara mcp add <name> <https-url>");
            process.exit(1);
          }
          await rawMcpAdd(mcpArg, mcpUrl);
          break;
        }
        case "list":
          await rawMcpList();
          break;
        case "popular":
          await rawMcpPopular();
          break;
        case "serve":
          await runMcpStdioServer();
          break;
        default:
          console.log("MCP Commands:");
          console.log("  cybara mcp list       - List installed servers");
          console.log(
            "  cybara mcp add <name> <https-url> - Add a remote server",
          );
          console.log("  cybara mcp search <q> - Search registry");
          console.log("  cybara mcp install <p> - Install package");
          console.log("  cybara mcp popular    - Show popular servers");
          console.log(
            "  cybara mcp serve      - Expose cybara tools as an MCP server (stdio)",
          );
          break;
      }
      break;
    }
    case "lsp":
      switch (args[1]) {
        case "list":
        case undefined:
          await rawLsp();
          break;
        case "install":
          await rawLspInstall(args[2]);
          break;
        case "uninstall":
          await rawLspUninstall(args[2]);
          break;
        default:
          console.log("LSP Commands:");
          console.log(
            "  cybara lsp list             - Show language server status",
          );
          console.log(
            "  cybara lsp install <lang>   - Install language server",
          );
          console.log(
            "  cybara lsp uninstall <lang> - Uninstall language server",
          );
          console.log("");
          console.log(
            "Languages: rust, go, python, cpp (C/C++), java, csharp, ruby, php, lua, zig, kotlin, swift",
          );
          break;
      }
      break;

    case "start":
      await launchGateway(args.slice(1));
      break;
    case "dev":
      process.exitCode = await runGatewayForeground();
      break;

    case "wizard":
    case "setup":
    case "install":
    case "configure":
    case "onboard":
      await renderTUI(command);
      break;
    case "tui":
      await renderTUI(args[1]);
      break;

    default:
      await renderTUI();
      break;
  }
}

main()
  .then(() => {
    if (shouldExitAfterMain()) {
      process.exit(process.exitCode ?? 0);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
