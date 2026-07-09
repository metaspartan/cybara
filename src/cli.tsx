#!/usr/bin/env bun
import React from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Gradient from "ink-gradient";
import Spinner from "ink-spinner";
import { spawn } from "child_process";
import { createHash } from "crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "fs";
import { dirname, join } from "path";
import { homedir, tmpdir } from "os";
import { getAppVersion, getReleaseRepository } from "./core/build-info";
import {
  buildGitHubReleaseApiUrl,
  buildReleaseChecksumUrl,
  compareVersions,
  isNewerVersion,
  resolveReleaseBinaryFilename,
  resolveSelfUpdateDestination,
} from "./core/versioning";
import { checkForUpdateInBackground, isUpdateCheckDisabled } from "./core/update-check";
import { runMcpStdioServer } from "./core/mcp-host-server";
import { resolveCybaraHome } from "./core/cybara-home";
import { runMobileCommand } from "./cli-mobile";
import { rawHelp } from "./cli-help";
import { printCompletion } from "./cli-completion";
import { rawComputerUse } from "./cli-computer-use";
import { configureChatCli, rawAgent, rawChatCommand } from "./cli-chat";
import { runSubagentCommand } from "./cli-subagents";
import { TUIChatCommand } from "./cli-tui-chat";
import { MainMenu, type MainMenuAction } from "./cli-tui-menu";
import { getFlagValue, hasFlag } from "./cli-args";
import { commandExists } from "./core/platform";
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
} from "./cli-wallet";

const API_BASE = process.env.CYBARA_API || "http://localhost:4269";
const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode === "function",
};

function resolveCliApiKey(): string | null {
  const envKey = process.env.CYBARA_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  try {
    const cybaraHome = resolveCybaraHome().dir;
    const keyFromFile = readFileSync(join(cybaraHome, "api_key"), "utf-8").trim();
    return keyFromFile || null;
  } catch {
    return null;
  }
}

const CLI_API_KEY = resolveCliApiKey();

function withCliAuthHeaders(
  headers?: RequestInit["headers"],
  ensureJsonContentType = false
): Headers {
  const merged = new Headers(headers);
  if (ensureJsonContentType && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }
  if (CLI_API_KEY && !merged.has("Authorization")) {
    merged.set("Authorization", `Bearer ${CLI_API_KEY}`);
  }
  return merged;
}

configureWalletCli({ apiBase: API_BASE, withAuthHeaders: withCliAuthHeaders });

interface StatusResponse {
  status: string;
  uptime: number;
  checks: Record<string, { status?: string; total?: number; running?: number }>;
  timestamp: string;
  system?: {
    cpu?: {
      usagePct?: number;
      loadPct?: number | null;
      cores?: number;
      model?: string;
    };
    memory?: {
      totalBytes?: number;
      freeBytes?: number;
      usedBytes?: number;
      usedPct?: number;
      swap?: {
        totalBytes?: number;
        freeBytes?: number;
        usedBytes?: number;
        usedPct?: number;
      } | null;
    };
    process?: {
      pid?: number;
      cpuUsagePct?: number;
      memory?: {
        rssBytes?: number;
        heapUsedBytes?: number;
        heapTotalBytes?: number;
      };
    };
    disk?: {
      path?: string;
      totalBytes?: number;
      freeBytes?: number;
      usedBytes?: number;
      usedPct?: number;
    } | null;
  };
}

interface MetricsResponse {
  tokenUsage: { total: number; input: number; output: number; cache: number };
  fileOperations: { filesRead: number; filesWritten: number; filesEdited: number };
  toolCalls: { totalCalls: number };
  apiCalls: { totalCalls: number; successfulCalls: number; failedCalls: number };
  agentExecutions: { totalExecutions: number; totalMessages: number };
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

function formatStatusUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatStatusBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatStatusStorageBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (value >= 1000 * 1000 * 1000) return `${(value / (1000 * 1000 * 1000)).toFixed(2)} GB`;
  if (value >= 1000 * 1000) return `${(value / (1000 * 1000)).toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatStatusPct(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

interface TaskItem {
  id: string;
  name: string;
  status: string;
  schedule?: string;
  lastRun?: string;
}

interface SkillItem {
  name: string;
  description: string;
  eligible: boolean;
  source: string;
}

interface PluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  source: "bundled" | "local" | "workspace";
  rootDir: string;
  skillDirs: string[];
  skillCount: number;
}

interface AgentItem {
  id: string;
  name: string;
  type: string;
  status: string;
  model?: string;
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  try {
    const headers = withCliAuthHeaders(options?.headers, true);

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
      console.error("Is the server running? Start it with: cybara start");
    } else if (msg.includes("HTTP 401")) {
      console.error("ERROR: Unauthorized API request (401)");
      console.error("Set CYBARA_API_KEY or create ~/.cybara/api_key");
    }
    return null;
  }
}

configureChatCli({
  apiBase: API_BASE,
  fetchAPI,
  withAuthHeaders: withCliAuthHeaders,
});

async function rawMigrate(args: string[]): Promise<void> {
  const { detectMigrationSources, runSourceMigration } = await import("./core/source-migration");
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
      console.log(`${status.padEnd(7)} ${source.kind.padEnd(8)} ${source.path}`);
      if (source.exists) {
        console.log(
          `        memory=${source.detected.memoryFiles} skills=${source.detected.skillCount} config=${source.detected.configFiles}`
        );
      }
    }
    return;
  }

  const sourceKind = (getFlagValue(args, "--from") ||
    (subcommand === "openclaw" || subcommand === "hermes" ? subcommand : undefined)) as
    "openclaw" | "hermes" | undefined;
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
    `items: ${report.summary.migrated} migrated, ${report.summary.planned} planned, ${report.summary.conflict} conflicts, ${report.summary.skipped} skipped, ${report.summary.error} errors`
  );
  for (const warning of report.warnings) {
    console.log(`warning: ${warning}`);
  }
  for (const entry of report.items) {
    console.log(`${entry.status.padEnd(9)} ${entry.category.padEnd(9)} ${entry.name}`);
    if (entry.detail) console.log(`          ${entry.detail}`);
  }
  if (report.reportPath) console.log(`report: ${report.reportPath}`);
  if (report.dryRun) {
    console.log("");
    console.log("Apply with: cybara migrate --apply");
  }
}

async function rawStatus(): Promise<void> {
  const data = await fetchAPI<StatusResponse>("/api/health");
  if (!data) {
    console.error("ERROR: Failed to connect to Cybara server at", API_BASE);
    process.exit(1);
  }

  console.log("CYBARA STATUS");
  console.log("=============");
  console.log(`status: ${data.status}`);
  console.log(`uptime: ${formatStatusUptime(data.uptime)}`);
  console.log(`timestamp: ${data.timestamp}`);
  if (data.system) {
    console.log("");
    console.log("SYSTEM MONITOR");
    console.log(
      `  cpu: ${formatStatusPct(data.system.cpu?.usagePct)} (${data.system.cpu?.cores || 0} cores)`
    );
    console.log(
      `  memory: ${formatStatusPct(data.system.memory?.usedPct)} used (${formatStatusBytes(data.system.memory?.usedBytes)} / ${formatStatusBytes(data.system.memory?.totalBytes)})`
    );
    if (data.system.memory?.swap) {
      console.log(
        `  swap: ${formatStatusPct(data.system.memory.swap.usedPct)} used (${formatStatusBytes(data.system.memory.swap.usedBytes)} / ${formatStatusBytes(data.system.memory.swap.totalBytes)})`
      );
    }
    if (data.system.process) {
      console.log(
        `  process: ${formatStatusPct(data.system.process.cpuUsagePct)} CPU, ${formatStatusBytes(data.system.process.memory?.rssBytes)} RSS`
      );
    }
    if (data.system.disk) {
      console.log(
        `  disk: ${formatStatusPct(data.system.disk.usedPct)} used (${formatStatusStorageBytes(data.system.disk.freeBytes)} free)`
      );
    }
  }
  console.log("");
  console.log("HEALTH CHECKS");
  for (const [name, info] of Object.entries(data.checks || {})) {
    const status = info.status || "ok";
    const extra = info.total !== undefined ? ` (${info.total} total)` : "";
    console.log(`  ${name}: ${status}${extra}`);
  }
}

interface DoctorCheckResult {
  name: string;
  ok: boolean;
  details: string;
  latencyMs?: number;
}

function formatDoctorLatency(latencyMs?: number): string {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) return "";
  return ` (${latencyMs}ms)`;
}

async function runDoctorCheck(
  name: string,
  check: () => Promise<{ ok: boolean; details: string }>
): Promise<DoctorCheckResult> {
  const startedAt = Date.now();
  try {
    const result = await check();
    return {
      name,
      ok: result.ok,
      details: result.details,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkStatusWebSocket(): Promise<{ ok: boolean; details: string }> {
  const tokenParam = CLI_API_KEY ? `?token=${encodeURIComponent(CLI_API_KEY)}` : "";
  const wsUrl = `${API_BASE.replace(/^http/i, "ws")}/api/ws/status${tokenParam}`;
  return await new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve({ ok: false, details: "timeout waiting for snapshot event" });
    }, 5000);

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      // wait for first payload
    };

    socket.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      let payload: unknown = null;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        // ignore malformed json
      }
      try {
        socket.close();
      } catch {
        // ignore
      }
      const isSnapshot = Boolean(
        payload &&
        typeof payload === "object" &&
        "type" in payload &&
        (payload as { type?: string }).type === "snapshot"
      );
      resolve({
        ok: isSnapshot,
        details: isSnapshot ? "received snapshot event" : "did not receive snapshot payload",
      });
    };

    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, details: "websocket connection failed" });
    };

    socket.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, details: "websocket closed before snapshot" });
    };
  });
}

function checkSandboxRuntime(): { ok: boolean; details: string } {
  if (process.platform === "darwin" && process.arch === "arm64") {
    const hasAppleSandbox = commandExists("sandbox-exec");
    const hasDocker = commandExists("docker");
    if (hasAppleSandbox || hasDocker) {
      return {
        ok: true,
        details: hasAppleSandbox
          ? "sandbox-exec detected (apple sandbox available)"
          : "docker detected (container sandbox fallback available)",
      };
    }
    return {
      ok: false,
      details: "sandbox-exec and docker missing (install Xcode command line tools or Docker)",
    };
  }

  if (process.platform === "linux") {
    const hasPodman = commandExists("podman");
    const hasDocker = commandExists("docker");
    if (hasPodman || hasDocker) {
      return {
        ok: true,
        details: hasPodman
          ? "podman detected (container sandbox available)"
          : "docker detected (container sandbox fallback available)",
      };
    }
    return {
      ok: false,
      details: "podman and docker missing (install podman or docker for sandbox mode)",
    };
  }

  if (commandExists("docker")) {
    return { ok: true, details: "docker detected (container sandbox available)" };
  }
  return {
    ok: false,
    details: `no sandbox provider detected on ${process.platform}; install docker`,
  };
}

async function rawDoctor(): Promise<void> {
  const checks: DoctorCheckResult[] = [];

  checks.push(
    await runDoctorCheck("health", async () => {
      const data = await fetchAPI<StatusResponse>("/api/health");
      if (!data) return { ok: false, details: "no response from /api/health" };
      return {
        ok: data.status === "healthy",
        details: `status=${data.status} uptime=${Math.floor(data.uptime)}s`,
      };
    })
  );

  checks.push(
    await runDoctorCheck("info", async () => {
      const data = await fetchAPI<{ version?: string; stats?: Record<string, unknown> }>(
        "/api/info"
      );
      if (!data) return { ok: false, details: "no response from /api/info" };
      return { ok: true, details: `version=${data.version || "unknown"}` };
    })
  );

  checks.push(
    await runDoctorCheck("sessions-api", async () => {
      const sessions = await fetchAPI<Array<{ id: string }>>("/api/sessions");
      if (!sessions) return { ok: false, details: "failed to fetch /api/sessions" };
      return { ok: true, details: `${sessions.length} sessions loaded` };
    })
  );

  checks.push(
    await runDoctorCheck("status-ws", async () => {
      return await checkStatusWebSocket();
    })
  );

  checks.push(
    await runDoctorCheck("sandbox-runtime", async () => {
      return checkSandboxRuntime();
    })
  );

  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;

  console.log("CYBARA DOCTOR");
  console.log("=============");
  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    console.log(
      `  [${marker}] ${check.name}${formatDoctorLatency(check.latencyMs)} - ${check.details}`
    );
  }
  console.log("");
  console.log(`Summary: ${passed}/${checks.length} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
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
  const data = await fetchAPI<TokenAnalysisResponse>("/api/metrics/token-analysis");
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
  console.log(`  avg_tokens_per_call: ${data.summary?.averageTokensPerCall || 0}`);
  console.log(`  median_tokens_per_call: ${data.summary?.medianTokensPerCall || 0}`);
  console.log(
    `  input_to_output_ratio: ${data.summary?.inputToOutputRatio !== null && data.summary?.inputToOutputRatio !== undefined ? `${data.summary.inputToOutputRatio}:1` : "n/a"}`
  );
  console.log("");

  console.log("HEATMAP");
  const hottest = data.tokenHeatmap?.hottestHour;
  if (hottest) {
    console.log(
      `  hottest_window: ${hottest.dayLabel} ${String(hottest.hour).padStart(2, "0")}:00 (${hottest.tokens} tokens, ${hottest.calls} calls)`
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
        `  ${profile.model} (${profile.provider}) ${profile.behavior} | prompt=${profile.promptSharePct}% output=${profile.responseSharePct}% tps=${profile.avgTps} latency=${profile.avgLatencyMs}ms`
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
        `  ${burst.timestamp} ${burst.model} (${burst.provider}) ${burst.totalTokens} tokens`
      );
    }
  }
}

async function rawAgents(): Promise<void> {
  const data = await fetchAPI<AgentItem[]>("/api/agents");
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

async function rawPlugins(): Promise<void> {
  const data = await fetchAPI<{ plugins: PluginItem[] }>("/api/plugins");
  if (!data) {
    console.error("ERROR: Failed to fetch plugins from", API_BASE);
    process.exit(1);
  }

  const plugins = Array.isArray(data.plugins) ? data.plugins : [];
  console.log("CYBARA PLUGINS");
  console.log("==============");
  console.log(`total: ${plugins.length}`);
  console.log("");

  if (plugins.length === 0) {
    console.log("No plugins installed");
    console.log("");
    console.log("Install one with: cybara plugin install <path>");
    return;
  }

  for (const plugin of plugins) {
    console.log(`- ${plugin.name} (${plugin.version})`);
    console.log(`  id: ${plugin.id}`);
    console.log(`  source: ${plugin.source}`);
    console.log(`  skills: ${plugin.skillDirs.length}`);
    console.log(`  root: ${plugin.rootDir}`);
    if (plugin.author) console.log(`  author: ${plugin.author}`);
    if (plugin.description) console.log(`  description: ${plugin.description}`);
  }
}

async function rawPluginValidate(inputPath: string): Promise<void> {
  const data = await fetchAPI<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    manifest?: { id: string; name: string; version: string };
  }>(`/api/plugins/validate?path=${encodeURIComponent(inputPath)}`);

  if (!data) {
    console.error("ERROR: Failed to validate plugin path against", API_BASE);
    process.exit(1);
  }

  console.log("PLUGIN VALIDATION");
  console.log("=================");
  console.log(`path: ${inputPath}`);
  console.log(`valid: ${data.valid ? "yes" : "no"}`);
  if (data.manifest) {
    console.log(`id: ${data.manifest.id}`);
    console.log(`name: ${data.manifest.name}`);
    console.log(`version: ${data.manifest.version}`);
  }
  if (data.warnings?.length) {
    console.log("");
    console.log("WARNINGS:");
    for (const warning of data.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  if (data.errors?.length) {
    console.log("");
    console.log("ERRORS:");
    for (const error of data.errors) {
      console.log(`  - ${error}`);
    }
    process.exit(1);
  }
}

async function rawPluginInstall(inputPath: string): Promise<void> {
  console.log(`Installing plugin from ${inputPath}...`);
  const data = await fetchAPI<{
    success: boolean;
    plugin?: { id: string; name: string; version: string; skillDirs: string[] };
  }>("/api/plugins/install", {
    method: "POST",
    body: JSON.stringify({ path: inputPath }),
  });

  if (!data || !data.success || !data.plugin) {
    console.error("ERROR: Failed to install plugin");
    process.exit(1);
  }

  console.log(`SUCCESS: Installed ${data.plugin.name}`);
  console.log(`  id: ${data.plugin.id}`);
  console.log(`  version: ${data.plugin.version}`);
  console.log(`  skill_dirs: ${data.plugin.skillDirs.length}`);
}

async function rawPluginRemove(pluginId: string): Promise<void> {
  const data = await fetchAPI<{ success: boolean }>(
    `/api/plugins/${encodeURIComponent(pluginId)}`,
    {
      method: "DELETE",
    }
  );

  if (!data) {
    console.error("ERROR: Failed to remove plugin from", API_BASE);
    process.exit(1);
  }

  if (!data.success) {
    console.error(`Plugin not found: ${pluginId}`);
    process.exit(1);
  }

  console.log(`Removed plugin: ${pluginId}`);
}

interface MCPRegistryServer {
  id: string;
  name: string;
  description: string;
  registry: string;
  package: string;
  command: string;
  args?: string;
  envVars?: string[];
}

async function rawMcpSearch(query: string): Promise<void> {
  const data = await fetchAPI<MCPRegistryServer[]>(
    `/api/mcp/registry/search?q=${encodeURIComponent(query)}`
  );
  if (!data) {
    console.error("ERROR: Failed to search MCP registry from", API_BASE);
    process.exit(1);
  }

  console.log("MCP REGISTRY SEARCH");
  console.log("===================");
  console.log(`query: ${query}`);
  console.log(`results: ${data.length}`);
  console.log("");

  if (data.length === 0) {
    console.log("No servers found");
    return;
  }

  for (const server of data) {
    console.log(`- ${server.name} (${server.registry})`);
    console.log(`  id: ${server.id}`);
    console.log(`  package: ${server.package}`);
    if (server.description) console.log(`  description: ${server.description.slice(0, 80)}...`);
    if (server.envVars?.length) console.log(`  env_required: ${server.envVars.join(", ")}`);
  }
}

async function rawMcpInstall(pkg: string): Promise<void> {
  console.log(`Installing MCP server: ${pkg}...`);

  const data = await fetchAPI<{ success: boolean; id?: string; error?: string }>(
    "/api/mcp/registry/install",
    { method: "POST", body: JSON.stringify({ package: pkg, trustedAction: true }) }
  );

  if (!data) {
    console.error("ERROR: Failed to install MCP server from", API_BASE);
    process.exit(1);
  }

  if (data.success) {
    console.log(`SUCCESS: Installed ${pkg}`);
    console.log(`  id: ${data.id}`);
    console.log("");
    console.log("Run 'cybara mcp list' to see installed servers");
  } else {
    console.error(`FAILED: ${data.error || "Unknown error"}`);
    process.exit(1);
  }
}

async function rawMcpList(): Promise<void> {
  const data =
    await fetchAPI<
      Array<{ id: string; name: string; command: string; status: string; toolCount: number }>
    >("/api/mcp");
  if (!data) {
    console.error("ERROR: Failed to list MCP servers from", API_BASE);
    process.exit(1);
  }

  console.log("MCP SERVERS");
  console.log("===========");
  console.log(`total: ${data.length}`);
  console.log("");

  if (data.length === 0) {
    console.log("No MCP servers installed");
    console.log("");
    console.log("Use 'cybara mcp search <query>' to find servers");
    return;
  }

  for (const server of data) {
    console.log(`- ${server.name}`);
    console.log(`  id: ${server.id}`);
    console.log(`  command: ${server.command}`);
    console.log(`  status: ${server.status}`);
    console.log(`  tools: ${server.toolCount}`);
  }
}

async function rawMcpPopular(): Promise<void> {
  const data = await fetchAPI<MCPRegistryServer[]>("/api/mcp/registry/popular");
  if (!data) {
    console.error("ERROR: Failed to get popular MCP servers from", API_BASE);
    process.exit(1);
  }

  console.log("POPULAR MCP SERVERS");
  console.log("===================");
  console.log(`total: ${data.length}`);
  console.log("");

  for (const server of data) {
    console.log(`- ${server.name} [${server.registry}]`);
    console.log(`  id: ${server.id}`);
    if (server.description) console.log(`  ${server.description.slice(0, 60)}`);
  }
}

interface PairingInfo {
  id: string;
  senderId: string;
  code: string;
  platform: string;
  displayName?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

async function rawPairList(): Promise<void> {
  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];

  console.log("PENDING PAIRINGS");
  console.log("================");
  console.log("");

  let totalPending = 0;
  for (const channel of channels) {
    const data = await fetchAPI<{ pairings: PairingInfo[]; pendingCount: number }>(
      `/api/channels/${channel.id}/pairings`
    );
    if (!data || data.pendingCount === 0) continue;

    totalPending += data.pendingCount;
    console.log(`${channel.name} (${channel.type}):`);
    for (const p of data.pairings.filter((x) => x.status === "pending")) {
      const name = p.displayName || p.senderId;
      console.log(`  - ${name}`);
      console.log(`    code: ${p.code}`);
      console.log(`    platform: ${p.platform}`);
      console.log(`    expires: ${new Date(p.expiresAt).toLocaleString()}`);
    }
    console.log("");
  }

  if (totalPending === 0) {
    console.log("No pending pairings");
  } else {
    console.log(`Total pending: ${totalPending}`);
    console.log("");
    console.log("To approve: cybara pair <CODE>");
    console.log("To reject:  cybara pair reject <CODE>");
  }
}

async function rawPairApprove(code: string): Promise<void> {
  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];

  for (const channel of channels) {
    const result = await fetchAPI<{ success: boolean; senderId?: string; error?: string }>(
      `/api/channels/${channel.id}/pairings/verify`,
      { method: "POST", body: JSON.stringify({ code: code.toUpperCase() }) }
    );

    if (result?.success) {
      console.log(`✓ Pairing approved!`);
      console.log(`  channel: ${channel.name}`);
      console.log(`  sender: ${result.senderId}`);
      console.log("");
      console.log("The user can now message your bot.");
      return;
    }
  }

  console.error(`✗ Pairing code ${code.toUpperCase()} not found or already expired`);
  console.log("");
  console.log("Use 'cybara pair list' to see pending pairings");
  process.exit(1);
}

async function rawPairReject(code: string): Promise<void> {
  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];

  for (const channel of channels) {
    const pairings = await fetchAPI<{ pairings: PairingInfo[] }>(
      `/api/channels/${channel.id}/pairings`
    );
    const pairing = pairings?.pairings.find((p) => p.code === code.toUpperCase());

    if (pairing) {
      const result = await fetchAPI<{ success: boolean }>(
        `/api/channels/${channel.id}/pairings/${pairing.id}/reject`,
        { method: "POST" }
      );

      if (result?.success) {
        console.log(`✓ Pairing rejected`);
        console.log(`  code: ${code.toUpperCase()}`);
        console.log(`  sender: ${pairing.senderId}`);
        return;
      }
    }
  }

  console.error(`✗ Pairing code ${code.toUpperCase()} not found`);
  process.exit(1);
}

async function rawPairPolicy(channelName: string, policy: string): Promise<void> {
  const validPolicies = ["pairing", "allowlist", "open", "disabled"];
  if (!validPolicies.includes(policy)) {
    console.error(`Invalid policy: ${policy}`);
    console.log(`Valid policies: ${validPolicies.join(", ")}`);
    process.exit(1);
  }

  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];
  const channel = channels.find(
    (c) => c.name.toLowerCase() === channelName.toLowerCase() || c.id === channelName
  );

  if (!channel) {
    console.error(`Channel not found: ${channelName}`);
    console.log("Available channels:");
    for (const c of channels) {
      console.log(`  - ${c.name} (${c.type})`);
    }
    process.exit(1);
  }

  const result = await fetchAPI<{ success: boolean; config: { dm_policy: string } }>(
    `/api/channels/${channel.id}/security`,
    { method: "PUT", body: JSON.stringify({ dm_policy: policy }) }
  );

  if (result?.success) {
    console.log(`✓ DM policy updated`);
    console.log(`  channel: ${channel.name}`);
    console.log(`  policy: ${result.config.dm_policy}`);
  } else {
    console.error("Failed to update policy");
    process.exit(1);
  }
}

interface LSPInstallStatus {
  language: string;
  displayName: string;
  description: string;
  type: "bundled" | "binary" | "pip" | "go";
  installed: boolean;
  available: boolean;
  path: string | null;
  requiresRuntime?: string;
}

async function rawLsp(): Promise<void> {
  const data = await fetchAPI<{ status: LSPInstallStatus[] }>("/api/lsp/install-status");
  if (!data) {
    console.error("ERROR: Failed to get LSP status from", API_BASE);
    process.exit(1);
  }

  console.log("LSP STATUS");
  console.log("==========");
  console.log("");
  console.log("LANGUAGE SERVERS");
  console.log("----------------");

  const bundled = data.status.filter((l) => l.type === "bundled");
  const installable = data.status.filter((l) => l.type !== "bundled");

  console.log("");
  console.log("Bundled (included in binary):");
  for (const lang of bundled) {
    console.log(`  ✓ ${lang.displayName.padEnd(15)} ${lang.description}`);
  }

  console.log("");
  console.log("Installable:");
  for (const lang of installable) {
    const status = lang.installed
      ? "✓ installed"
      : lang.available
        ? "✓ in PATH"
        : "✗ not installed";
    const statusIcon = lang.installed || lang.available ? "✓" : "✗";
    const runtime = lang.requiresRuntime ? ` (requires ${lang.requiresRuntime})` : "";
    console.log(`  ${statusIcon} ${lang.displayName.padEnd(15)} ${status}${runtime}`);
    if (lang.path) {
      console.log(`      → ${lang.path}`);
    }
  }

  console.log("");
  console.log("Commands:");
  console.log("  cybara lsp list              - Show this status");
  console.log("  cybara lsp install <lang>    - Install language server");
  console.log("  cybara lsp uninstall <lang>  - Uninstall language server");
  console.log("");
  console.log(
    "Available languages: " +
      data.status
        .filter((l) => l.type !== "bundled")
        .map((l) => l.language)
        .join(", ")
  );
}

async function rawLspInstall(language: string): Promise<void> {
  if (!language) {
    console.error("ERROR: Please specify a language to install");
    console.log("Usage: cybara lsp install <language>");
    console.log("");

    const data = await fetchAPI<{
      status: { language: string; displayName: string; type: string }[];
    }>("/api/lsp/install-status");
    if (data) {
      const installable = data.status.filter((l) => l.type !== "bundled");
      console.log("Available languages:");
      for (const lang of installable) {
        console.log(`  ${lang.language.padEnd(12)} - ${lang.displayName}`);
      }
    }
    process.exit(1);
  }

  console.log(`Installing ${language} language server...`);

  const response = await fetch(`${API_BASE}/api/lsp/install`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ language }),
  });

  const result = (await response.json()) as { success: boolean; error?: string; path?: string };

  if (result.success) {
    console.log(`✓ Successfully installed ${language}`);
    if (result.path) {
      console.log(`  Installed to: ${result.path}`);
    }
  } else {
    console.error(`✗ Failed to install ${language}: ${result.error}`);
    process.exit(1);
  }
}

async function rawLspUninstall(language: string): Promise<void> {
  if (!language) {
    console.error("ERROR: Please specify a language to uninstall");
    console.log("Usage: cybara lsp uninstall <language>");
    process.exit(1);
  }

  console.log(`Uninstalling ${language} language server...`);

  const response = await fetch(`${API_BASE}/api/lsp/uninstall`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ language }),
  });

  const result = (await response.json()) as { success: boolean; error?: string };

  if (result.success) {
    console.log(`✓ Successfully uninstalled ${language}`);
  } else {
    console.error(`✗ Failed to uninstall ${language}: ${result.error}`);
    process.exit(1);
  }
}

interface ProviderInfo {
  id: string;
  provider: string;
  name: string;
  is_default: boolean;
  config?: Record<string, unknown>;
}

interface AvailableProviderInfo {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: string;
  models: { id: string; name: string; context: number }[];
}

async function rawProviders(): Promise<void> {
  const data = await fetchAPI<ProviderInfo[]>("/api/providers");
  if (!data) {
    console.error("ERROR: Failed to fetch providers from", API_BASE);
    process.exit(1);
  }

  const provs = Array.isArray(data) ? data : [];

  console.log("CYBARA PROVIDERS");
  console.log("================");
  console.log(`total: ${provs.length}`);
  console.log("");

  if (provs.length === 0) {
    console.log("No providers configured");
    console.log("Run 'cybara provider add <type>' to add one");
    console.log("Run 'cybara provider available' to see available types");
    return;
  }

  for (const prov of provs) {
    const def = prov.is_default ? " [DEFAULT]" : "";
    console.log(`  ${prov.id.slice(0, 8)}  ${prov.name} (${prov.provider})${def}`);
  }
}

async function rawProviderAvailable(): Promise<void> {
  const data = await fetchAPI<AvailableProviderInfo[]>("/api/providers/available");
  if (!data) {
    console.error("ERROR: Failed to fetch available providers from", API_BASE);
    process.exit(1);
  }

  console.log("AVAILABLE PROVIDER TYPES");
  console.log("========================");
  console.log("");

  for (const prov of data) {
    const auth = prov.authType === "none" ? "(no auth)" : `(${prov.authType})`;
    console.log(`  ${prov.id.padEnd(18)} ${prov.name} ${auth}`);
    console.log(`${"".padEnd(20)} ${prov.models.length} models | ${prov.baseUrl}`);
  }
}

async function rawProviderAdd(
  type: string,
  name?: string,
  apiKey?: string,
  accessToken?: string,
  isDefault?: boolean,
  useOAuth?: boolean
): Promise<void> {
  if (!type) {
    console.error("ERROR: Please specify a provider type");
    console.log(
      "Usage: cybara provider add <type> [--name NAME] [--key KEY] [--token TOKEN] [--oauth] [--default]"
    );
    console.log("");
    console.log("Run 'cybara provider available' to see available types");
    process.exit(1);
  }

  const displayName = name || type.charAt(0).toUpperCase() + type.slice(1);
  let refreshToken: string | undefined;
  let expiresAt: number | undefined;

  if (useOAuth) {
    try {
      const dcRes = await fetch(`${API_BASE}/api/providers/oauth/device-code`, {
        method: "POST",
        headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ providerType: type }),
      });
      const dcData = (await dcRes.json()) as {
        user_code?: string;
        verification_uri?: string;
        device_code?: string;
        expires_in?: number;
        interval?: number;
        error?: string;
      };

      if (!dcRes.ok || !dcData.user_code) {
        console.error(
          `✗ OAuth not available for ${type}: ${dcData.error || "No device code flow configured"}`
        );
        process.exit(1);
      }

      console.log("");
      console.log(`  Code: ${dcData.user_code.padEnd(28)}`);
      console.log("");
      console.log(`  Open: ${dcData.verification_uri}`);
      console.log("  Enter the code above, then authorize.");
      console.log("");

      try {
        const verificationUri = dcData.verification_uri;
        if (verificationUri) {
          if (process.platform === "darwin") {
            const child = spawn("open", [verificationUri], { stdio: "ignore", detached: true });
            child.unref();
          } else if (process.platform === "win32") {
            const child = spawn("cmd", ["/c", "start", "", verificationUri], {
              stdio: "ignore",
              detached: true,
            });
            child.unref();
          } else {
            const child = spawn("xdg-open", [verificationUri], { stdio: "ignore", detached: true });
            child.unref();
          }
        }
      } catch {
        /* ignore */
      }

      let interval = Math.max(5, dcData.interval || 5) * 1000;
      const pollDeadline = Date.now() + (dcData.expires_in || 900) * 1000;
      process.stdout.write("  Waiting for authorization");

      while (Date.now() < pollDeadline) {
        await new Promise((r) => setTimeout(r, interval));
        process.stdout.write(".");

        const pollRes = await fetch(`${API_BASE}/api/providers/oauth/poll`, {
          method: "POST",
          headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ providerType: type, deviceCode: dcData.device_code }),
        });
        const pollData = (await pollRes.json()) as {
          status: string;
          access_token?: string;
          refresh_token?: string;
          expires_at?: number;
          error?: string;
        };

        if (pollData.status === "success" && pollData.access_token) {
          console.log(" ✓");
          accessToken = pollData.access_token;
          refreshToken = pollData.refresh_token;
          expiresAt = pollData.expires_at;
          break;
        }
        if (pollData.status === "denied" || pollData.status === "expired") {
          console.log("");
          console.error(`✗ Authorization ${pollData.status}`);
          process.exit(1);
        }
        if (pollData.status === "slow_down") {
          interval += 5000;
        }
        if (pollData.status === "error") {
          console.log("");
          console.error(`✗ Error: ${pollData.error}`);
          process.exit(1);
        }
      }

      if (!accessToken) {
        console.log("");
        console.error("✗ Authorization timed out");
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
        console.error("Is the server running? Start it with: cybara start");
      } else {
        console.error(`✗ OAuth failed: ${msg}`);
      }
      process.exit(1);
    }
  }

  const body: Record<string, unknown> = {
    provider: type,
    name: displayName,
  };
  if (apiKey) body.api_key = apiKey;
  if (accessToken) body.access_token = accessToken;
  if (refreshToken) body.refresh_token = refreshToken;
  if (expiresAt) body.expires_at = expiresAt;
  if (isDefault) body.is_default = true;

  try {
    const response = await fetch(`${API_BASE}/api/providers`, {
      method: "POST",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as { id?: string; error?: string };

    if (result.id) {
      console.log(`✓ Added provider: ${displayName} (${type})`);
      console.log(`  ID: ${result.id}`);
    } else {
      console.error(`✗ Failed to add provider: ${result.error || "Unknown error"}`);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
      console.error("Is the server running? Start it with: cybara start");
    } else {
      console.error(`✗ Failed to add provider: ${msg}`);
    }
    process.exit(1);
  }
}

async function rawProviderUpdate(
  id: string,
  name?: string,
  apiKey?: string,
  accessToken?: string,
  isDefault?: boolean
): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a provider ID");
    console.log(
      "Usage: cybara provider update <id> [--name NAME] [--key KEY] [--token TOKEN] [--default]"
    );
    process.exit(1);
  }

  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (apiKey) body.api_key = apiKey;
  if (accessToken) body.access_token = accessToken;
  if (isDefault !== undefined) body.is_default = isDefault;

  try {
    const response = await fetch(`${API_BASE}/api/providers/${id}`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as { success?: boolean; error?: string };

    if (result.success) {
      console.log(`✓ Updated provider: ${id}`);
    } else {
      console.error(`✗ Failed to update: ${result.error || "Unknown error"}`);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
      console.error("Is the server running? Start it with: cybara start");
    } else {
      console.error(`✗ Failed to update provider: ${msg}`);
    }
    process.exit(1);
  }
}

async function rawProviderDelete(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a provider ID");
    console.log("Usage: cybara provider delete <id>");
    process.exit(1);
  }

  try {
    const response = await fetch(`${API_BASE}/api/providers/${id}`, {
      method: "DELETE",
      headers: withCliAuthHeaders(),
    });

    const result = (await response.json()) as { success?: boolean; error?: string };

    if (result.success) {
      console.log(`✓ Deleted provider: ${id}`);
    } else {
      console.error(`✗ Failed to delete: ${result.error || "Unknown error"}`);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
      console.error("Is the server running? Start it with: cybara start");
    } else {
      console.error(`✗ Failed to delete provider: ${msg}`);
    }
    process.exit(1);
  }
}

async function rawProviderModels(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a provider ID");
    console.log("Usage: cybara provider models <id>");
    process.exit(1);
  }

  const data = await fetchAPI<{ id: string; name: string; context: number }[]>(
    `/api/providers/${id}/models`
  );
  if (!data) {
    console.error("ERROR: Failed to fetch models from", API_BASE);
    process.exit(1);
  }

  const models = Array.isArray(data) ? data : [];

  console.log(`MODELS FOR PROVIDER ${id}`);
  console.log("=".repeat(26 + id.length));
  console.log(`total: ${models.length}`);
  console.log("");

  for (const model of models) {
    const ctx = model.context ? ` (${(model.context / 1000).toFixed(0)}k ctx)` : "";
    console.log(`  ${model.id.padEnd(30)} ${model.name}${ctx}`);
  }
}

async function rawProviderDiscover(): Promise<void> {
  console.log("Discovering Ollama models...");

  try {
    const response = await fetch(`${API_BASE}/api/providers/discover/ollama`, {
      method: "POST",
      headers: withCliAuthHeaders(),
    });

    const result = (await response.json()) as { models?: { id: string }[]; error?: string };

    if (result.models) {
      console.log(`✓ Discovered ${result.models.length} Ollama models`);
      for (const model of result.models) {
        console.log(`  - ${model.id}`);
      }
    } else {
      console.error(`✗ Failed to discover: ${result.error || "Unable to reach Ollama"}`);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
      console.error("Is the server running? Start it with: cybara start");
    } else {
      console.error(`✗ Failed to discover Ollama models: ${msg}`);
    }
    process.exit(1);
  }
}

function parseProviderFlags(args: string[]): {
  name?: string;
  key?: string;
  token?: string;
  isDefault: boolean;
  oauth: boolean;
} {
  let name: string | undefined;
  let key: string | undefined;
  let token: string | undefined;
  let isDefault = false;
  let oauth = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--name":
      case "-n":
        name = args[++i];
        break;
      case "--key":
      case "-k":
        key = args[++i];
        break;
      case "--token":
      case "-t":
        token = args[++i];
        break;
      case "--default":
      case "-d":
        isDefault = true;
        break;
      case "--oauth":
      case "-o":
        oauth = true;
        break;
    }
  }

  return { name, key, token, isDefault, oauth };
}

interface SessionInfo {
  id: string;
  agent_id?: string;
  agentId?: string;
  title?: string;
  message_count?: number;
  messageCount?: number;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  workspaceDir?: string | null;
  modelMetadata?: {
    agent_name?: string;
    model?: string;
    provider?: string;
  } | null;
}

function sessionMessageCount(session: SessionInfo): number {
  return session.message_count ?? session.messageCount ?? 0;
}

function sessionUpdatedAt(session: SessionInfo): string | undefined {
  return session.updated_at ?? session.updatedAt ?? session.created_at ?? session.createdAt;
}

function sessionAgentLabel(session: SessionInfo, agentsById = new Map<string, AgentItem>()): string {
  const metadata = session.modelMetadata;
  const metadataModel = [metadata?.agent_name, metadata?.model].filter(Boolean).join(" · ");
  if (metadataModel) return metadataModel;
  const agentId = session.agent_id || session.agentId;
  const agent = agentId ? agentsById.get(agentId) : undefined;
  if (agent?.name && agent.model) return `${agent.name} · ${agent.model}`;
  if (agent?.name) return agent.name;
  if (agent?.model) return agent.model;
  return "-";
}

async function rawSessions(): Promise<void> {
  const [data, agents] = await Promise.all([
    fetchAPI<SessionInfo[]>("/api/sessions"),
    fetchAPI<AgentItem[]>("/api/agents"),
  ]);
  if (!data) {
    console.error("ERROR: Failed to fetch sessions from", API_BASE);
    process.exit(1);
  }

  const sessions = Array.isArray(data) ? data : [];
  const agentsById = new Map((Array.isArray(agents) ? agents : []).map((agent) => [agent.id, agent]));

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
  const endpoint = query ? `/api/memory/search?query=${encodeURIComponent(query)}` : "/api/memory";

  const data = await fetchAPI<
    | MemoryEntry[]
    | {
        results?: Array<
          | MemoryEntry
          | {
              file?: string;
              entry?: { content?: string; timestamp?: string; date?: string; type?: string };
            }
        >;
        memories?: Array<{
          file?: string;
          entries?: Array<{ content?: string; timestamp?: string; date?: string; type?: string }>;
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
    if (entry.similarity) console.log(`  similarity: ${(entry.similarity * 100).toFixed(1)}%`);
  }
}

interface LogEntry {
  timestamp?: string;
  created_at?: string;
  level?: string;
  module?: string;
  source?: string;
  logType?: string;
  message?: string;
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
    const module = (log.module || log.source || log.logType || "log").slice(0, 12).padEnd(12);
    const timestamp = log.timestamp || log.created_at || "";
    const parsedTime = Date.parse(timestamp);
    const time = Number.isFinite(parsedTime)
      ? new Date(parsedTime).toLocaleTimeString()
      : "--:--:--";
    console.log(`[${time}] ${level} ${module} ${(log.message || "").slice(0, 60)}`);
  }
}

async function fetchSystemLogs(count: number): Promise<LogEntry[]> {
  const boundedCount = Math.max(1, Math.min(1000, Math.floor(count)));
  const data = await fetchAPI<LogEntry[]>(`/api/logs/system?limit=${boundedCount}`);
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
      const module = (log.module || log.source || log.logType || "log").slice(0, 12).padEnd(12);
      const timestamp = log.timestamp || log.created_at || "";
      const parsedTime = Date.parse(timestamp);
      const time = Number.isFinite(parsedTime)
        ? new Date(parsedTime).toLocaleTimeString()
        : "--:--:--";
      console.log(`[${time}] ${level} ${module} ${(log.message || "").slice(0, 60)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

interface AgentLoopSummary {
  id: string;
  agentId: string;
  label: string;
  objective: string;
  status: string;
  stopReason?: string;
  createdAt: string;
  updatedAt: string;
  iterationsCompleted: number;
  maxIterations: number;
}

interface AgentLoopDetail extends AgentLoopSummary {
  startedAt?: string;
  endedAt?: string;
  maxDurationSeconds: number;
  modelOverride?: string;
  useTools: boolean;
  finalResponse?: string;
  error?: string;
  steps: Array<{
    iteration: number;
    durationMs: number;
    toolCallCount: number;
    done: boolean;
    response: string;
  }>;
}

function parseIntegerFlag(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseLoopStartArgs(args: string[]): {
  objective: string;
  maxIterations?: number;
  maxDurationSeconds?: number;
  model?: string;
  useTools?: boolean;
} {
  const objectiveFromFlag = getFlagValue(args, "--objective");
  const model = getFlagValue(args, "--model");
  const maxIterations = parseIntegerFlag(getFlagValue(args, "--max-iterations"));
  const maxDurationSeconds = parseIntegerFlag(getFlagValue(args, "--max-duration"));
  const useTools = args.includes("--no-tools") ? false : undefined;

  const objectiveTokens: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (
      token === "--objective" ||
      token === "--model" ||
      token === "--max-iterations" ||
      token === "--max-duration"
    ) {
      i += 1;
      continue;
    }
    if (token === "--no-tools") continue;
    objectiveTokens.push(token);
  }

  return {
    objective: (objectiveFromFlag || objectiveTokens.join(" ")).trim(),
    maxIterations,
    maxDurationSeconds,
    model,
    useTools,
  };
}

async function rawLoopList(agentId?: string): Promise<void> {
  const endpoint = agentId ? `/api/agents/${encodeURIComponent(agentId)}/loops` : "/api/loops";
  const data = await fetchAPI<{ runs: AgentLoopSummary[] }>(endpoint);
  if (!data) {
    console.error("ERROR: Failed to fetch loop runs from", API_BASE);
    process.exit(1);
  }

  const runs = Array.isArray(data.runs) ? data.runs : [];
  console.log("CYBARA AGENT LOOPS");
  console.log("==================");
  if (agentId) {
    console.log(`agent: ${agentId}`);
  }
  console.log(`total: ${runs.length}`);
  console.log("");

  if (runs.length === 0) {
    console.log("No loop runs");
    return;
  }

  for (const run of runs) {
    const status =
      run.status === "running"
        ? "⟳"
        : run.status === "completed"
          ? "✓"
          : run.status === "failed" || run.status === "timeout"
            ? "✗"
            : "•";
    console.log(`${status} ${run.label.slice(0, 60)}`);
    console.log(`  id: ${run.id}`);
    console.log(
      `  status: ${run.status}${run.stopReason ? ` (${run.stopReason})` : ""}  iter: ${run.iterationsCompleted}/${run.maxIterations}`
    );
  }
}

async function rawLoopStart(agentId: string, args: string[]): Promise<void> {
  if (!agentId) {
    console.error("ERROR: Please specify an agent ID");
    console.log("Usage: cybara loop start <agent-id> <objective>");
    process.exit(1);
  }

  const parsed = parseLoopStartArgs(args);
  if (!parsed.objective) {
    console.error("ERROR: Please specify an objective");
    console.log("Usage: cybara loop start <agent-id> <objective>");
    process.exit(1);
  }

  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/loops`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      objective: parsed.objective,
      maxIterations: parsed.maxIterations,
      maxDurationSeconds: parsed.maxDurationSeconds,
      model: parsed.model,
      useTools: parsed.useTools,
      label: parsed.objective.slice(0, 80),
    }),
  });

  const result = (await response.json()) as {
    success?: boolean;
    runId?: string;
    error?: string;
    run?: AgentLoopSummary;
  };

  if (!result.success || !result.runId) {
    console.error(`✗ Failed to start loop: ${result.error || response.statusText}`);
    process.exit(1);
  }

  console.log(`✓ Started loop: ${result.runId}`);
  if (result.run) {
    console.log(`  agent: ${result.run.agentId}`);
    console.log(`  objective: ${result.run.objective.slice(0, 120)}`);
    console.log(`  status: ${result.run.status}`);
  }
}

async function rawLoopShow(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a loop run ID");
    console.log("Usage: cybara loop show <run-id>");
    process.exit(1);
  }

  const data = await fetchAPI<{ success: boolean; error?: string; run?: AgentLoopDetail }>(
    `/api/loops/${encodeURIComponent(id)}`
  );
  if (!data) {
    console.error("ERROR: Failed to fetch loop run from", API_BASE);
    process.exit(1);
  }
  if (!data.success || !data.run) {
    console.error(`ERROR: ${data.error || "Loop run not found"}`);
    process.exit(1);
  }

  const run = data.run;
  console.log("CYBARA LOOP RUN");
  console.log("===============");
  console.log(`id: ${run.id}`);
  console.log(`agent: ${run.agentId}`);
  console.log(`status: ${run.status}${run.stopReason ? ` (${run.stopReason})` : ""}`);
  console.log(`iterations: ${run.iterationsCompleted}/${run.maxIterations}`);
  console.log(`duration_limit_s: ${run.maxDurationSeconds}`);
  console.log(`tools: ${run.useTools ? "enabled" : "disabled"}`);
  console.log(`objective: ${run.objective}`);
  if (run.error) console.log(`error: ${run.error}`);
  if (run.finalResponse) console.log(`final: ${run.finalResponse.slice(0, 200)}`);
}

async function rawLoopCancel(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a loop run ID");
    console.log("Usage: cybara loop cancel <run-id>");
    process.exit(1);
  }

  const response = await fetch(`${API_BASE}/api/loops/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: withCliAuthHeaders(),
  });
  const result = (await response.json()) as { success?: boolean; error?: string };
  if (!result.success) {
    console.error(`✗ Failed to cancel: ${result.error || response.statusText}`);
    process.exit(1);
  }
  console.log(`✓ Cancellation requested: ${id}`);
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

async function rawConfig(subCmd?: string, key?: string, value?: string): Promise<void> {
  if (subCmd === "get" && key) {
    const data = await fetchAPI<Record<string, unknown>>("/api/config");
    if (!data) {
      console.error("ERROR: Failed to fetch config");
      process.exit(1);
    }
    const val = (data as Record<string, unknown>)[key];
    console.log(val !== undefined ? `${key} = ${JSON.stringify(val)}` : `Key '${key}' not found`);
  } else if (subCmd === "set" && key && value !== undefined) {
    const coerced: unknown =
      value === "true"
        ? true
        : value === "false"
          ? false
          : /^-?\d+(\.\d+)?$/.test(value)
            ? Number(value)
            : value; // boolean/number coercion
    const resp = await fetch(`${API_BASE}/api/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ [key]: coerced }),
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
      `  Global Spend: $${status.globalSpendToday.toFixed(4)}${status.globalSpendLimitDaily ? ` / $${status.globalSpendLimitDaily} (daily limit)` : ""}`
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
          `    Price:     $${route.priceInputPerM ?? 0}/M in, $${route.priceOutputPerM ?? 0}/M out`
        );
      }
      console.log("");
    }
    return;
  }

  if (subCmd === "enable" || subCmd === "disable") {
    const current =
      (await fetchAPI<Record<string, unknown>>("/api/router/config")) ||
      ({ strategy: "weighted", fallbackToAny: true, routes: {} } as Record<string, unknown>);
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...current, enabled: subCmd === "enable" }),
    });
    console.log(resp.ok ? `✓ Router ${subCmd}d` : `ERROR: ${resp.status}`);
    return;
  }

  if (subCmd === "strategy") {
    const valid = ["weighted", "round_robin", "lowest_cost", "priority", "mixture_of_agents"];
    const next = args[1];
    if (!next || !valid.includes(next)) {
      console.error(`ERROR: usage: cybara router strategy <${valid.join("|")}>`);
      process.exit(1);
    }
    const current =
      (await fetchAPI<Record<string, unknown>>("/api/router/config")) ||
      ({ enabled: false, fallbackToAny: true, routes: {} } as Record<string, unknown>);
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...current, strategy: next }),
    });
    console.log(resp.ok ? `✓ Router strategy set to ${next}` : `ERROR: ${resp.status}`);
    return;
  }

  if (subCmd === "set" && args[1]) {
    // cybara router set <providerId> weight=70 limit5h=100 spendDaily=5 priceIn=10 priceOut=30
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
    // Fetch current config, merge the route, and save.
    const currentResp = await fetchAPI<Record<string, unknown>>("/api/router/config");
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
    console.log(resp.ok ? `✓ Route set for ${providerId}` : `ERROR: ${resp.status}`);
    return;
  }

  console.log("Router Commands:");
  console.log("  cybara router status              Show router status + route availability");
  console.log("  cybara router enable              Enable the router");
  console.log("  cybara router disable             Disable the router");
  console.log(
    "  cybara router strategy <name>     Set strategy (weighted|round_robin|lowest_cost|priority|mixture_of_agents)"
  );
  console.log("  cybara router set <id> <flags>    Configure a route");
  console.log("    Flags: weight=70 limit5h=100 limitWeekly=500 spendDaily=5 spendWeekly=20");
  console.log("           priceIn=10 priceOut=30 enabled=true");
}

const Logo = ({ compact = false }: { compact?: boolean }) => (
  <Box flexDirection="column" alignItems="center" marginBottom={compact ? 0 : 1}>
    {!compact && (
      <Gradient name="rainbow">
        <Text bold>{"█▀▀ █▄█ █▄▄ █▀█ █▀█ █▀█\n█▄▄  █  █▄█ █▀█ █▀▄ █▀█  CYBARA"}</Text>
      </Gradient>
    )}
    <Text color="gray">Cybara TUI</Text>
  </Box>
);

const Table = ({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) => (
  <Box flexDirection="column">
    <Box>
      {headers.map((h, i) => (
        <Box key={i} width={i === 0 ? 20 : 15} marginRight={1}>
          <Text bold color="cyan">
            {h}
          </Text>
        </Box>
      ))}
    </Box>
    <Box marginBottom={1}>
      <Text color="gray">{"─".repeat(60)}</Text>
    </Box>
    {rows.map((row, i) => (
      <Box key={i}>
        {row.map((cell, j) => (
          <Box key={j} width={j === 0 ? 20 : 15} marginRight={1}>
            {typeof cell === "string" ? <Text>{cell}</Text> : cell}
          </Box>
        ))}
      </Box>
    ))}
  </Box>
);

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    healthy: "green",
    running: "green",
    active: "green",
    eligible: "green",
    stopped: "yellow",
    error: "red",
    blocked: "red",
  };
  return <Text color={colors[status] || "white"}>{status}</Text>;
};

function healthCheckStatus(info: { status?: string }): string {
  return info.status || "ok";
}

const LoadingState = ({ message }: { message: string }) => (
  <Box>
    <Text color="yellow">
      <Spinner type="dots" /> {message}
    </Text>
  </Box>
);

const ErrorState = ({ message }: { message: string }) => (
  <Box>
    <Text color="red">✗ {message}</Text>
  </Box>
);

const TUIStatusCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<StatusResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<StatusResponse>("/api/health")
      .then((d) => {
        if (d) setData(d);
        else setError("Failed to connect to Cybara server");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching status..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="No data" />;

  const checks = Object.entries(data.checks || {});

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold>System Status</Text>
        <Box marginTop={1}>
          <Text color="gray">Status: </Text>
          <StatusBadge status={data.status} />
        </Box>
        <Box>
          <Text color="gray">Uptime: </Text>
          <Text>{formatStatusUptime(data.uptime)}</Text>
        </Box>
        <Box>
          <Text color="gray">Time: </Text>
          <Text>{new Date(data.timestamp).toLocaleString()}</Text>
        </Box>
        {data.system && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="cyan">
              System Monitor
            </Text>
            <Box>
              <Text color="gray">CPU: </Text>
              <Text>
                {formatStatusPct(data.system.cpu?.usagePct)} ({data.system.cpu?.cores || 0} cores)
              </Text>
            </Box>
            <Box>
              <Text color="gray">Memory: </Text>
              <Text>
                {formatStatusPct(data.system.memory?.usedPct)} used (
                {formatStatusBytes(data.system.memory?.usedBytes)} /{" "}
                {formatStatusBytes(data.system.memory?.totalBytes)})
              </Text>
            </Box>
            {data.system.memory?.swap && (
              <Box>
                <Text color="gray">Swap: </Text>
                <Text>
                  {formatStatusPct(data.system.memory.swap.usedPct)} used (
                  {formatStatusBytes(data.system.memory.swap.usedBytes)} /{" "}
                  {formatStatusBytes(data.system.memory.swap.totalBytes)})
                </Text>
              </Box>
            )}
            {data.system.disk && (
              <Box>
                <Text color="gray">Disk: </Text>
                <Text>
                  {formatStatusPct(data.system.disk.usedPct)} used (
                  {formatStatusStorageBytes(data.system.disk.freeBytes)} free)
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
      {checks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            Health Checks
          </Text>
          {checks.map(([name, info]) => (
            <Box key={name}>
              <Box width={15}>
                <Text color="gray">{name}</Text>
              </Box>
              <StatusBadge status={healthCheckStatus(info)} />
              {info.total !== undefined && <Text color="gray"> ({info.total} total)</Text>}
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUIMetricsCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<MetricsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<MetricsResponse>("/api/metrics/overview")
      .then((d) => {
        if (d) setData(d);
        else setError("Failed to fetch metrics");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching metrics..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="No data" />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold>Token Metrics</Text>
        <Box marginTop={1}>
          <Text color="gray">Total Tokens: </Text>
          <Text color="green">{(data.tokenUsage?.total || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Input Tokens: </Text>
          <Text>{(data.tokenUsage?.input || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Output Tokens: </Text>
          <Text>{(data.tokenUsage?.output || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Tool Calls: </Text>
          <Text>{(data.toolCalls?.totalCalls || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">API Calls: </Text>
          <Text>{(data.apiCalls?.totalCalls || 0).toLocaleString()}</Text>
        </Box>
      </Box>
      {data.fileOperations && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            File Operations
          </Text>
          <Box>
            <Box width={20}>
              <Text color="gray">Files Read</Text>
            </Box>
            <Text>{(data.fileOperations.filesRead || 0).toLocaleString()}</Text>
          </Box>
          <Box>
            <Box width={20}>
              <Text color="gray">Files Written</Text>
            </Box>
            <Text>{(data.fileOperations.filesWritten || 0).toLocaleString()}</Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUISkillsCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<SkillItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<{ skills: SkillItem[] }>("/api/skills/status")
      .then((d) => {
        if (d) setData(d.skills || []);
        else setError("Failed to fetch skills");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching skills..." />;
  if (error) return <ErrorState message={error} />;

  const eligible = data.filter((s) => s.eligible).length;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Skills ({eligible}/{data.length} eligible)
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No skills installed</Text>
      ) : (
        <Table
          headers={["Name", "Status", "Source"]}
          rows={data.map((s) => [
            s.name,
            <StatusBadge key={s.name} status={s.eligible ? "eligible" : "blocked"} />,
            s.source,
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUIAgentsCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<AgentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<AgentItem[]>("/api/agents")
      .then((d) => {
        if (d) setData(Array.isArray(d) ? d : []);
        else setError("Failed to fetch agents");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching agents..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Agents ({data.length})
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No agents configured</Text>
      ) : (
        <Table
          headers={["Name", "Type", "Status", "Model"]}
          rows={data.map((a) => [
            a.name,
            a.type,
            <StatusBadge key={a.id} status={a.status} />,
            a.model || "-",
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUITasksCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<TaskItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<TaskItem[]>("/api/tasks")
      .then((d) => {
        if (d) setData(Array.isArray(d) ? d : []);
        else setError("Failed to fetch tasks");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching tasks..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Scheduled Tasks ({data.length})
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No tasks scheduled</Text>
      ) : (
        <Table
          headers={["Name", "Status", "Schedule"]}
          rows={data.map((t) => [
            t.name,
            <StatusBadge key={t.id} status={t.status} />,
            t.schedule || "-",
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

interface TUIRouterRoute {
  providerId: string;
  weight: number;
  enabled: boolean;
  available: boolean;
  reason?: string;
  requestsIn5hWindow?: number;
  requestsInWeekWindow?: number;
  spendToday?: number;
  spendThisWeek?: number;
  priceInputPerM?: number;
  priceOutputPerM?: number;
}

interface TUIRouterStatus {
  enabled: boolean;
  strategy: string;
  globalSpendToday?: number;
  globalSpendLimitDaily?: number;
  totalRequests?: number;
  routes: TUIRouterRoute[];
}

interface TUIProviderPlanWindow {
  id: string;
  kind: string;
  title: string;
  usedPercent?: number;
  usageKnown?: boolean;
  unlimited?: boolean;
  resetsAt?: string;
}

interface TUIProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  managedAutomatically?: boolean;
  status: string;
  sourceLabel?: string;
  windows?: TUIProviderPlanWindow[];
}

interface TUIProviderPlanStatus {
  providers: TUIProviderPlanSnapshot[];
}

interface TUIMobileDevice {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

function truncateText(value: unknown, max = 28): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatRelativeTime(value?: string): string {
  if (!value) return "-";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "-";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < month) return `${Math.floor(diff / day)}d`;
  return `${Math.floor(diff / month)}mo`;
}

function usageTone(percent: number | null, unlimited = false): string {
  if (unlimited) return "green";
  if (percent === null) return "gray";
  if (percent < 40) return "green";
  if (percent < 65) return "blue";
  if (percent < 80) return "yellow";
  if (percent < 95) return "magenta";
  return "red";
}

function formatPlanReset(resetsAt?: string): string {
  if (!resetsAt) return "";
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return "";
  const diff = resetMs - Date.now();
  if (diff <= 0) return " reset ready";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return ` resets ${Math.max(1, Math.ceil(diff / minute))}m`;
  if (diff < day) return ` resets ${Math.ceil(diff / hour)}h`;
  return ` resets ${Math.ceil(diff / day)}d`;
}

const UsageBar = ({
  percent,
  unlimited = false,
  width = 14,
}: {
  percent: number | null;
  unlimited?: boolean;
  width?: number;
}) => {
  if (unlimited) return <Text color="green">∞ unlimited</Text>;
  if (percent === null) return <Text color="gray">--</Text>;
  const bounded = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.max(0, Math.min(width, Math.round((bounded / 100) * width)));
  return (
    <Text color={usageTone(bounded)}>
      {"["}
      {"#".repeat(filled)}
      {"-".repeat(width - filled)}
      {"] "}
      {bounded}%
    </Text>
  );
};

function planWindow(
  plan: TUIProviderPlanSnapshot | undefined,
  kind: "rolling_5h" | "rolling_week"
): { percent: number | null; unlimited: boolean; reset: string } {
  const window = plan?.windows?.find(
    (entry) =>
      entry.kind === kind &&
      entry.usageKnown !== false &&
      (entry.unlimited || typeof entry.usedPercent === "number")
  );
  if (!window) return { percent: null, unlimited: false, reset: "" };
  return {
    percent: typeof window.usedPercent === "number" ? window.usedPercent : null,
    unlimited: window.unlimited === true,
    reset: formatPlanReset(window.resetsAt),
  };
}

const TUIProvidersCommand = () => {
  const { exit } = useApp();
  const [providers, setProviders] = React.useState<ProviderInfo[]>([]);
  const [plans, setPlans] = React.useState<TUIProviderPlanStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    Promise.all([fetchAPI<ProviderInfo[]>("/api/providers"), fetchAPI<TUIProviderPlanStatus>("/api/provider-plans/status")])
      .then(([providerData, planData]) => {
        if (providerData) setProviders(Array.isArray(providerData) ? providerData : []);
        else setError("Failed to fetch providers");
        if (planData) setPlans(planData);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching providers..." />;
  if (error) return <ErrorState message={error} />;

  const planByKey = new Map<string, TUIProviderPlanSnapshot>();
  for (const plan of plans?.providers || []) {
    for (const key of [plan.providerId, plan.configuredProviderId, plan.providerType]) {
      if (key && !planByKey.has(key)) planByKey.set(key, plan);
    }
  }

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1} flexDirection="column">
        <Text bold color="cyan">
          Providers ({providers.length})
        </Text>
        <Text color="gray">Default, auth type, and live coding-plan limits where available.</Text>
      </Box>
      {providers.length === 0 ? (
        <Text color="gray">No providers configured</Text>
      ) : (
        <Box flexDirection="column">
          {providers.slice(0, 12).map((provider) => {
            const plan = planByKey.get(provider.id) || planByKey.get(provider.provider);
            const fiveHour = planWindow(plan, "rolling_5h");
            const weekly = planWindow(plan, "rolling_week");
            return (
              <Box key={provider.id} flexDirection="column" marginBottom={1}>
                <Box>
                  <Box width={28}>
                    <Text bold>{truncateText(provider.name, 26)}</Text>
                  </Box>
                  <Box width={18}>
                    <Text color="gray">{truncateText(provider.provider, 16)}</Text>
                  </Box>
                  <Box width={10}>
                    <Text color={provider.is_default ? "green" : "gray"}>
                      {provider.is_default ? "default" : ""}
                    </Text>
                  </Box>
                  <StatusBadge status={plan?.status || "unknown"} />
                </Box>
                {plan?.managedAutomatically && (
                  <Box marginLeft={2}>
                    <Box width={26}>
                      <Text color="gray">5h </Text>
                      <UsageBar percent={fiveHour.percent} unlimited={fiveHour.unlimited} />
                    </Box>
                    <Box width={30}>
                      <Text color="gray">Weekly </Text>
                      <UsageBar percent={weekly.percent} unlimited={weekly.unlimited} />
                    </Box>
                    <Text color="gray">{fiveHour.reset || weekly.reset}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUIRouterCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<TUIRouterStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<TUIRouterStatus>("/api/router/status")
      .then((status) => {
        if (status) setData(status);
        else setError("Failed to fetch router status");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching router..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="No data" />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor={data.enabled ? "cyan" : "yellow"}
        paddingX={2}
        paddingY={1}
      >
        <Text bold>Model Router</Text>
        <Box marginTop={1}>
          <Text color="gray">State: </Text>
          <StatusBadge status={data.enabled ? "active" : "stopped"} />
          <Text color="gray">  Strategy: </Text>
          <Text>{data.strategy || "weighted"}</Text>
        </Box>
        <Box>
          <Text color="gray">Spend today: </Text>
          <Text>${Number(data.globalSpendToday || 0).toFixed(4)}</Text>
          {typeof data.globalSpendLimitDaily === "number" && (
            <Text color="gray"> / ${data.globalSpendLimitDaily.toFixed(2)}</Text>
          )}
        </Box>
      </Box>
      {data.routes.length === 0 ? (
        <Text color="gray">No router routes configured</Text>
      ) : (
        <Table
          headers={["Provider", "State", "Weight", "5h", "Week"]}
          rows={data.routes.slice(0, 12).map((route) => [
            truncateText(route.providerId, 18),
            <StatusBadge
              key={`${route.providerId}-state`}
              status={!route.enabled ? "stopped" : route.available ? "active" : "blocked"}
            />,
            String(route.weight),
            String(route.requestsIn5hWindow ?? 0),
            String(route.requestsInWeekWindow ?? 0),
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUISessionsCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<SessionInfo[]>([]);
  const [agentsById, setAgentsById] = React.useState<Map<string, AgentItem>>(() => new Map());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    Promise.all([fetchAPI<SessionInfo[]>("/api/sessions"), fetchAPI<AgentItem[]>("/api/agents")])
      .then(([sessions, agents]) => {
        if (sessions) setData(Array.isArray(sessions) ? sessions : []);
        else setError("Failed to fetch sessions");
        setAgentsById(
          new Map((Array.isArray(agents) ? agents : []).map((agent) => [agent.id, agent]))
        );
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching sessions..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Sessions ({data.length})
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No sessions found</Text>
      ) : (
        <Table
          headers={["Session", "Agent", "Messages", "Updated"]}
          rows={data.slice(0, 14).map((session) => [
            truncateText(session.title || session.id, 18),
            truncateText(sessionAgentLabel(session, agentsById), 18),
            String(sessionMessageCount(session)),
            formatRelativeTime(sessionUpdatedAt(session)),
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUILogsCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<LogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<LogEntry[]>("/api/logs/system?limit=12")
      .then((logs) => {
        if (logs) setData(Array.isArray(logs) ? logs : []);
        else setError("Failed to fetch logs");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching logs..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Logs
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No logs available</Text>
      ) : (
        <Box flexDirection="column">
          {data.map((log, index) => {
            const level = (log.level || "info").toUpperCase();
            const source = truncateText(log.module || log.source || log.logType || "gateway", 12);
            const timestamp = log.timestamp || log.created_at;
            return (
              <Box key={`log-${index}`}>
                <Box width={7}>
                  <Text color={level === "ERROR" ? "red" : level === "WARN" ? "yellow" : "gray"}>
                    {level}
                  </Text>
                </Box>
                <Box width={14}>
                  <Text color="gray">{source}</Text>
                </Box>
                <Box width={8}>
                  <Text color="gray">{formatRelativeTime(timestamp)}</Text>
                </Box>
                <Text>{truncateText(log.message || "", 60)}</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUIMobileCommand = () => {
  const { exit } = useApp();
  const [data, setData] = React.useState<TUIMobileDevice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    fetchAPI<{ devices: TUIMobileDevice[] }>("/api/mobile/devices")
      .then((result) => {
        if (result) setData(result.devices || []);
        else setError("Failed to fetch mobile devices");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching mobile devices..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1} flexDirection="column">
        <Text bold color="cyan">
          Mobile Devices ({data.length})
        </Text>
        <Text color="gray">Pair with: cybara mobile connect --code</Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No mobile devices paired</Text>
      ) : (
        <Table
          headers={["Device", "Status", "Last Seen", "Gateway"]}
          rows={data.slice(0, 12).map((device) => [
            truncateText(device.name || device.id, 18),
            <StatusBadge key={device.id} status={device.status} />,
            formatRelativeTime(device.lastSeenAt || device.createdAt),
            truncateText(device.baseUrl, 28),
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const UpdateBanner = () => {
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isUpdateCheckDisabled()) return;
    let active = true;
    checkForUpdateInBackground()
      .then((result) => {
        if (!active || !result?.updateAvailable || !result.latestVersion) return;
        setMessage(`v${result.latestVersion} is available — run \`cybara update\` to upgrade.`);
      })
      .catch(() => {
        /* never block the TUI on an update probe */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!message) return null;
  return (
    <Box marginY={1}>
      <Text color="yellow">↑ {message}</Text>
    </Box>
  );
};

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
}

const FALLBACK_PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models (3.5 Sonnet, Opus, Haiku)",
    requiresApiKey: true,
  },
  { id: "openai", name: "OpenAI", description: "GPT-4o, GPT-4, GPT-3.5", requiresApiKey: true },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Gemini Pro, Ultra models",
    requiresApiKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access many models via OpenRouter",
    requiresApiKey: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Run models locally with Ollama",
    requiresApiKey: false,
  },
  {
    id: "lmstudio",
    name: "LM Studio (Local)",
    description: "Local models via LM Studio",
    requiresApiKey: false,
  },
];

const SetupWizard = () => {
  const { exit } = useApp();
  const [step, setStep] = React.useState<
    "welcome" | "provider" | "apikey" | "permissions" | "agent" | "complete"
  >("welcome");
  const [providerOptions, setProviderOptions] =
    React.useState<ProviderOption[]>(FALLBACK_PROVIDER_OPTIONS);
  const [selectedProvider, setSelectedProvider] = React.useState(0);
  const [apiKey, setApiKey] = React.useState("");
  const [toolApprovalMode, setToolApprovalMode] = React.useState<"always_allow" | "ask">("ask");
  const [status, setStatus] = React.useState<{
    message: string;
    type: "info" | "success" | "error" | "loading";
  } | null>(null);

  React.useEffect(() => {
    fetchAPI<AvailableProviderInfo[]>("/api/providers/available")
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const mapped = data.map((provider) => {
          const authType = typeof provider.authType === "string" ? provider.authType : "api_key";
          return {
            id: provider.id,
            name: provider.name,
            description: provider.description || `Use ${provider.name} models`,
            requiresApiKey: authType !== "none" && authType !== "oauth" && authType !== "aws-sdk",
          } satisfies ProviderOption;
        });
        if (mapped.length > 0) {
          setProviderOptions(mapped);
        }
      })
      .catch(() => {
        void 0;
      });
  }, []);

  React.useEffect(() => {
    if (providerOptions.length === 0) {
      setSelectedProvider(0);
      return;
    }
    if (selectedProvider >= providerOptions.length) {
      setSelectedProvider(providerOptions.length - 1);
    }
  }, [providerOptions, selectedProvider]);

  useInput(
    (input, key) => {
      if (step === "welcome") {
        if (key.return || input === " ") {
          setStep("provider");
        } else if (input === "q") {
          exit();
        }
      } else if (step === "provider") {
        if (key.upArrow) {
          setSelectedProvider((s) => (s > 0 ? s - 1 : Math.max(0, providerOptions.length - 1)));
        } else if (key.downArrow) {
          setSelectedProvider((s) => (s < providerOptions.length - 1 ? s + 1 : 0));
        } else if (key.return) {
          const provider = providerOptions[selectedProvider];
          if (!provider) return;
          if (provider.requiresApiKey) {
            setStep("apikey");
          } else {
            createProvider(provider.id, "");
          }
        } else if (input === "q") {
          exit();
        }
      } else if (step === "apikey") {
        if (key.return) {
          if (apiKey.length > 0) {
            const provider = providerOptions[selectedProvider];
            if (provider) {
              createProvider(provider.id, apiKey);
            }
          }
        } else if (key.backspace || key.delete) {
          setApiKey((k) => k.slice(0, -1));
        } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setApiKey((k) => k + input);
        } else if (input === "") {
          exit();
        }
      } else if (step === "permissions") {
        if (key.leftArrow || input === "1" || input.toLowerCase() === "a") {
          setToolApprovalMode("always_allow");
        } else if (key.rightArrow || input === "2" || input.toLowerCase() === "s") {
          setToolApprovalMode("ask");
        } else if (key.return) {
          saveToolApprovalMode();
        } else if (input === "b" || input === "B") {
          setStep("provider");
        }
      } else if (step === "agent") {
        if (key.return || input === "y" || input === "Y") {
          createDefaultAgent();
        } else if (input === "n" || input === "N") {
          completeSetup();
        }
      } else if (step === "complete") {
        if (key.return || input === " " || input === "q") {
          exit();
        }
      }
    },
    TUI_INPUT_OPTIONS
  );

  const createProvider = async (providerId: string, key: string) => {
    setStatus({ message: "Creating provider...", type: "loading" });

    const result = await fetchAPI<{ id?: string; error?: string }>("/api/providers", {
      method: "POST",
      body: JSON.stringify({
        provider: providerId,
        name: providerOptions.find((p) => p.id === providerId)?.name || providerId,
        api_key: key || undefined,
        is_default: true,
      }),
    });

    if (result?.id) {
      setStatus({ message: "Provider created!", type: "success" });
      setTimeout(() => {
        setStatus(null);
        setStep("permissions");
      }, 1000);
    } else {
      setStatus({ message: result?.error || "Failed to create provider", type: "error" });
    }
  };

  const saveToolApprovalMode = async () => {
    setStatus({ message: "Saving tool approval mode...", type: "loading" });
    const result = await fetchAPI<{ success?: boolean; error?: string }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ tool_approval_mode: toolApprovalMode }),
    });

    if (result && result.success !== false) {
      setStatus({ message: "Permissions saved!", type: "success" });
      setTimeout(() => {
        setStatus(null);
        setStep("agent");
      }, 800);
      return;
    }

    setStatus({ message: result?.error || "Failed to save permissions", type: "error" });
  };

  const createDefaultAgent = async () => {
    setStatus({ message: "Creating default agent...", type: "loading" });

    const result = await fetchAPI<{ id?: string; error?: string }>("/api/agents/default", {
      method: "POST",
    });

    if (result?.id || result?.error === "Default agent already exists") {
      setStatus({ message: "Agent ready!", type: "success" });
      setTimeout(() => completeSetup(), 1000);
    } else {
      setStatus({ message: result?.error || "Failed to create agent", type: "error" });
      setTimeout(() => completeSetup(), 2000);
    }
  };

  const completeSetup = async () => {
    await fetchAPI("/api/setup/complete", { method: "POST" });
    setStep("complete");
  };

  return (
    <Box flexDirection="column">
      <Logo />
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        {step === "welcome" && (
          <>
            <Text bold>Welcome to Cybara! 🚀</Text>
            <Box marginTop={1}>
              <Text>This wizard will help you set up Cybara for first use.</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">We'll configure:</Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              <Text color="gray">• An AI provider (OpenAI, Anthropic, etc.)</Text>
              <Text color="gray">• Tool permission mode (Always Allow or Ask)</Text>
              <Text color="gray">• A default agent to chat with</Text>
            </Box>
            <Box marginTop={2}>
              <Text color="green" bold>
                Press ENTER to begin
              </Text>
            </Box>
          </>
        )}

        {step === "provider" && (
          <>
            <Text bold>Select AI Provider</Text>
            <Box marginTop={1} flexDirection="column">
              {providerOptions.map((p, i) => (
                <Box key={p.id}>
                  <Text color={i === selectedProvider ? "cyan" : "white"}>
                    {i === selectedProvider ? "❯ " : "  "}
                    {p.name}
                  </Text>
                  <Text color="gray"> - {p.description}</Text>
                </Box>
              ))}
              {providerOptions.length === 0 && <Text color="gray">No providers available</Text>}
            </Box>
            <Box marginTop={1}>
              <Text color="gray">↑↓ to select, ENTER to confirm</Text>
            </Box>
          </>
        )}

        {step === "apikey" && (
          <>
            <Text bold>
              Enter API Key for {providerOptions[selectedProvider]?.name || "Provider"}
            </Text>
            <Box marginTop={1}>
              <Text color="gray">API Key: </Text>
              <Text>{apiKey.length > 0 ? "•".repeat(apiKey.length) : "(type your key)"}</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">Press ENTER when done</Text>
            </Box>
          </>
        )}

        {step === "permissions" && (
          <>
            <Text bold>Tool Approval Mode</Text>
            <Box marginTop={1}>
              <Text color="gray">Choose how dangerous tools should be handled.</Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text color={toolApprovalMode === "always_allow" ? "cyan" : "white"}>
                {toolApprovalMode === "always_allow" ? "❯ " : "  "}
                1) Always Allow
              </Text>
              <Text color="gray"> Run tools immediately in chat and channels.</Text>
              <Text color={toolApprovalMode === "ask" ? "cyan" : "white"}>
                {toolApprovalMode === "ask" ? "❯ " : "  "}
                2) Ask Me First
              </Text>
              <Text color="gray"> Require approval before dangerous tool calls.</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">1/A or 2/S to choose, ENTER to continue</Text>
            </Box>
          </>
        )}

        {step === "agent" && (
          <>
            <Text bold>Create Default Agent?</Text>
            <Box marginTop={1}>
              <Text>This creates a general-purpose AI assistant agent.</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="green">Y</Text>
              <Text> - Yes, create it </Text>
              <Text color="yellow">N</Text>
              <Text> - No, I'll configure later</Text>
            </Box>
          </>
        )}

        {step === "complete" && (
          <>
            <Text bold color="green">
              ✓ Setup Complete!
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text>Cybara is ready to use. Here's what you can do:</Text>
            </Box>
            <Box marginTop={1} marginLeft={2} flexDirection="column">
              <Text color="cyan">• Open the dashboard: </Text>
              <Text color="white"> http://localhost:4269</Text>
              <Text color="cyan">• Chat in terminal: </Text>
              <Text color="white"> cybara chat "Hello!"</Text>
              <Text color="cyan">• Configure more: </Text>
              <Text color="white"> Settings → Providers / Agents</Text>
            </Box>
            <Box marginTop={2}>
              <Text color="gray">Press ENTER to exit</Text>
            </Box>
          </>
        )}
      </Box>
      {status && (
        <Box marginTop={1}>
          {status.type === "loading" ? (
            <Text color="yellow">
              <Spinner type="dots" /> {status.message}
            </Text>
          ) : status.type === "success" ? (
            <Text color="green">✓ {status.message}</Text>
          ) : status.type === "error" ? (
            <Text color="red">✗ {status.message}</Text>
          ) : (
            <Text color="blue">ℹ {status.message}</Text>
          )}
        </Box>
      )}
    </Box>
  );
};

const TUIApp = ({ command }: { command?: string }) => {
  switch (command) {
    case "wizard":
    case "setup":
    case "install":
      return <SetupWizard />;
    case "status":
      return <TUIStatusCommand />;
    case "metrics":
      return <TUIMetricsCommand />;
    case "tasks":
      return <TUITasksCommand />;
    case "skills":
      return <TUISkillsCommand />;
    case "agents":
      return <TUIAgentsCommand />;
    case "providers":
    case "provider":
      return <TUIProvidersCommand />;
    case "router":
      return <TUIRouterCommand />;
    case "chat":
      return <TUIChatCommand fetchAPI={fetchAPI} />;
    case "sessions":
      return <TUISessionsCommand />;
    case "logs":
      return <TUILogsCommand />;
    case "mobile":
      return <TUIMobileCommand />;
    default:
      return (
        <MainMenu
          apiBase={API_BASE}
          header={<Logo />}
          onOpenPanel={(action: MainMenuAction) => {
            render(<TUIApp command={action} />);
          }}
          onOpenWebUI={() => {
            spawn("open", [`${API_BASE}`]);
          }}
          onStartServer={() => {
            spawn("bun", ["run", "dev"], { stdio: "inherit" });
          }}
          updateBanner={<UpdateBanner />}
        />
      );
  }
};

const args = process.argv.slice(2);
const command = args[0];

function wantsForegroundStart(rest: string[]): boolean {
  return hasFlag(rest, "--foreground", "--attach", "-f");
}

function resolveGatewayLogPath(): string {
  const base = process.env.CYBARA_HOME || join(process.env.HOME || homedir(), ".cybara");
  const dir = join(base, "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, "gateway.out.log");
}

function launchGateway(rest: string[]): void {
  if (wantsForegroundStart(rest)) {
    spawn("bun", ["run", "dev"], { stdio: "inherit" });
    return;
  }
  const logPath = resolveGatewayLogPath();
  const logFd = openSync(logPath, "a");
  const child = spawn("bun", ["run", "dev"], {
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  child.unref();
  console.log(`Cybara gateway starting in the background (pid ${child.pid ?? "?"}).`);
  console.log(`  Logs:   ${logPath}`);
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
  return !["wizard", "setup", "install", "configure", "onboard", "tui"].includes(command);
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

type GitHubReleaseNamedAsset = GitHubReleaseAsset & { name: string };

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
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
    console.error(`ERROR: ${result.error || `Gateway restart failed (${response.status})`}`);
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
      console.log("  cybara gateway start           - Start the local gateway (background)");
      console.log("  cybara gateway start --foreground - Start attached to this terminal");
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

async function rawPairCommand(args: string[]): Promise<void> {
  const pairSubCmd = args[0];
  if (!pairSubCmd || pairSubCmd === "list") {
    await rawPairList();
  } else if (pairSubCmd === "reject") {
    const rejectCode = args[1];
    if (!rejectCode) {
      console.error("Usage: cybara pair reject <CODE>");
      process.exit(1);
    }
    await rawPairReject(rejectCode);
  } else if (pairSubCmd === "policy") {
    const channelName = args[1];
    const policy = args[2];
    if (!channelName || !policy) {
      console.error("Usage: cybara pair policy <channel> <policy>");
      console.log("Policies: pairing, allowlist, open, disabled");
      process.exit(1);
    }
    await rawPairPolicy(channelName, policy);
  } else {
    await rawPairApprove(pairSubCmd);
  }
}

async function fetchGitHubRelease(
  repository: string,
  versionArg?: string
): Promise<{ release: GitHubReleaseResponse; assetName: string; downloadUrl: string }> {
  const releaseApiUrl = buildGitHubReleaseApiUrl(repository, versionArg);
  const assetName = resolveReleaseBinaryFilename(process.platform, process.arch);

  if (!assetName) {
    console.error(`No release asset mapping exists for ${process.platform}/${process.arch}.`);
    process.exit(1);
  }

  const releaseResponse = await fetch(releaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cybara-cli",
    },
  });
  if (!releaseResponse.ok) {
    console.error(`Failed to fetch release metadata (${releaseResponse.status}).`);
    process.exit(1);
  }

  const release = (await releaseResponse.json()) as GitHubReleaseResponse;
  const hasExe = assetName.endsWith(".exe");
  const legacyBase = hasExe ? assetName.slice(0, -4) : assetName;
  const suffix = `${legacyBase.replace(/^cybara/, "")}-cli`;
  const asset = (release.assets || []).find((candidate): candidate is GitHubReleaseNamedAsset => {
    const candidateName = candidate.name;
    if (!candidateName || candidateName.endsWith(".sha256")) return false;
    const base = candidateName.endsWith(".exe") ? candidateName.slice(0, -4) : candidateName;
    return base.endsWith(suffix);
  });
  const downloadUrl = asset?.browser_download_url;

  if (!asset || !downloadUrl) {
    console.error(`Release ${release.tag_name || "latest"} does not contain a CLI asset (*${suffix}).`);
    process.exit(1);
  }

  return { release, assetName: asset.name, downloadUrl };
}

function computeFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

async function fetchExpectedChecksum(
  repository: string,
  assetName: string,
  tagName?: string
): Promise<string | null> {
  const checksumUrl = buildReleaseChecksumUrl(repository, assetName, tagName);
  try {
    const response = await fetch(checksumUrl, {
      headers: { "User-Agent": "cybara-cli" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const raw = (await response.text()).trim();
    // Sidecars are written as "<hash>  <filename>"; tolerate bare hashes too.
    const firstToken = raw.split(/\s+/)[0]?.toLowerCase();
    return /^[0-9a-f]{64}$/.test(firstToken) ? firstToken : null;
  } catch {
    return null;
  }
}

interface UpdateOptions {
  version?: string;
  checkOnly?: boolean;
  force?: boolean;
}

async function rawUpdate(options: UpdateOptions = {}): Promise<void> {
  const { version: versionArg, checkOnly = false, force = false } = options;
  const repository = getReleaseRepository();
  const { release, assetName, downloadUrl } = await fetchGitHubRelease(repository, versionArg);

  const currentVersion = getAppVersion();
  const latestTag = release.tag_name?.trim() || "";
  const latestVersion = latestTag.replace(/^v/i, "");
  const updateAvailable = latestVersion ? isNewerVersion(latestVersion, currentVersion) : false;

  if (checkOnly) {
    if (!latestVersion) {
      console.log("Could not determine the latest published version.");
      process.exit(1);
    }
    if (updateAvailable) {
      console.log(`Update available: ${currentVersion} -> ${latestVersion}`);
      console.log(release.html_url || `https://github.com/${repository}/releases/latest`);
      process.exit(1); // non-zero signals "stale" for scripts/CI
    }
    console.log(`Already on the latest release (${currentVersion}).`);
    process.exit(0);
  }

  if (latestVersion && !updateAvailable && !force) {
    console.log(`Already on the latest release (${currentVersion}). Use --force to reinstall.`);
    return;
  }

  const destinationPath = resolveSelfUpdateDestination(process.execPath, process.platform);
  const destinationDir = dirname(destinationPath);
  mkdirSync(destinationDir, { recursive: true });

  const extension = process.platform === "win32" ? ".exe" : "";
  const tempPath = join(destinationDir, `.cybara-update-${Date.now()}${extension}`);

  console.log(`Downloading ${release.tag_name || "latest"} from ${repository}...`);
  const downloadResponse = await fetch(downloadUrl, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "cybara-cli",
    },
  });
  if (!downloadResponse.ok) {
    console.error(`Failed to download release asset (${downloadResponse.status}).`);
    process.exit(1);
  }

  await Bun.write(tempPath, Buffer.from(await downloadResponse.arrayBuffer()));

  // Integrity check: verify the downloaded binary against its published SHA256 sidecar.
  const expectedChecksum = await fetchExpectedChecksum(repository, assetName, release.tag_name);
  if (expectedChecksum) {
    const actualChecksum = computeFileSha256(tempPath);
    if (actualChecksum !== expectedChecksum) {
      unlinkSync(tempPath);
      console.error(
        "Checksum verification FAILED — the downloaded asset is corrupted or tampered."
      );
      console.error(`Expected: ${expectedChecksum}`);
      console.error(`Actual:   ${actualChecksum}`);
      console.error("Aborting update. Re-run later or download manually from GitHub Releases.");
      process.exit(1);
    }
    console.log("Checksum verified.");
  } else if (!force) {
    // Refuse to install an unverified binary unless the user explicitly opts in with --force.
    unlinkSync(tempPath);
    console.error("No SHA256 checksum sidecar was found for this release asset.");
    console.error(
      "For your safety, the update was aborted. If you understand the risk, re-run with --force."
    );
    process.exit(1);
  } else {
    console.warn("Warning: no checksum sidecar found; installing unverified (--force).");
  }

  if (process.platform !== "win32") {
    chmodSync(tempPath, 0o755);
  }

  if (process.platform === "win32" && destinationPath === process.execPath) {
    const fallbackPath = join(tmpdir(), `cybara-${release.tag_name || "latest"}${extension}`);
    copyFileSync(tempPath, fallbackPath);
    unlinkSync(tempPath);
    console.log("Windows cannot replace the running executable in place.");
    console.log(`Downloaded the update to: ${fallbackPath}`);
    console.log(`Replace ${process.execPath} with that file after exiting Cybara.`);
    return;
  }

  if (process.platform === "win32") {
    copyFileSync(tempPath, destinationPath);
    unlinkSync(tempPath);
  } else {
    renameSync(tempPath, destinationPath);
  }

  console.log(`Updated Cybara to ${release.tag_name || "latest"}.`);
  console.log(`Binary path: ${destinationPath}`);
  if (destinationPath !== process.execPath) {
    console.log("If this binary is not already on your PATH, add it before the next run.");
  }
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
        checkOnly: hasFlag(args.slice(1), "--check", "-c") || args[1] === "check",
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
          await rawPlugins();
          break;
        case "validate":
          if (!args[2]) {
            console.error("Usage: cybara plugin validate <path>");
            process.exit(1);
          }
          await rawPluginValidate(args[2]);
          break;
        case "install":
          if (!args[2]) {
            console.error("Usage: cybara plugin install <path>");
            process.exit(1);
          }
          await rawPluginInstall(args[2]);
          break;
        case "delete":
        case "remove":
        case "uninstall":
          if (!args[2]) {
            console.error("Usage: cybara plugin remove <plugin-id>");
            process.exit(1);
          }
          await rawPluginRemove(args[2]);
          break;
        default:
          console.log("Plugin Commands:");
          console.log("  cybara plugin list                - List installed plugins");
          console.log("  cybara plugin validate <path>     - Validate a plugin manifest and dirs");
          console.log("  cybara plugin install <path>      - Install a local plugin");
          console.log("  cybara plugin remove <plugin-id>  - Remove an installed local plugin");
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
            flags.oauth
          );
          break;
        }
        case "update": {
          const uFlags = parseProviderFlags(args.slice(3));
          await rawProviderUpdate(provArg, uFlags.name, uFlags.key, uFlags.token, uFlags.isDefault);
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
          console.log("  cybara provider              - List configured providers");
          console.log("  cybara provider available     - Show available provider types");
          console.log("  cybara provider add <type>    - Add provider");
          console.log("    --name NAME   Display name");
          console.log("    --key KEY     API key");
          console.log("    --token TOK   Access token");
          console.log("    --oauth       Connect via OAuth device code flow");
          console.log("    --default     Set as default");
          console.log("  cybara provider update <id>   - Update provider");
          console.log("  cybara provider delete <id>   - Delete provider");
          console.log("  cybara provider models <id>   - List provider models");
          console.log("  cybara provider discover      - Discover Ollama models");
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
    case "migrate":
    case "migration":
      await rawMigrate(args.slice(1));
      break;
    case "router":
      await rawRouter(args.slice(1));
      break;
    case "acp":
      await (await import("./cli-acp")).runAcpCommand(args.slice(1));
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
    case "logs": {
      await rawLogsCommand(args.slice(1));
      break;
    }
    case "subagent":
    case "subagents":
      await runSubagentCommand(args.slice(1), {
        apiBase: API_BASE,
        apiKey: CLI_API_KEY,
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
          console.log("  cybara loop list [--agent <id>]      - List loop runs");
          console.log("  cybara loop start <agent-id> <obj>   - Start loop run");
          console.log("  cybara loop show <run-id>            - Show loop details");
          console.log("  cybara loop cancel <run-id>          - Cancel loop run");
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
            getFlagValue(walletArgs, "--mnemonic")
          );
          break;
        case "unlock":
          await rawWalletUnlock(getFlagValue(walletArgs, "--password"));
          break;
        case "lock":
          await rawWalletLock();
          break;
        case "accounts":
          await rawWalletAccounts(
            getFlagValue(walletArgs, "--chains"),
            getFlagValue(walletArgs, "--count"),
            getFlagValue(walletArgs, "--start")
          );
          break;
        case "balances":
          await rawWalletBalances(
            getFlagValue(walletArgs, "--chains"),
            getFlagValue(walletArgs, "--count"),
            getFlagValue(walletArgs, "--start")
          );
          break;
        case "tokens":
          await rawWalletTokenBalances(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
            walletArgs.includes("--include-zero")
          );
          break;
        case "token-tx":
        case "token-transactions":
          await rawWalletTokenTransactions(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
            getFlagValue(walletArgs, "--limit"),
            getFlagValue(walletArgs, "--token"),
            getFlagValue(walletArgs, "--rpc")
          );
          break;
        case "tx":
        case "transactions":
          await rawWalletTransactions(
            walletArgs[0],
            getFlagValue(walletArgs, "--index"),
            getFlagValue(walletArgs, "--limit")
          );
          break;
        case "receive":
          await rawWalletReceive(walletArgs[0], getFlagValue(walletArgs, "--index"));
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
          console.log('  cybara wallet import --password <password> --mnemonic "<24 words>"');
          console.log("  cybara wallet unlock --password <password>");
          console.log("  cybara wallet lock");
          console.log("  cybara wallet accounts [--chains eth,btc,sol] [--count N] [--start N]");
          console.log("  cybara wallet balances [--chains eth,btc,sol] [--count N] [--start N]");
          console.log("  cybara wallet tokens <eth|sol> [--index N] [--include-zero]");
          console.log(
            "  cybara wallet token-tx <eth|sol> [--index N] [--limit N] [--token ADDRESS]"
          );
          console.log("  cybara wallet receive <eth|btc|sol> [--index N]");
          console.log("  cybara wallet tx <eth|btc|sol> [--index N] [--limit N]");
          console.log(
            "  cybara wallet send <eth|btc|sol> --to <address> --amount <value> [--index N]"
          );
          console.log(
            "  cybara wallet send-token <eth|sol> --token <address|mint> --to <address> --amount <value> [--index N]"
          );
          console.log(
            "  cybara wallet swap-eth-uniswap --token <symbol|address> (--percent N | --amount-eth ETH) [--execute]"
          );
          console.log(
            "  cybara wallet price [BTC|BTC/USD|<solMint>] [--source auto|chainlink|pyth|jupiter]"
          );
          console.log(
            "  cybara wallet swap [<ethToken>] [--venue <uniswap_v3|uniswap_v2|jupiter>] [--execute] [--quote-only]"
          );
          console.log("  cybara wallet endpoints");
          console.log("  cybara wallet dapps");
          console.log(
            "  cybara wallet rpc-call <eth|sol> --method <rpc_method> [--params '[...]'] [--rpc URL]"
          );
          console.log("  cybara wallet dapp --adapter <adapter> --json '{...}'");
          console.log(
            "  cybara wallet x402 --url <https_url> [--method GET|POST] [--headers '{...}'] [--body-json '{...}' | --body TEXT] [--network eip155:8453] [--max-amount-atomic N] [--dry-run]"
          );
          console.log(
            "  cybara wallet swap-quote --venue <uniswap_v2|uniswap_v3|jupiter> ... (legacy alias)"
          );
          console.log(
            "  cybara wallet swap-execute --venue <uniswap_v2|uniswap_v3|jupiter> ... (legacy alias)"
          );
          console.log(
            "  cybara wallet contract-call --contract <address> (--abi '<json_or_signature>' | --signature '<name(types)>') [--method <name>]"
          );
          console.log(
            "  cybara wallet sol-instruction --program <programId> (--keys '[...]' | --accounts '[...]')"
          );
          console.log("  cybara wallet agent-access <on|off>");
          console.log("  cybara wallet agent-policy [show]");
          console.log("  cybara wallet agent-policy set --json '{...}'");
          console.log("  cybara wallet rpc [show]");
          console.log("  cybara wallet rpc status");
          console.log("  cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]");
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
        case "list":
          await rawMcpList();
          break;
        case "popular":
          await rawMcpPopular();
          break;
        case "serve":
          // Expose cybara's own tools as an MCP server over stdio, so other MCP
          // clients (Claude Desktop, other agents, IDEs) can call them.
          await runMcpStdioServer();
          break;
        default:
          console.log("MCP Commands:");
          console.log("  cybara mcp list       - List installed servers");
          console.log("  cybara mcp search <q> - Search registry");
          console.log("  cybara mcp install <p> - Install package");
          console.log("  cybara mcp popular    - Show popular servers");
          console.log("  cybara mcp serve      - Expose cybara tools as an MCP server (stdio)");
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
          console.log("  cybara lsp list             - Show language server status");
          console.log("  cybara lsp install <lang>   - Install language server");
          console.log("  cybara lsp uninstall <lang> - Uninstall language server");
          console.log("");
          console.log(
            "Languages: rust, go, python, cpp (C/C++), java, csharp, ruby, php, lua, zig, kotlin, swift"
          );
          break;
      }
      break;

    case "start":
      launchGateway(args.slice(1));
      break;
    case "dev":
      spawn("bun", ["run", "dev"], { stdio: "inherit" });
      break;

    case "wizard":
    case "setup":
    case "install":
    case "configure":
    case "onboard":
      render(<TUIApp command={command} />);
      break;
    case "tui":
      render(<TUIApp command={args[1]} />);
      break;

    default:
      render(<TUIApp />);
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
