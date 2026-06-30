#!/usr/bin/env bun
import React from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Gradient from "ink-gradient";
import Spinner from "ink-spinner";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { createInterface } from "readline";
import { tmpdir } from "os";
import { getAppVersion, getReleaseRepository } from "./core/build-info";
import { generate as generateQr } from "qrcode-terminal";
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

const API_BASE = process.env.CYBARA_API || "http://localhost:4269";

function resolveCliApiKey(): string | null {
  const envKey = process.env.CYBARA_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    return null;
  }

  try {
    const cybaraHome = process.env.CYBARA_HOME || join(home, ".cybara");
    const keyFromFile = readFileSync(join(cybaraHome, "api_key"), "utf-8").trim();
    return keyFromFile || null;
  } catch {
    return null;
  }
}

const CLI_API_KEY = resolveCliApiKey();

const MOBILE_CONNECT_PROTOCOL = "cybara-mobile-connect-v1";

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

interface StatusResponse {
  status: string;
  uptime: number;
  checks: Record<string, { status: string; total?: number; running?: number }>;
  timestamp: string;
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

function normalizeMobileGatewayUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Gateway URL is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Gateway URL must use http or https");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

async function rawMobileConnect(args: string[]): Promise<void> {
  const baseUrl = normalizeMobileGatewayUrl(getFlagValue(args, "--url") || API_BASE);
  const name = getFlagValue(args, "--name") || process.env.HOSTNAME || "Cybara Gateway";
  const apiKey = getFlagValue(args, "--key") || CLI_API_KEY;
  const showQr = hasFlag(args, "--qr");
  const jsonOnly = hasFlag(args, "--json");

  if (!apiKey) {
    console.error("ERROR: No API key available for mobile pairing.");
    console.error("Set CYBARA_API_KEY or create ~/.cybara/api_key, then rerun this command.");
    process.exit(1);
  }

  const payload = {
    protocol: MOBILE_CONNECT_PROTOCOL,
    name,
    baseUrl,
    apiKey,
    createdAt: new Date().toISOString(),
  };
  const encoded = JSON.stringify(payload);
  const deepLink = `cybara://connect?name=${encodeURIComponent(name)}&baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`;

  if (jsonOnly) {
    console.log(encoded);
    return;
  }

  console.log("CYBARA MOBILE CONNECT");
  console.log("=====================");
  console.log(`name: ${name}`);
  console.log(`gateway: ${baseUrl}`);
  console.log("");
  console.log("Payload:");
  console.log(encoded);
  console.log("");
  console.log("Deep link:");
  console.log(deepLink);

  if (showQr) {
    console.log("");
    generateQr(encoded, { small: true });
  }
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

async function rawStatus(): Promise<void> {
  const data = await fetchAPI<StatusResponse>("/api/health");
  if (!data) {
    console.error("ERROR: Failed to connect to Cybara server at", API_BASE);
    process.exit(1);
  }

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  console.log("CYBARA STATUS");
  console.log("=============");
  console.log(`status: ${data.status}`);
  console.log(`uptime: ${formatUptime(data.uptime)}`);
  console.log(`timestamp: ${data.timestamp}`);
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
  const hasCommand = (command: string): boolean => {
    const exists = Bun.spawnSync(["sh", "-lc", `command -v ${command} >/dev/null 2>&1`]);
    return exists.exitCode === 0;
  };

  if (process.platform === "darwin" && process.arch === "arm64") {
    const hasAppleSandbox = hasCommand("sandbox-exec");
    const hasDocker = hasCommand("docker");
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
    const hasPodman = hasCommand("podman");
    const hasDocker = hasCommand("docker");
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

  if (hasCommand("docker")) {
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
    { method: "POST", body: JSON.stringify({ package: pkg }) }
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

      // Poll for token
      const interval = Math.max(5, dcData.interval || 5) * 1000;
      const expiresAt = Date.now() + (dcData.expires_in || 900) * 1000;
      process.stdout.write("  Waiting for authorization");

      while (Date.now() < expiresAt) {
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
          error?: string;
        };

        if (pollData.status === "success" && pollData.access_token) {
          console.log(" ✓");
          accessToken = pollData.access_token;
          break;
        }
        if (pollData.status === "denied" || pollData.status === "expired") {
          console.log("");
          console.error(`✗ Authorization ${pollData.status}`);
          process.exit(1);
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
        name = args[++i];
        break;
      case "--key":
        key = args[++i];
        break;
      case "--token":
        token = args[++i];
        break;
      case "--default":
        isDefault = true;
        break;
      case "--oauth":
        oauth = true;
        break;
    }
  }

  return { name, key, token, isDefault, oauth };
}

interface SessionInfo {
  id: string;
  agent_id?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

async function rawSessions(): Promise<void> {
  const data = await fetchAPI<SessionInfo[]>("/api/sessions");
  if (!data) {
    console.error("ERROR: Failed to fetch sessions from", API_BASE);
    process.exit(1);
  }

  const sessions = Array.isArray(data) ? data : [];

  console.log("CYBARA SESSIONS");
  console.log("===============");
  console.log(`total: ${sessions.length}`);
  console.log("");

  if (sessions.length === 0) {
    console.log("No active sessions");
    return;
  }

  for (const session of sessions.slice(0, 20)) {
    console.log(`- ${session.id.slice(0, 8)}...`);
    console.log(`  messages: ${session.message_count}`);
    console.log(`  updated: ${session.updated_at}`);
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
  timestamp: string;
  level: string;
  module: string;
  message: string;
}

async function rawLogs(count = 20): Promise<void> {
  const data = await fetchAPI<LogEntry[]>("/api/logs/system");
  if (!data) {
    console.error("ERROR: Failed to fetch logs from", API_BASE);
    process.exit(1);
  }

  const logs = (Array.isArray(data) ? data : []).slice(0, count);

  console.log("CYBARA LOGS");
  console.log("===========");
  console.log(`showing: ${logs.length} entries`);
  console.log("");

  if (logs.length === 0) {
    console.log("No logs available");
    return;
  }

  for (const log of logs) {
    const level = log.level.toUpperCase().padEnd(5);
    const module = log.module.padEnd(12);
    const time = new Date(log.timestamp).toLocaleTimeString();
    console.log(`[${time}] ${level} ${module} ${log.message.slice(0, 60)}`);
  }
}

interface SubagentInfo {
  id: string;
  task: string;
  label: string;
  status: string;
  createdAt: string;
}

async function rawSubagents(): Promise<void> {
  const data = await fetchAPI<SubagentInfo[]>("/api/subagents");
  if (!data) {
    console.error("ERROR: Failed to fetch subagents from", API_BASE);
    process.exit(1);
  }

  const subagents = Array.isArray(data) ? data : [];
  const running = subagents.filter((s) => s.status === "running").length;

  console.log("CYBARA SUBAGENTS");
  console.log("================");
  console.log(`total: ${subagents.length}`);
  console.log(`running: ${running}`);
  console.log("");

  if (subagents.length === 0) {
    console.log("No subagents");
    return;
  }

  for (const sub of subagents) {
    const status = sub.status === "running" ? "⟳" : sub.status === "completed" ? "✓" : "✗";
    console.log(`${status} ${sub.label.slice(0, 50)}`);
    console.log(`  id: ${sub.id}`);
    console.log(`  status: ${sub.status}`);
  }
}

async function rawSubagentSpawn(task: string): Promise<void> {
  if (!task) {
    console.error("ERROR: Please specify a task");
    console.log("Usage: cybara subagent spawn <task>");
    process.exit(1);
  }

  const response = await fetch(`${API_BASE}/api/subagents/spawn`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ task, label: `Task: ${task.slice(0, 30)}...` }),
  });

  const result = (await response.json()) as {
    id?: string;
    subagentId?: string;
    success?: boolean;
    status?: string;
    error?: string;
  };
  const subagentId = result.subagentId || result.id;

  if (subagentId) {
    console.log(`✓ Spawned subagent: ${subagentId}`);
  } else {
    const reason = result.error || result.status || response.statusText || "Unknown error";
    console.error(`✗ Failed to spawn: ${reason}`);
    process.exit(1);
  }
}

async function rawSubagentKill(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a subagent ID");
    console.log("Usage: cybara subagent kill <id>");
    process.exit(1);
  }

  const response = await fetch(`${API_BASE}/api/subagents/${id}/kill`, {
    method: "POST",
    headers: withCliAuthHeaders(),
  });

  const result = (await response.json()) as { success?: boolean; error?: string };

  if (result.success) {
    console.log(`✓ Killed subagent: ${id}`);
  } else {
    console.error(`✗ Failed to kill: ${result.error}`);
    process.exit(1);
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

async function rawChat(sessionArg?: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Pick or create session
  let sessionId = sessionArg;
  if (!sessionId) {
    const sessions =
      await fetchAPI<{ id: string; agentId: string; messageCount: number; createdAt: string }[]>(
        "/api/sessions"
      );
    if (sessions && sessions.length > 0) {
      console.log("\n  SESSIONS");
      console.log("  ========");
      sessions.slice(0, 10).forEach((s, i) => {
        console.log(`  [${i + 1}] ${s.id.slice(0, 8)}... (${s.messageCount} msgs)`);
      });
      console.log(`  [n] New session\n`);

      const answer = await new Promise<string>((r) => rl.question("  Select session: ", r));
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < sessions.length) {
        sessionId = sessions[idx].id;
        // Load session messages
        const msgs = await fetchAPI<{ role: string; content: string }[]>(
          `/api/sessions/${sessionId}/messages`
        );
        if (msgs && msgs.length > 0) {
          console.log("\n  --- Session History ---");
          for (const m of msgs.slice(-6)) {
            if (m.role === "system") continue;
            const prefix = m.role === "user" ? "  You: " : "  AI:  ";
            console.log(
              `${prefix}${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`
            );
          }
          console.log("  ----------------------\n");
        }
      }
    }
  }

  console.log("  Cybara Chat (Ctrl+C to exit)\n");

  const prompt = () => {
    rl.question("  You: ", async (input: string) => {
      if (!input.trim()) {
        prompt();
        return;
      }
      if (input.trim() === "/quit" || input.trim() === "/exit") {
        rl.close();
        process.exit(0);
      }
      if (input.trim() === "/sessions") {
        await rawSessions();
        prompt();
        return;
      }
      if (input.trim().startsWith("/new")) {
        sessionId = undefined;
        console.log("  (New session)\n");
        prompt();
        return;
      }

      try {
        const body: Record<string, unknown> = { message: input.trim() };
        if (sessionId) body.sessionId = sessionId;

        const resp = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          console.error(`  Error: ${resp.status} ${resp.statusText}`);
          prompt();
          return;
        }

        const data = (await resp.json()) as {
          sessionId: string;
          message: { content: string; tool_calls?: { name: string; status: string }[] };
          thinking?: string;
          tool_calls?: { name: string; status: string; result?: unknown }[];
        };

        sessionId = data.sessionId;

        // Show tool calls
        if (data.tool_calls && data.tool_calls.length > 0) {
          for (const tc of data.tool_calls) {
            console.log(`  🔧 ${tc.name} [${tc.status}]`);
          }
        }

        // Show thinking
        if (data.thinking) {
          console.log(`  💭 ${data.thinking.slice(0, 100)}...`);
        }

        // Show response
        console.log(`\n  AI:  ${data.message.content}\n`);
      } catch (err) {
        console.error(`  Error: ${(err as Error).message}`);
      }

      prompt();
    });
  };

  prompt();
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
    const resp = await fetch(`${API_BASE}/api/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ [key]: value }),
    });
    if (resp.ok) {
      console.log(`✓ Set ${key} = ${value}`);
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
      const state = !route.enabled ? "DISABLED" : route.available ? "available" : `BLOCKED (${route.reason})`;
      console.log(`  ${route.providerId}`);
      console.log(`    Weight:    ${route.weight}`);
      console.log(`    State:     ${state}`);
      console.log(`    5h reqs:   ${route.requestsIn5hWindow}`);
      console.log(`    Week reqs: ${route.requestsInWeekWindow}`);
      console.log(`    Today:     $${route.spendToday.toFixed(4)}`);
      console.log(`    Week:      $${route.spendThisWeek.toFixed(4)}`);
      if (route.priceInputPerM || route.priceOutputPerM) {
        console.log(`    Price:     $${route.priceInputPerM ?? 0}/M in, $${route.priceOutputPerM ?? 0}/M out`);
      }
      console.log("");
    }
    return;
  }

  if (subCmd === "enable") {
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled: true, strategy: "weighted", fallbackToAny: true, routes: {} }),
    });
    console.log(resp.ok ? "✓ Router enabled" : `ERROR: ${resp.status}`);
    return;
  }

  if (subCmd === "disable") {
    const resp = await fetch(`${API_BASE}/api/router/config`, {
      method: "PUT",
      headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled: false, strategy: "weighted", fallbackToAny: true, routes: {} }),
    });
    console.log(resp.ok ? "✓ Router disabled" : `ERROR: ${resp.status}`);
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
    const current = currentResp ?? { enabled: true, strategy: "weighted", fallbackToAny: true, routes: {} };
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
  console.log("  cybara router set <id> <flags>    Configure a route");
  console.log("    Flags: weight=70 limit5h=100 limitWeekly=500 spendDaily=5 spendWeekly=20");
  console.log("           priceIn=10 priceOut=30 enabled=true");
}

interface CliWalletStatus {
  exists: boolean;
  unlocked: boolean;
  address?: string;
  unlockExpiresAt?: string;
  agentAccessEnabled: boolean;
  chains: string[];
  primaryAddresses?: Record<string, string>;
}

interface CliWalletAccount {
  chain: string;
  index: number;
  path: string;
  address: string;
}

interface CliWalletBalance extends CliWalletAccount {
  symbol: string;
  amount: string;
}

interface CliWalletTokenBalance {
  chain: "eth" | "sol";
  index: number;
  address: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals: number;
  amount: string;
  raw: string;
  tokenAccount?: string;
}

interface CliWalletTransaction {
  txid: string;
  status: string;
  amount?: string;
  fee?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  explorerUrl: string;
}

interface CliWalletRpc {
  ethRpc: string;
  solRpc: string;
  btcApi: string;
}

interface CliWalletRpcServiceStatus {
  chain: "eth" | "btc" | "sol";
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  latestHeight?: string;
  error?: string;
}

interface CliWalletRpcStatus {
  checkedAt: string;
  services: CliWalletRpcServiceStatus[];
}

interface CliWalletTokenTransaction {
  chain: "eth" | "sol";
  index: number;
  address: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals: number;
  txid: string;
  status: "confirmed" | "pending" | "failed";
  direction: "in" | "out" | "self" | "unknown";
  from?: string;
  to?: string;
  amount: string;
  raw: string;
  fee?: string;
  timestamp?: string;
  explorerUrl: string;
}

interface CliWalletAgentPolicy {
  allowNativeSend: boolean;
  allowTokenSend: boolean;
  allowEthContractWrite: boolean;
  allowSolProgramInstruction: boolean;
  allowEthSwaps: boolean;
  allowDappInteraction: boolean;
  allowX402Payments: boolean;
  allowedEthContracts: string[];
  allowedSolPrograms: string[];
  allowedDappHosts: string[];
  allowedX402Networks: string[];
  x402MaxAmountAtomic: string;
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function formatWalletTimestamp(value?: string): string {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

async function walletRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: withCliAuthHeaders(undefined, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: string }).error || response.statusText)
        : response.statusText;
    throw new Error(errorMessage);
  }

  return payload as T;
}

async function rawWalletStatus(): Promise<void> {
  const [status, rpc, policy] = await Promise.all([
    walletRequest<CliWalletStatus>("GET", "/api/wallet/status"),
    walletRequest<CliWalletRpc>("GET", "/api/wallet/rpc"),
    walletRequest<CliWalletAgentPolicy>("GET", "/api/wallet/agent-policy"),
  ]);

  console.log("CYBARA WALLET");
  console.log("=============");
  console.log(`exists: ${status.exists ? "yes" : "no"}`);
  console.log(`unlocked: ${status.unlocked ? "yes" : "no"}`);
  console.log(`agent_access: ${status.agentAccessEnabled ? "enabled" : "disabled"}`);
  console.log(`agent_native_send: ${policy.allowNativeSend ? "enabled" : "disabled"}`);
  console.log(`agent_token_send: ${policy.allowTokenSend ? "enabled" : "disabled"}`);
  console.log(`agent_eth_swaps: ${policy.allowEthSwaps ? "enabled" : "disabled"}`);
  console.log(`agent_dapp: ${policy.allowDappInteraction ? "enabled" : "disabled"}`);
  console.log(`agent_x402: ${policy.allowX402Payments ? "enabled" : "disabled"}`);
  console.log(`unlock_expires: ${formatWalletTimestamp(status.unlockExpiresAt)}`);
  if (status.address) {
    console.log(`primary_eth: ${status.address}`);
  }

  const addresses = status.primaryAddresses || {};
  if (Object.keys(addresses).length > 0) {
    console.log("");
    console.log("PRIMARY ADDRESSES");
    for (const [chain, address] of Object.entries(addresses)) {
      console.log(`  ${chain}: ${address}`);
    }
  }

  console.log("");
  console.log("RPC ENDPOINTS");
  console.log(`  eth: ${rpc.ethRpc}`);
  console.log(`  sol: ${rpc.solRpc}`);
  console.log(`  btc: ${rpc.btcApi}`);
}

async function rawWalletCreate(password?: string): Promise<void> {
  if (!password) {
    console.error("Usage: cybara wallet create --password <password>");
    process.exit(1);
  }

  const data = await walletRequest<{
    address: string;
    mnemonic: string;
    primaryAddresses: Record<string, string>;
  }>("POST", "/api/wallet/create", { password });

  console.log("Wallet created and unlocked");
  console.log(`eth address: ${data.address}`);
  console.log("seed phrase:");
  console.log(data.mnemonic);
  console.log("");
  console.log("Store this seed phrase offline. It is not recoverable from your password.");
}

async function rawWalletImport(password?: string, mnemonic?: string): Promise<void> {
  if (!password || !mnemonic) {
    console.error('Usage: cybara wallet import --password <password> --mnemonic "<24 words>"');
    process.exit(1);
  }

  const data = await walletRequest<{ address: string }>("POST", "/api/wallet/import", {
    password,
    mnemonic,
  });
  console.log("Wallet imported and unlocked");
  console.log(`eth address: ${data.address}`);
}

async function rawWalletUnlock(password?: string): Promise<void> {
  if (!password) {
    console.error("Usage: cybara wallet unlock --password <password>");
    process.exit(1);
  }

  const data = await walletRequest<{ address: string; unlockExpiresAt: string }>(
    "POST",
    "/api/wallet/unlock",
    { password }
  );
  console.log("Wallet unlocked");
  console.log(`eth address: ${data.address}`);
  console.log(`expires: ${formatWalletTimestamp(data.unlockExpiresAt)}`);
}

async function rawWalletLock(): Promise<void> {
  await walletRequest<{ success: boolean }>("POST", "/api/wallet/lock");
  console.log("Wallet locked");
}

async function rawWalletAccounts(
  chains: string | undefined,
  count: string | undefined,
  start: string | undefined
): Promise<void> {
  const params = new URLSearchParams();
  if (chains) params.set("chains", chains);
  if (count) params.set("count", count);
  if (start) params.set("startIndex", start);

  const path = `/api/wallet/accounts${params.size ? `?${params.toString()}` : ""}`;
  const data = await walletRequest<CliWalletAccount[]>("GET", path);

  console.log("WALLET ACCOUNTS");
  console.log("===============");
  if (!data.length) {
    console.log("No accounts derived");
    return;
  }

  for (const account of data) {
    console.log(`- ${account.chain.toUpperCase()} index ${account.index}`);
    console.log(`  address: ${account.address}`);
    console.log(`  path: ${account.path}`);
  }
}

async function rawWalletBalances(
  chains: string | undefined,
  count: string | undefined,
  start: string | undefined
): Promise<void> {
  const params = new URLSearchParams();
  if (chains) params.set("chains", chains);
  if (count) params.set("count", count);
  if (start) params.set("startIndex", start);

  const path = `/api/wallet/balances${params.size ? `?${params.toString()}` : ""}`;
  const data = await walletRequest<CliWalletBalance[]>("GET", path);

  console.log("WALLET BALANCES");
  console.log("===============");
  if (!data.length) {
    console.log("No balances returned");
    return;
  }

  for (const balance of data) {
    console.log(`- ${balance.chain.toUpperCase()} index ${balance.index}`);
    console.log(`  address: ${balance.address}`);
    console.log(`  balance: ${balance.amount} ${balance.symbol}`);
  }
}

async function rawWalletTokenBalances(
  chain: string,
  index?: string,
  includeZero = false
): Promise<void> {
  if (chain !== "eth" && chain !== "sol") {
    console.error("Usage: cybara wallet tokens <eth|sol> [--index N] [--include-zero]");
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);
  if (includeZero) params.set("includeZero", "true");

  const data = await walletRequest<CliWalletTokenBalance[]>(
    "GET",
    `/api/wallet/tokens?${params.toString()}`
  );

  console.log(`WALLET TOKENS (${chain.toUpperCase()})`);
  console.log("========================");
  if (!data.length) {
    console.log("No token balances found");
    return;
  }

  for (const token of data) {
    console.log(`- ${token.symbol}${token.name ? ` (${token.name})` : ""}`);
    console.log(`  owner: ${token.address}`);
    console.log(`  token: ${token.tokenAddress}`);
    if (token.tokenAccount) console.log(`  account: ${token.tokenAccount}`);
    console.log(`  amount: ${token.amount}`);
  }
}

async function rawWalletTransactions(chain: string, index?: string, limit?: string): Promise<void> {
  if (!chain) {
    console.error("Usage: cybara wallet tx <eth|btc|sol> [--index N] [--limit N]");
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);
  if (limit) params.set("limit", limit);

  const data = await walletRequest<CliWalletTransaction[]>(
    "GET",
    `/api/wallet/transactions?${params.toString()}`
  );

  console.log(`WALLET TRANSACTIONS (${chain.toUpperCase()})`);
  console.log("================================");
  if (!data.length) {
    console.log("No transactions found");
    return;
  }

  for (const tx of data) {
    console.log(`- ${tx.txid}`);
    console.log(`  status: ${tx.status}`);
    if (tx.amount) console.log(`  amount: ${tx.amount}`);
    if (tx.fee) console.log(`  fee: ${tx.fee}`);
    if (tx.from) console.log(`  from: ${tx.from}`);
    if (tx.to) console.log(`  to: ${tx.to}`);
    if (tx.timestamp) console.log(`  timestamp: ${tx.timestamp}`);
    console.log(`  explorer: ${tx.explorerUrl}`);
  }
}

async function rawWalletTokenTransactions(
  chain: string,
  index?: string,
  limit?: string,
  tokenAddress?: string,
  rpcUrl?: string
): Promise<void> {
  if (chain !== "eth" && chain !== "sol") {
    console.error(
      "Usage: cybara wallet token-tx <eth|sol> [--index N] [--limit N] [--token ADDRESS] [--rpc URL]"
    );
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);
  if (limit) params.set("limit", limit);
  if (tokenAddress) params.set("tokenAddress", tokenAddress);
  if (rpcUrl) params.set("rpcUrl", rpcUrl);

  const data = await walletRequest<CliWalletTokenTransaction[]>(
    "GET",
    `/api/wallet/token-transactions?${params.toString()}`
  );

  console.log(`WALLET TOKEN TRANSACTIONS (${chain.toUpperCase()})`);
  console.log("===================================");
  if (!data.length) {
    console.log("No token transactions found");
    return;
  }

  for (const tx of data) {
    console.log(`- ${tx.txid}`);
    console.log(`  token: ${tx.symbol} (${tx.tokenAddress})`);
    console.log(`  direction: ${tx.direction}`);
    console.log(`  amount: ${tx.amount}`);
    console.log(`  status: ${tx.status}`);
    if (tx.fee) console.log(`  fee: ${tx.fee}`);
    if (tx.timestamp) console.log(`  timestamp: ${tx.timestamp}`);
    console.log(`  explorer: ${tx.explorerUrl}`);
  }
}

async function rawWalletReceive(chain: string, index?: string): Promise<void> {
  if (!chain) {
    console.error("Usage: cybara wallet receive <eth|btc|sol> [--index N]");
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);

  const data = await walletRequest<CliWalletAccount>(
    "GET",
    `/api/wallet/receive?${params.toString()}`
  );
  console.log("WALLET RECEIVE ADDRESS");
  console.log("======================");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`index: ${data.index}`);
  console.log(`address: ${data.address}`);
  console.log(`path: ${data.path}`);
}

async function rawWalletSend(args: string[]): Promise<void> {
  const chain = args[0];
  const to = getFlagValue(args, "--to");
  const amount = getFlagValue(args, "--amount");
  const index = getFlagValue(args, "--index");
  const memo = getFlagValue(args, "--memo");
  const feeRate = getFlagValue(args, "--fee-rate");

  if (!chain || !to || !amount) {
    console.error(
      "Usage: cybara wallet send <eth|btc|sol> --to <address> --amount <value> [--index N] [--memo TEXT] [--fee-rate SAT_PER_VB]"
    );
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    chain,
    to,
    amount,
  };
  if (index) payload.index = Number(index);
  if (memo) payload.memo = memo;
  if (feeRate) payload.feeRate = Number(feeRate);

  const data = await walletRequest<{ chain: string; txid: string; explorerUrl: string }>(
    "POST",
    "/api/wallet/send",
    payload
  );

  console.log("Transaction submitted");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`txid: ${data.txid}`);
  console.log(`explorer: ${data.explorerUrl}`);
}

async function rawWalletSendToken(args: string[]): Promise<void> {
  const chain = args[0];
  const to = getFlagValue(args, "--to");
  const amount = getFlagValue(args, "--amount");
  const tokenAddress = getFlagValue(args, "--token") || getFlagValue(args, "--mint");
  const index = getFlagValue(args, "--index");
  const decimals = getFlagValue(args, "--decimals");
  const rpcUrl = getFlagValue(args, "--rpc");
  const memo = getFlagValue(args, "--memo");

  if ((chain !== "eth" && chain !== "sol") || !tokenAddress || !to || !amount) {
    console.error(
      "Usage: cybara wallet send-token <eth|sol> --token <address|mint> --to <address> --amount <value> [--index N] [--decimals N] [--rpc URL] [--memo TEXT]"
    );
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    chain,
    tokenAddress,
    to,
    amount,
  };
  if (index) payload.index = Number(index);
  if (decimals) payload.decimals = Number(decimals);
  if (rpcUrl) payload.rpcUrl = rpcUrl;
  if (memo) payload.memo = memo;

  const data = await walletRequest<{
    chain: string;
    txid: string;
    explorerUrl: string;
    tokenAddress: string;
  }>("POST", "/api/wallet/send-token", payload);

  console.log("Token transaction submitted");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`token: ${data.tokenAddress}`);
  console.log(`txid: ${data.txid}`);
  console.log(`explorer: ${data.explorerUrl}`);
}

async function rawWalletEthContractCall(args: string[]): Promise<void> {
  const contractAddress = getFlagValue(args, "--contract");
  const abi = getFlagValue(args, "--abi");
  const method = getFlagValue(args, "--method");
  const methodSignature =
    getFlagValue(args, "--signature") || getFlagValue(args, "--method-signature");
  const argsJson = getFlagValue(args, "--args");
  const value = getFlagValue(args, "--value");
  const gasLimit = getFlagValue(args, "--gas-limit");
  const gasPriceGwei = getFlagValue(args, "--gas-price-gwei");
  const maxFeePerGasGwei = getFlagValue(args, "--max-fee-gwei");
  const maxPriorityFeePerGasGwei = getFlagValue(args, "--priority-fee-gwei");
  const nonce = getFlagValue(args, "--nonce");
  const index = getFlagValue(args, "--index");
  const rpcUrl = getFlagValue(args, "--rpc");
  const readOnly = args.includes("--read");

  if (!contractAddress || (!method && !methodSignature) || (!abi && !methodSignature)) {
    console.error(
      "Usage: cybara wallet contract-call --contract <address> (--abi '<json_or_signature>' | --signature '<name(types)>') [--method <name>] [--args '[...]'] [--value ETH] [--gas-limit N] [--gas-price-gwei N] [--max-fee-gwei N] [--priority-fee-gwei N] [--nonce N] [--index N] [--rpc URL] [--read]"
    );
    process.exit(1);
  }

  let parsedArgs: unknown[] = [];
  if (argsJson) {
    try {
      const parsed = JSON.parse(argsJson);
      if (!Array.isArray(parsed)) {
        throw new Error("args must be a JSON array");
      }
      parsedArgs = parsed;
    } catch (error) {
      console.error(`Invalid --args JSON: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  const payload: Record<string, unknown> = {
    contractAddress,
    method: method || methodSignature,
    args: parsedArgs,
    readOnly,
  };
  if (abi) payload.abi = abi;
  if (methodSignature) payload.methodSignature = methodSignature;
  if (value) payload.value = value;
  if (gasLimit) payload.gasLimit = gasLimit;
  if (gasPriceGwei) payload.gasPriceGwei = gasPriceGwei;
  if (maxFeePerGasGwei) payload.maxFeePerGasGwei = maxFeePerGasGwei;
  if (maxPriorityFeePerGasGwei) payload.maxPriorityFeePerGasGwei = maxPriorityFeePerGasGwei;
  if (nonce) payload.nonce = Number(nonce);
  if (index) payload.index = Number(index);
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<Record<string, unknown>>(
    "POST",
    "/api/wallet/eth-contract",
    payload
  );
  console.log("ETH contract call result");
  console.log(JSON.stringify(data, null, 2));
}

async function rawWalletSolInstruction(args: string[]): Promise<void> {
  const programId = getFlagValue(args, "--program");
  const keysJson = getFlagValue(args, "--keys") || getFlagValue(args, "--accounts");
  const dataBase64 = getFlagValue(args, "--data-base64");
  const dataHex = getFlagValue(args, "--data-hex");
  const dataUtf8 = getFlagValue(args, "--data-utf8");
  const computeUnits = getFlagValue(args, "--compute-units");
  const computePriceMicroLamports = getFlagValue(args, "--compute-price-microlamports");
  const index = getFlagValue(args, "--index");
  const rpcUrl = getFlagValue(args, "--rpc");
  const skipPreflight = args.includes("--skip-preflight");

  if (!programId || !keysJson) {
    console.error(
      "Usage: cybara wallet sol-instruction --program <programId> (--keys '[...]' | --accounts '[...]') [--data-base64 DATA | --data-hex HEX | --data-utf8 TEXT] [--compute-units N] [--compute-price-microlamports N] [--skip-preflight] [--index N] [--rpc URL]"
    );
    process.exit(1);
  }

  const dataEncodings = [dataBase64, dataHex, dataUtf8].filter((value) => Boolean(value));
  if (dataEncodings.length > 1) {
    console.error(
      "Use only one instruction data encoding: --data-base64, --data-hex, or --data-utf8"
    );
    process.exit(1);
  }

  let keys: unknown[] = [];
  try {
    const parsed = JSON.parse(keysJson);
    if (!Array.isArray(parsed)) {
      throw new Error("keys must be a JSON array");
    }
    keys = parsed;
  } catch (error) {
    console.error(`Invalid --keys JSON: ${(error as Error).message}`);
    process.exit(1);
  }

  const payload: Record<string, unknown> = { programId, keys };
  if (dataBase64) payload.dataBase64 = dataBase64;
  if (dataHex) payload.dataHex = dataHex;
  if (dataUtf8) payload.dataUtf8 = dataUtf8;
  if (computeUnits) payload.computeUnitLimit = Number(computeUnits);
  if (computePriceMicroLamports)
    payload.computeUnitPriceMicroLamports = Number(computePriceMicroLamports);
  if (skipPreflight) payload.skipPreflight = true;
  if (index) payload.index = Number(index);
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<{ chain: string; txid: string; explorerUrl: string }>(
    "POST",
    "/api/wallet/sol-instruction",
    payload
  );

  console.log("Solana instruction submitted");
  console.log(`txid: ${data.txid}`);
  console.log(`explorer: ${data.explorerUrl}`);
}

async function rawWalletSwapEthUniswap(args: string[]): Promise<void> {
  const tokenOut = getFlagValue(args, "--token") || getFlagValue(args, "--token-out");
  const percent = getFlagValue(args, "--percent");
  const amountEth = getFlagValue(args, "--amount-eth");
  const minAmountOut = getFlagValue(args, "--min-out");
  const slippageBps = getFlagValue(args, "--slippage-bps");
  const deadlineSeconds = getFlagValue(args, "--deadline");
  const index = getFlagValue(args, "--index");
  const recipient = getFlagValue(args, "--recipient");
  const rpcUrl = getFlagValue(args, "--rpc");
  const execute = args.includes("--execute");

  if (!tokenOut || (!percent && !amountEth)) {
    console.error(
      "Usage: cybara wallet swap-eth-uniswap --token <symbol|address> (--percent N | --amount-eth ETH) [--slippage-bps N] [--deadline SEC] [--index N] [--recipient ADDRESS] [--rpc URL] [--execute]"
    );
    process.exit(1);
  }

  if (percent && amountEth) {
    console.error("Use either --percent or --amount-eth, not both");
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    tokenOut,
    dryRun: !execute,
  };
  if (percent) payload.percent = Number(percent);
  if (amountEth) payload.amountEth = amountEth;
  if (minAmountOut) payload.minAmountOut = minAmountOut;
  if (slippageBps) payload.slippageBps = Number(slippageBps);
  if (deadlineSeconds) payload.deadlineSeconds = Number(deadlineSeconds);
  if (index) payload.index = Number(index);
  if (recipient) payload.recipient = recipient;
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<{
    amountInEth: string;
    toTokenSymbol: string;
    quotedAmountOut: string;
    minAmountOut: string;
    txid?: string;
    explorerUrl?: string;
    dryRun: boolean;
  }>("POST", "/api/wallet/swap-eth-uniswap", payload);

  console.log("UNISWAP ETH SWAP");
  console.log("================");
  console.log(`mode: ${data.dryRun ? "quote-only" : "execute"}`);
  console.log(`input_eth: ${data.amountInEth}`);
  console.log(`token_out: ${data.toTokenSymbol}`);
  console.log(`quote_out: ${data.quotedAmountOut}`);
  console.log(`min_out: ${data.minAmountOut}`);
  if (data.txid) console.log(`txid: ${data.txid}`);
  if (data.explorerUrl) console.log(`explorer: ${data.explorerUrl}`);
}

async function rawWalletPrice(args: string[]): Promise<void> {
  const source = getFlagValue(args, "--source");
  let symbol = getFlagValue(args, "--symbol");
  let pair = getFlagValue(args, "--pair");
  const feedAddress = getFlagValue(args, "--feed-address");
  const feedId = getFlagValue(args, "--feed-id") || getFlagValue(args, "--pyth-feed-id");
  let mint = getFlagValue(args, "--mint");
  const quoteCurrency = getFlagValue(args, "--quote");
  const rpcUrl = getFlagValue(args, "--rpc");
  const positional = args[0] && !args[0].startsWith("--") ? args[0] : undefined;

  if (!symbol && !pair && !mint && positional) {
    if (positional.includes("/")) {
      pair = positional;
    } else if (positional.length >= 32) {
      mint = positional;
    } else {
      symbol = positional;
    }
  }

  if (!symbol && !pair && !mint) {
    console.error(
      "Usage: cybara wallet price [BTC|BTC/USD|<SOL_MINT>] [--source auto|chainlink|pyth|jupiter] [--symbol SYMBOL | --pair BASE/QUOTE | --mint SOL_MINT] [--feed-address ADDR] [--feed-id ID] [--quote USD] [--rpc URL]"
    );
    process.exit(1);
  }

  const payload: Record<string, unknown> = {};
  if (source) payload.source = source;
  if (symbol) payload.symbol = symbol;
  if (pair) payload.pair = pair;
  if (feedAddress) payload.feedAddress = feedAddress;
  if (feedId) payload.feedId = feedId;
  if (mint) payload.mint = mint;
  if (quoteCurrency) payload.quoteCurrency = quoteCurrency;
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<{
    source: string;
    base: string;
    quote: string;
    price: string;
    confidence?: string;
    publishTime?: string;
    feedAddress?: string;
    feedId?: string;
    mint?: string;
  }>("POST", "/api/wallet/price", payload);

  console.log("PRICE QUOTE");
  console.log("===========");
  console.log(`source: ${data.source}`);
  console.log(`pair: ${data.base}/${data.quote}`);
  console.log(`price: ${data.price}`);
  if (data.confidence) console.log(`confidence: ${data.confidence}`);
  if (data.publishTime) console.log(`publish_time: ${data.publishTime}`);
  if (data.feedAddress) console.log(`feed_address: ${data.feedAddress}`);
  if (data.feedId) console.log(`feed_id: ${data.feedId}`);
  if (data.mint) console.log(`mint: ${data.mint}`);
}

async function rawWalletEndpoints(): Promise<void> {
  const data = await walletRequest<{
    ethereum: {
      wrappedNative: string;
      dex: Record<string, string>;
      oracles: {
        chainlinkFeedRegistry: string;
        usdDenomination: string;
        chainlinkUsdFeeds: Record<string, string>;
      };
    };
    solana: {
      nativeMint: string;
      commonMints: Record<string, string>;
      programs: Record<string, string>;
    };
    services: Record<string, string>;
  }>("GET", "/api/wallet/endpoints");

  console.log("WALLET ENDPOINT DIRECTORY");
  console.log("=========================");
  console.log("Ethereum:");
  console.log(`  wrapped_native: ${data.ethereum.wrappedNative}`);
  for (const [key, value] of Object.entries(data.ethereum.dex || {})) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`  chainlink_feed_registry: ${data.ethereum.oracles.chainlinkFeedRegistry}`);
  console.log(`  chainlink_usd_denomination: ${data.ethereum.oracles.usdDenomination}`);
  for (const [symbol, address] of Object.entries(data.ethereum.oracles.chainlinkUsdFeeds || {})) {
    console.log(`  chainlink_${symbol.toLowerCase()}_usd: ${address}`);
  }
  console.log("Solana:");
  console.log(`  native_mint: ${data.solana.nativeMint}`);
  for (const [symbol, mint] of Object.entries(data.solana.commonMints || {})) {
    console.log(`  mint_${symbol.toLowerCase()}: ${mint}`);
  }
  for (const [key, value] of Object.entries(data.solana.programs || {})) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("Services:");
  for (const [key, value] of Object.entries(data.services || {})) {
    console.log(`  ${key}: ${value}`);
  }
}

async function rawWalletDapps(): Promise<void> {
  const data = await walletRequest<{
    adapters: Array<{ adapter: string; chain: string; write: boolean; description: string }>;
    notes: string[];
  }>("GET", "/api/wallet/dapps");

  console.log("WALLET DAPP ADAPTERS");
  console.log("====================");
  for (const adapter of data.adapters || []) {
    console.log(`- ${adapter.adapter}`);
    console.log(`  chain: ${adapter.chain}`);
    console.log(`  write: ${adapter.write ? "yes" : "no"}`);
    console.log(`  ${adapter.description}`);
  }
  if (Array.isArray(data.notes) && data.notes.length > 0) {
    console.log("");
    console.log("notes:");
    for (const note of data.notes) {
      console.log(`- ${note}`);
    }
  }
}

async function rawWalletRpcCall(args: string[]): Promise<void> {
  const chain = args[0];
  const methodFlag = getFlagValue(args, "--method");
  const positionalMethod = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const method = methodFlag || positionalMethod;
  const paramsJson = getFlagValue(args, "--params");
  const rpcUrl = getFlagValue(args, "--rpc");
  const id = getFlagValue(args, "--id");

  if ((chain !== "eth" && chain !== "sol") || !method) {
    console.error(
      "Usage: cybara wallet rpc-call <eth|sol> --method <rpc_method> [--params '[...]'] [--rpc URL] [--id VALUE]"
    );
    process.exit(1);
  }

  let params: unknown[] = [];
  if (paramsJson) {
    try {
      const parsed = JSON.parse(paramsJson);
      if (!Array.isArray(parsed)) {
        throw new Error("params must be a JSON array");
      }
      params = parsed;
    } catch (error) {
      console.error(`Invalid --params JSON: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  const payload: Record<string, unknown> = {
    chain,
    method,
    params,
  };
  if (rpcUrl) payload.rpcUrl = rpcUrl;
  if (id) payload.id = /^\d+$/.test(id) ? Number(id) : id;

  const data = await walletRequest<{
    chain: string;
    rpcUrl: string;
    method: string;
    id?: string | number;
    result?: unknown;
    error?: unknown;
  }>("POST", "/api/wallet/rpc-call", payload);

  console.log("RPC CALL RESULT");
  console.log("===============");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`rpc: ${data.rpcUrl}`);
  console.log(`method: ${data.method}`);
  if (data.id !== undefined) console.log(`id: ${data.id}`);
  if (data.error !== undefined) {
    console.log("error:");
    console.log(JSON.stringify(data.error, null, 2));
  } else {
    console.log("result:");
    console.log(JSON.stringify(data.result, null, 2));
  }
}

async function rawWalletDapp(args: string[]): Promise<void> {
  const adapter = getFlagValue(args, "--adapter");
  const jsonPayload = getFlagValue(args, "--json") || getFlagValue(args, "--payload");
  if (!adapter || !jsonPayload) {
    console.error("Usage: cybara wallet dapp --adapter <adapter> --json '<payload_json>'");
    process.exit(1);
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(jsonPayload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be a JSON object");
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    console.error(`Invalid --json payload: ${(error as Error).message}`);
    process.exit(1);
  }

  const data = await walletRequest<unknown>("POST", "/api/wallet/dapp", {
    adapter,
    payload,
  });

  console.log("DAPP RESULT");
  console.log("===========");
  console.log(JSON.stringify(data, null, 2));
}

async function rawWalletX402(args: string[]): Promise<void> {
  const url = getFlagValue(args, "--url");
  const method = getFlagValue(args, "--method");
  const headersJson = getFlagValue(args, "--headers");
  const bodyJson = getFlagValue(args, "--body-json");
  const bodyRaw = getFlagValue(args, "--body");
  const network = getFlagValue(args, "--network");
  const maxAmountAtomic = getFlagValue(args, "--max-amount-atomic");
  const index = getFlagValue(args, "--index");
  const timeoutMs = getFlagValue(args, "--timeout-ms");
  const dryRun = args.includes("--dry-run");

  if (!url) {
    console.error(
      "Usage: cybara wallet x402 --url <https_url> [--method GET|POST] [--headers '{...}'] [--body-json '{...}' | --body TEXT] [--network eip155:8453] [--max-amount-atomic N] [--index N] [--timeout-ms N] [--dry-run]"
    );
    process.exit(1);
  }
  if (bodyJson && bodyRaw) {
    console.error("Use only one of --body-json or --body");
    process.exit(1);
  }

  let headers: Record<string, string> | undefined;
  if (headersJson) {
    try {
      const parsed = JSON.parse(headersJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("headers must be a JSON object");
      }
      headers = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value),
        ])
      );
    } catch (error) {
      console.error(`Invalid --headers JSON: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  let body: unknown = undefined;
  if (bodyJson) {
    try {
      body = JSON.parse(bodyJson);
    } catch (error) {
      console.error(`Invalid --body-json payload: ${(error as Error).message}`);
      process.exit(1);
    }
  } else if (bodyRaw !== undefined) {
    body = bodyRaw;
  }

  const payload: Record<string, unknown> = { url };
  if (method) payload.method = method;
  if (headers) payload.headers = headers;
  if (body !== undefined) payload.body = body;
  if (network) payload.network = network;
  if (maxAmountAtomic) payload.maxAmountAtomic = maxAmountAtomic;
  if (index) payload.index = Number(index);
  if (timeoutMs) payload.timeoutMs = Number(timeoutMs);
  if (dryRun) payload.dryRun = true;

  const data = await walletRequest<{
    url: string;
    method: string;
    status: number;
    paid: boolean;
    attemptedPayment: boolean;
    paymentHeaderUsed?: string;
    paymentRequirement?: {
      x402Version: number;
      scheme: string;
      network: string;
      amount: string;
      asset: string;
      payTo: string;
      maxTimeoutSeconds: number;
    };
    settlement?: {
      success?: boolean;
      errorReason?: string;
      transaction?: string;
      network?: string;
      payer?: string;
    };
    body?: unknown;
  }>("POST", "/api/wallet/x402", payload);

  console.log("X402 RESULT");
  console.log("===========");
  console.log(`url: ${data.url}`);
  console.log(`method: ${data.method}`);
  console.log(`status: ${data.status}`);
  console.log(`attempted_payment: ${data.attemptedPayment ? "yes" : "no"}`);
  console.log(`paid: ${data.paid ? "yes" : "no"}`);
  if (data.paymentHeaderUsed) console.log(`payment_header: ${data.paymentHeaderUsed}`);
  if (data.paymentRequirement) {
    console.log("payment_requirement:");
    console.log(
      `  x402v${data.paymentRequirement.x402Version} ${data.paymentRequirement.scheme} ${data.paymentRequirement.network}`
    );
    console.log(`  amount: ${data.paymentRequirement.amount}`);
    console.log(`  asset: ${data.paymentRequirement.asset}`);
    console.log(`  payTo: ${data.paymentRequirement.payTo}`);
  }
  if (data.settlement) {
    console.log("settlement:");
    console.log(`  success: ${data.settlement.success === true ? "yes" : "no"}`);
    if (data.settlement.errorReason) console.log(`  error: ${data.settlement.errorReason}`);
    if (data.settlement.transaction) console.log(`  tx: ${data.settlement.transaction}`);
    if (data.settlement.network) console.log(`  network: ${data.settlement.network}`);
    if (data.settlement.payer) console.log(`  payer: ${data.settlement.payer}`);
  }
  if (data.body !== undefined) {
    console.log("body:");
    console.log(typeof data.body === "string" ? data.body : JSON.stringify(data.body, null, 2));
  }
}

function normalizeWalletSwapVenue(
  value: string | undefined
): "uniswap_v2" | "uniswap_v3" | "jupiter" | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "uniswap_v2" || normalized === "uniswap-v2" || normalized === "v2")
    return "uniswap_v2";
  if (
    normalized === "uniswap_v3" ||
    normalized === "uniswap-v3" ||
    normalized === "uniswap" ||
    normalized === "uni" ||
    normalized === "v3"
  )
    return "uniswap_v3";
  if (normalized === "jupiter" || normalized === "jup") return "jupiter";
  return null;
}

async function rawWalletSwap(args: string[], executeOverride?: boolean): Promise<void> {
  const venueFlag = getFlagValue(args, "--venue");
  const normalizedVenue = normalizeWalletSwapVenue(venueFlag);
  const amountEth = getFlagValue(args, "--amount-eth");
  const percent = getFlagValue(args, "--percent");
  const minAmountOut = getFlagValue(args, "--min-out");
  const slippageBps = getFlagValue(args, "--slippage-bps");
  const deadlineSeconds = getFlagValue(args, "--deadline");
  const recipient = getFlagValue(args, "--recipient");
  const feeTier = getFlagValue(args, "--fee-tier");
  const inputMint = getFlagValue(args, "--input-mint");
  const outputMint = getFlagValue(args, "--output-mint");
  const amount = getFlagValue(args, "--amount");
  const amountRaw = getFlagValue(args, "--amount-raw");
  const index = getFlagValue(args, "--index");
  const rpcUrl = getFlagValue(args, "--rpc");
  const wrapUnwrapSol = getFlagValue(args, "--wrap-sol");
  const computePrice = getFlagValue(args, "--compute-price-microlamports");
  const skipPreflight = args.includes("--skip-preflight");
  const explicitExecuteFlag = args.includes("--execute");
  const quoteOnlyFlag = args.includes("--quote-only") || args.includes("--dry-run");
  const positional = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const tokenOutFlag = getFlagValue(args, "--token") || getFlagValue(args, "--token-out");
  const tokenOut =
    tokenOutFlag || (positional && !inputMint && !outputMint ? positional : undefined);

  if (venueFlag && !normalizedVenue) {
    console.error(
      "Usage: cybara wallet swap [--venue <uniswap_v2|uniswap_v3|jupiter>] [--execute] [venue-specific flags]"
    );
    process.exit(1);
  }

  if (explicitExecuteFlag && quoteOnlyFlag && executeOverride === undefined) {
    console.error("Use either --execute or --quote-only/--dry-run, not both");
    process.exit(1);
  }

  const selectedVenue = normalizedVenue || (inputMint || outputMint ? "jupiter" : "uniswap_v3");
  let shouldExecute = executeOverride ?? explicitExecuteFlag;
  if (quoteOnlyFlag) {
    shouldExecute = false;
  }

  if ((selectedVenue === "uniswap_v2" || selectedVenue === "uniswap_v3") && !tokenOut) {
    console.error("ETH swap venues require --token <symbol|address> (or first positional arg)");
    process.exit(1);
  }

  if (
    (selectedVenue === "uniswap_v2" || selectedVenue === "uniswap_v3") &&
    !percent &&
    !amountEth
  ) {
    console.error("ETH swap venues require either --percent or --amount-eth");
    process.exit(1);
  }

  if (selectedVenue === "jupiter" && (!inputMint || !outputMint)) {
    console.error("Jupiter venue requires --input-mint and --output-mint");
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    venue: selectedVenue,
    dryRun: !shouldExecute,
  };
  if (tokenOut) payload.tokenOut = tokenOut;
  if (amountEth) payload.amountEth = amountEth;
  if (percent) payload.percent = Number(percent);
  if (minAmountOut) payload.minAmountOut = minAmountOut;
  if (slippageBps) payload.slippageBps = Number(slippageBps);
  if (deadlineSeconds) payload.deadlineSeconds = Number(deadlineSeconds);
  if (recipient) payload.recipient = recipient;
  if (feeTier) payload.feeTier = Number(feeTier);
  if (inputMint) payload.inputMint = inputMint;
  if (outputMint) payload.outputMint = outputMint;
  if (amount) payload.amount = amount;
  if (amountRaw) payload.amountRaw = amountRaw;
  if (index) payload.index = Number(index);
  if (rpcUrl) payload.rpcUrl = rpcUrl;
  if (wrapUnwrapSol) payload.wrapUnwrapSol = wrapUnwrapSol.toLowerCase() !== "false";
  if (computePrice) payload.computeUnitPriceMicroLamports = Number(computePrice);
  if (skipPreflight) payload.skipPreflight = true;

  const data = await walletRequest<{
    venue: string;
    chain: string;
    from: string;
    inputToken: string;
    outputToken: string;
    amountIn: string;
    quotedAmountOut: string;
    minAmountOut: string;
    slippageBps: number;
    dryRun: boolean;
    route?: string;
    routePlan?: Array<{ label?: string; ammKey?: string; inputMint?: string; outputMint?: string }>;
    txid?: string;
    explorerUrl?: string;
  }>("POST", "/api/wallet/swap", payload);

  console.log("SWAP RESULT");
  console.log("===========");
  console.log(`mode: ${data.dryRun ? "quote-only" : "execute"}`);
  console.log(`venue: ${data.venue}`);
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`from: ${data.from}`);
  console.log(`input: ${data.amountIn} ${data.inputToken}`);
  console.log(`quote_out: ${data.quotedAmountOut} ${data.outputToken}`);
  console.log(`min_out: ${data.minAmountOut} ${data.outputToken}`);
  console.log(`slippage_bps: ${data.slippageBps}`);
  if (data.route) console.log(`route: ${data.route}`);
  if (Array.isArray(data.routePlan) && data.routePlan.length > 0) {
    console.log("route_plan:");
    for (const [indexValue, leg] of data.routePlan.entries()) {
      const title = leg.label || leg.ammKey || `leg_${indexValue + 1}`;
      console.log(`  ${indexValue + 1}. ${title}`);
      if (leg.ammKey) console.log(`     amm: ${leg.ammKey}`);
      if (leg.inputMint && leg.outputMint) {
        console.log(`     ${leg.inputMint} -> ${leg.outputMint}`);
      }
    }
  }
  if (data.txid) console.log(`txid: ${data.txid}`);
  if (data.explorerUrl) console.log(`explorer: ${data.explorerUrl}`);
}

async function rawWalletAgentAccess(mode?: string): Promise<void> {
  if (mode !== "on" && mode !== "off") {
    console.error("Usage: cybara wallet agent-access <on|off>");
    process.exit(1);
  }

  const enabled = mode === "on";
  const data = await walletRequest<{ enabled: boolean }>("PUT", "/api/wallet/agent-access", {
    enabled,
  });
  console.log(`Agent wallet access ${data.enabled ? "enabled" : "disabled"}`);
}

async function rawWalletAgentPolicy(subCmd?: string, args: string[] = []): Promise<void> {
  if (!subCmd || subCmd === "show") {
    const policy = await walletRequest<CliWalletAgentPolicy>("GET", "/api/wallet/agent-policy");
    console.log("WALLET AGENT POLICY");
    console.log("===================");
    console.log(`allow_native_send: ${policy.allowNativeSend ? "yes" : "no"}`);
    console.log(`allow_token_send: ${policy.allowTokenSend ? "yes" : "no"}`);
    console.log(`allow_eth_contract_write: ${policy.allowEthContractWrite ? "yes" : "no"}`);
    console.log(
      `allow_sol_program_instruction: ${policy.allowSolProgramInstruction ? "yes" : "no"}`
    );
    console.log(`allow_eth_swaps: ${policy.allowEthSwaps ? "yes" : "no"}`);
    console.log(`allow_dapp_interaction: ${policy.allowDappInteraction ? "yes" : "no"}`);
    console.log(`allow_x402_payments: ${policy.allowX402Payments ? "yes" : "no"}`);
    console.log(
      `allowed_eth_contracts: ${policy.allowedEthContracts.length ? policy.allowedEthContracts.join(", ") : "(none)"}`
    );
    console.log(
      `allowed_sol_programs: ${policy.allowedSolPrograms.length ? policy.allowedSolPrograms.join(", ") : "(none)"}`
    );
    console.log(
      `allowed_dapp_hosts: ${policy.allowedDappHosts.length ? policy.allowedDappHosts.join(", ") : "(none)"}`
    );
    console.log(
      `allowed_x402_networks: ${policy.allowedX402Networks.length ? policy.allowedX402Networks.join(", ") : "(none)"}`
    );
    console.log(`x402_max_amount_atomic: ${policy.x402MaxAmountAtomic}`);
    return;
  }

  if (subCmd !== "set") {
    console.error("Usage: cybara wallet agent-policy [show]");
    console.error("       cybara wallet agent-policy set --json '<partial_policy_json>'");
    process.exit(1);
  }

  const jsonPayload = getFlagValue(args, "--json");
  if (!jsonPayload) {
    console.error("Usage: cybara wallet agent-policy set --json '<partial_policy_json>'");
    process.exit(1);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(jsonPayload) as Record<string, unknown>;
  } catch (error) {
    console.error(`Invalid --json value: ${(error as Error).message}`);
    process.exit(1);
  }

  const data = await walletRequest<{ success: boolean }>("PUT", "/api/wallet/agent-policy", parsed);
  if (!data.success) {
    console.error("Failed to update wallet agent policy");
    process.exit(1);
  }
  console.log("Wallet agent policy updated");
}

async function rawWalletRpc(subCmd?: string, args: string[] = []): Promise<void> {
  if (!subCmd || subCmd === "show") {
    const rpc = await walletRequest<CliWalletRpc>("GET", "/api/wallet/rpc");
    console.log("WALLET RPC");
    console.log("==========");
    console.log(`eth: ${rpc.ethRpc}`);
    console.log(`sol: ${rpc.solRpc}`);
    console.log(`btc: ${rpc.btcApi}`);
    return;
  }

  if (subCmd === "status") {
    const status = await walletRequest<CliWalletRpcStatus>("GET", "/api/wallet/rpc/status");
    console.log("WALLET RPC STATUS");
    console.log("=================");
    for (const service of status.services || []) {
      console.log(`- ${service.chain.toUpperCase()} ${service.healthy ? "healthy" : "down"}`);
      console.log(`  endpoint: ${service.endpoint}`);
      console.log(`  latency_ms: ${service.latencyMs}`);
      if (service.latestHeight) console.log(`  latest: ${service.latestHeight}`);
      if (service.error) console.log(`  error: ${service.error}`);
    }
    return;
  }

  if (subCmd !== "set") {
    console.error("Usage: cybara wallet rpc [show]");
    console.error("       cybara wallet rpc status");
    console.error("       cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]");
    process.exit(1);
  }

  const ethRpc = getFlagValue(args, "--eth");
  const solRpc = getFlagValue(args, "--sol");
  const btcApi = getFlagValue(args, "--btc");

  if (!ethRpc && !solRpc && !btcApi) {
    console.error("Usage: cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]");
    process.exit(1);
  }

  await walletRequest("PUT", "/api/wallet/rpc", { ethRpc, solRpc, btcApi });
  console.log("Wallet RPC settings updated");
}

function rawHelp(): void {
  console.log("CYBARA CLI");
  console.log("==========");
  console.log("");
  console.log("Usage: cybara [command]");
  console.log("");
  console.log("Commands:");
  console.log("  (none)      Interactive TUI menu");
  console.log("  chat        Interactive chat with AI");
  console.log("  status      Show system status");
  console.log("  metrics     Show token usage and metrics");
  console.log("  doctor      Run environment diagnostics");
  console.log("  update      Download and install the latest CLI release (verifies SHA256)");
  console.log(
    "    update --check     Only report whether a newer release exists (non-zero if stale)"
  );
  console.log("    update --force     Reinstall even when already current / no checksum sidecar");
  console.log("    update --version X Install a specific release");
  console.log("  version     Show the current version");
  console.log("    metrics             Usage summary");
  console.log("    metrics analysis    Advanced token analysis");
  console.log("  agents      List configured agents");
  console.log("  config      Config commands");
  console.log("    config            Show all config");
  console.log("    config get <key>  Get config value");
  console.log("    config set <k> <v> Set config value");
  console.log("  provider    Provider management commands");
  console.log("    provider list         List configured providers");
  console.log("    provider available    Show available types");
  console.log("    provider add <type>   Add provider (--name, --key, --token, --default)");
  console.log("    provider update <id>  Update provider");
  console.log("    provider delete <id>  Delete provider");
  console.log("    provider models <id>  List provider models");
  console.log("    provider discover     Discover Ollama models");
  console.log("  tasks       List scheduled tasks");
  console.log("  skills      List installed skills");
  console.log("  plugin      Plugin management commands");
  console.log("    plugin list                List installed plugins");
  console.log("    plugin validate <path>     Validate a plugin manifest and dirs");
  console.log("    plugin install <path>      Install a local plugin");
  console.log("    plugin remove <plugin-id>  Remove an installed local plugin");
  console.log("  sessions    List chat sessions");
  console.log("  memory      Memory commands");
  console.log("    memory         List recent memories");
  console.log("    memory <query> Search memories");
  console.log("  logs        Show recent logs");
  console.log("  subagent    Subagent commands");
  console.log("    subagent list       List subagents");
  console.log("    subagent spawn <t>  Spawn with task");
  console.log("    subagent kill <id>  Kill subagent");
  console.log("  loop        Autonomous agent loop commands");
  console.log("    loop list [--agent <id>]              List loop runs");
  console.log("    loop start <agent-id> <objective>     Start loop");
  console.log("      [--max-iterations N] [--max-duration SEC] [--model ID] [--no-tools]");
  console.log("    loop show <run-id>                    Show loop details");
  console.log("    loop cancel <run-id>                  Cancel a running loop");
  console.log("  browser     Browser commands");
  console.log("    browser            Show browser status");
  console.log("    browser tabs       List open browser tabs");
  console.log("  channels    List configured channels");
  console.log("  mobile      Mobile companion commands");
  console.log("    mobile connect [--url URL] [--name NAME] [--qr] [--json]");
  console.log("  wallet      Wallet management commands");
  console.log("    wallet status                     Show wallet status and RPC settings");
  console.log("    wallet create --password <p>      Create 24-word wallet");
  console.log('    wallet import --password <p> --mnemonic "..."   Import wallet');
  console.log("    wallet unlock --password <p>      Unlock wallet");
  console.log("    wallet lock                       Lock wallet");
  console.log("    wallet accounts [--chains c] [--count n] [--start n]");
  console.log("    wallet balances [--chains c] [--count n] [--start n]");
  console.log("    wallet tokens <eth|sol> [--index n] [--include-zero]");
  console.log("    wallet token-tx <eth|sol> [--index n] [--limit n] [--token addr]");
  console.log("    wallet receive <chain> [--index n]");
  console.log("    wallet tx <chain> [--index n] [--limit n]");
  console.log("    wallet send <chain> --to <addr> --amount <value>");
  console.log("    wallet send-token <eth|sol> --token <addr|mint> --to <addr> --amount <value>");
  console.log("    wallet swap-eth-uniswap --token <symbol|addr> --percent 50 [--execute]");
  console.log("    wallet price [BTC|BTC/USD|<SOL_MINT>] [--source auto|chainlink|pyth|jupiter]");
  console.log("    wallet swap [<TOKEN>] [--venue uniswap_v3|uniswap_v2|jupiter] [--execute]");
  console.log("    wallet endpoints");
  console.log("    wallet dapps");
  console.log("    wallet rpc-call <eth|sol> --method <rpc_method> [--params '[...]']");
  console.log("    wallet dapp --adapter <adapter> --json '{...}'");
  console.log("    wallet x402 --url <https_url> [--method GET|POST] [--dry-run]");
  console.log("    wallet swap-quote ...        # legacy alias for wallet swap (quote)");
  console.log("    wallet swap-execute ...      # legacy alias for wallet swap --execute");
  console.log(
    "    wallet contract-call --contract <addr> (--abi '<json_or_sig>' | --signature '<name(types)>') [--method <name>]"
  );
  console.log("    wallet sol-instruction --program <id> (--keys '[...]' | --accounts '[...]')");
  console.log("    wallet agent-access <on|off>");
  console.log("    wallet agent-policy [show]");
  console.log("    wallet agent-policy set --json '{...}'");
  console.log("    wallet rpc [show]");
  console.log("    wallet rpc status");
  console.log("    wallet rpc set [--eth URL] [--sol URL] [--btc URL]");
  console.log("  pair        Channel pairing commands");
  console.log("    pair           List pending pairings");
  console.log("    pair <CODE>    Approve a pairing code");
  console.log("    pair reject    Reject a pairing code");
  console.log("    pair policy    Set DM policy for a channel");
  console.log("  mcp         MCP server commands");
  console.log("    mcp list     List installed MCP servers");
  console.log("    mcp search   Search MCP registry");
  console.log("    mcp install  Install MCP server");
  console.log("    mcp popular  Show popular servers");
  console.log("  lsp         Language Server commands");
  console.log("    lsp list       Show language server status");
  console.log("    lsp install    Install language server");
  console.log("    lsp uninstall  Uninstall language server");
  console.log("  start       Start the server");
  console.log("  wizard      Run setup wizard (first-time configuration)");
  console.log("  help        Show this help");
  console.log("");
  console.log(`Version: ${getVersion()}`);
  console.log(`Environment: CYBARA_API=${API_BASE}`);
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

  useInput((input) => {
    if (input === "q") exit();
  });

  React.useEffect(() => {
    fetchAPI<StatusResponse>("/api/health")
      .then((d) => {
        if (d) setData(d);
        else setError("Failed to connect to Cybara server");
      })
      .finally(() => setLoading(false));
  }, []);

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

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
          <Text>{formatUptime(data.uptime)}</Text>
        </Box>
        <Box>
          <Text color="gray">Time: </Text>
          <Text>{new Date(data.timestamp).toLocaleString()}</Text>
        </Box>
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
              <StatusBadge status={info.status} />
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

  useInput((input) => {
    if (input === "q") exit();
  });

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

  useInput((input) => {
    if (input === "q") exit();
  });

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

  useInput((input) => {
    if (input === "q") exit();
  });

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

  useInput((input) => {
    if (input === "q") exit();
  });

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

/** Non-blocking banner that surfaces when a newer Cybara release is available. */
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

const MainMenu = () => {
  const { exit } = useApp();
  const [selected, setSelected] = React.useState(0);
  const [status, setStatus] = React.useState<{
    message: string;
    type: "info" | "success" | "error" | "loading";
  } | null>(null);

  const menuItems = [
    { label: "Start Server", action: "start" },
    { label: "View Status", action: "status" },
    { label: "View Metrics", action: "metrics" },
    { label: "View Skills", action: "skills" },
    { label: "View Agents", action: "agents" },
    { label: "View Tasks", action: "tasks" },
    { label: "Open Web UI", action: "ui" },
    { label: "Exit", action: "exit" },
  ];

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected((s) => (s > 0 ? s - 1 : menuItems.length - 1));
    } else if (key.downArrow) {
      setSelected((s) => (s < menuItems.length - 1 ? s + 1 : 0));
    } else if (key.return) {
      handleAction(menuItems[selected].action);
    } else if (input === "q") {
      exit();
    }
  });

  const handleAction = async (action: string) => {
    switch (action) {
      case "start":
        setStatus({ message: "Starting Cybara server...", type: "loading" });
        spawn("bun", ["run", "dev"], { stdio: "inherit" });
        break;
      case "status":
      case "metrics":
      case "skills":
      case "agents":
      case "tasks":
        render(<TUIApp command={action} />);
        break;
      case "ui":
        setStatus({ message: "Opening browser...", type: "info" });
        spawn("open", [`${API_BASE}`]);
        break;
      case "exit":
        exit();
        break;
    }
  };

  return (
    <Box flexDirection="column">
      <Logo />
      <UpdateBanner />
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text bold>Main Menu</Text>
        {menuItems.map((item, i) => (
          <Text key={item.action} color={i === selected ? "cyan" : "white"}>
            {i === selected ? "❯ " : "  "}
            {item.label}
          </Text>
        ))}
      </Box>
      {status && (
        <Box marginY={1}>
          {status.type === "loading" ? (
            <Text color="yellow">
              <Spinner type="dots" /> {status.message}
            </Text>
          ) : (
            <Text
              color={status.type === "success" ? "green" : status.type === "error" ? "red" : "cyan"}
            >
              {status.type === "success" ? "✓" : status.type === "error" ? "✗" : "→"}{" "}
              {status.message}
            </Text>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">↑/↓ Navigate • Enter Select • q Quit</Text>
      </Box>
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

  useInput((input, key) => {
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
  });

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
    default:
      return <MainMenu />;
  }
};

const args = process.argv.slice(2);
const command = args[0];

function shouldExitAfterMain(): boolean {
  if (!command) return false;
  if (command === "mcp" && args[1] === "serve") return false;
  if (command === "chat") return false;
  return !["start", "dev", "wizard", "setup", "install", "tui"].includes(command);
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

function getVersion(): string {
  return getAppVersion();
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
  const asset = (release.assets || []).find((candidate) => candidate.name === assetName);
  const downloadUrl = asset?.browser_download_url;

  if (!downloadUrl) {
    console.error(`Release ${release.tag_name || "latest"} does not contain ${assetName}.`);
    process.exit(1);
  }

  return { release, assetName, downloadUrl };
}

/** Compute the SHA256 hex digest of a file on disk. */
function computeFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

/** Fetch the expected SHA256 for an asset from its published sidecar. Returns null if unavailable. */
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
  switch (command) {
    case "status":
      await rawStatus();
      break;
    case "doctor":
      await rawDoctor();
      break;
    case "update":
      await rawUpdate({
        version: getFlagValue(args.slice(1), "--version"),
        checkOnly: hasFlag(args.slice(1), "--check") || args[1] === "check",
        force: hasFlag(args.slice(1), "--force"),
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
    case "chat":
      await rawChat(args[1]);
      break;
    case "config":
      await rawConfig(args[1], args[2], args[3]);
      break;
    case "router":
      await rawRouter(args.slice(1));
      break;
    case "sessions":
      await rawSessions();
      break;
    case "mobile":
      switch (args[1]) {
        case "connect":
        case undefined:
          await rawMobileConnect(args.slice(2));
          break;
        default:
          console.log("Mobile Commands:");
          console.log("  cybara mobile connect [--url URL] [--name NAME] [--qr] [--json]");
          break;
      }
      break;
    case "memory":
      await rawMemory(args[1]);
      break;
    case "logs":
      await rawLogs(args[1] ? parseInt(args[1]) : 20);
      break;
    case "subagent":
    case "subagents":
      switch (args[1]) {
        case "list":
        case undefined:
          await rawSubagents();
          break;
        case "spawn":
          await rawSubagentSpawn(args.slice(2).join(" "));
          break;
        case "kill":
          await rawSubagentKill(args[2]);
          break;
        default:
          console.log("Subagent Commands:");
          console.log("  cybara subagent list       - List all subagents");
          console.log("  cybara subagent spawn <t>  - Spawn with task");
          console.log("  cybara subagent kill <id>  - Kill subagent");
          break;
      }
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
      rawHelp();
      break;

    case "version":
    case "--version":
    case "-v":
      console.log(`cybara v${getVersion()}`);
      break;

    case "pair": {
      const pairSubCmd = args[1];
      if (!pairSubCmd || pairSubCmd === "list") {
        await rawPairList();
      } else if (pairSubCmd === "reject") {
        const rejectCode = args[2];
        if (!rejectCode) {
          console.error("Usage: cybara pair reject <CODE>");
          process.exit(1);
        }
        await rawPairReject(rejectCode);
      } else if (pairSubCmd === "policy") {
        const channelName = args[2];
        const policy = args[3];
        if (!channelName || !policy) {
          console.error("Usage: cybara pair policy <channel> <policy>");
          console.log("Policies: pairing, allowlist, open, disabled");
          process.exit(1);
        }
        await rawPairPolicy(channelName, policy);
      } else {
        await rawPairApprove(pairSubCmd);
      }
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
    case "dev":
      spawn("bun", ["run", "dev"], { stdio: "inherit" });
      break;

    case "wizard":
    case "setup":
    case "install":
    case "tui":
      render(<TUIApp command={command === "tui" ? undefined : command} />);
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
