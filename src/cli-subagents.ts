import { parseSubagentSpawnArgs } from "./cli-subagent-args";

interface SubagentInfo {
  id: string;
  task: string;
  label: string;
  status: string;
  createdAt: string;
  model?: string;
  workspaceDir?: string;
  runTimeoutSeconds?: number;
  result?: string;
  error?: string;
  thinking?: string;
  activityCount?: number;
  toolCallCount?: number;
  activities?: Array<{ text: string; toolName?: string; phase?: string }>;
  toolCalls?: Array<{ name: string; status?: string }>;
}

interface SubagentWaitResponse {
  success?: boolean;
  error?: string;
  status: "completed" | "partial" | "timeout";
  runs: Array<{
    runId: string;
    status: string;
    label: string;
    result?: string;
    error?: string;
    toolCallCount: number;
  }>;
  pendingRunIds: string[];
  elapsedMs: number;
}

interface SubagentCliOptions {
  apiBase: string;
  apiKey?: string | null;
}

function headers(apiKey: string | null | undefined, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function request<T>(
  options: SubagentCliOptions,
  path: string,
  init?: RequestInit
): Promise<{ response: Response; data: T }> {
  const response = await fetch(`${options.apiBase}${path}`, init);
  const data = (await response.json()) as T;
  return { response, data };
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionalArgs(args: string[], valueFlags: string[]): string[] {
  const values = new Set(valueFlags);
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (values.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) result.push(value);
  }
  return result;
}

async function listSubagents(args: string[], options: SubagentCliOptions): Promise<void> {
  const sessionId = flagValue(args, "--session");
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const { data } = await request<SubagentInfo[]>(options, `/api/subagents${query}`, {
    headers: headers(options.apiKey),
  });
  const subagents = Array.isArray(data) ? data : [];
  console.log("CYBARA SUBAGENTS");
  console.log("================");
  console.log(`total: ${subagents.length}`);
  console.log(`running: ${subagents.filter((item) => item.status === "running").length}`);
  if (sessionId) console.log(`session: ${sessionId}`);
  console.log("");
  if (subagents.length === 0) {
    console.log("No subagents");
    return;
  }
  for (const subagent of subagents) {
    const status =
      subagent.status === "running" ? "⟳" : subagent.status === "completed" ? "✓" : "✗";
    console.log(`${status} ${subagent.label.slice(0, 70)}`);
    console.log(`  id: ${subagent.id}`);
    console.log(`  status: ${subagent.status}`);
    console.log(`  tools: ${subagent.toolCallCount || 0}`);
    if (subagent.model) console.log(`  model: ${subagent.model}`);
    if (subagent.workspaceDir) console.log(`  workspace: ${subagent.workspaceDir}`);
  }
}

async function showSubagent(id: string | undefined, options: SubagentCliOptions): Promise<void> {
  if (!id) throw new Error("Usage: cybara subagent show <id>");
  const { data } = await request<SubagentInfo>(
    options,
    `/api/subagents/${encodeURIComponent(id)}`,
    {
      headers: headers(options.apiKey),
    }
  );
  console.log(data.label || data.task || id);
  console.log("=".repeat(Math.max(8, Math.min(72, (data.label || data.task || id).length))));
  console.log(`id: ${data.id}`);
  console.log(`status: ${data.status}`);
  console.log(`task: ${data.task}`);
  console.log(`activity: ${data.activityCount || data.activities?.length || 0}`);
  console.log(`tools: ${data.toolCallCount || data.toolCalls?.length || 0}`);
  for (const activity of data.activities || []) {
    console.log(
      `  ${activity.toolName || "thought"} · ${activity.phase || "result"}: ${activity.text}`
    );
  }
  for (const tool of data.toolCalls || []) {
    console.log(`  ${tool.name} · ${tool.status || "completed"}`);
  }
  if (data.thinking) console.log(`\nThinking\n${data.thinking}`);
  if (data.result) console.log(`\nResult\n${data.result}`);
  if (data.error) console.log(`\nError\n${data.error}`);
}

async function spawnSubagent(args: string[], options: SubagentCliOptions): Promise<void> {
  const payload = parseSubagentSpawnArgs(args);
  const { response, data } = await request<{
    id?: string;
    subagentId?: string;
    status?: string;
    error?: string;
    warning?: string;
  }>(options, "/api/subagents/spawn", {
    method: "POST",
    headers: headers(options.apiKey, true),
    body: JSON.stringify(payload),
  });
  const id = data.subagentId || data.id;
  if (!id) throw new Error(data.error || data.warning || response.statusText || "Spawn failed");
  console.log(`✓ Spawned subagent: ${id}`);
  if (data.status) console.log(`status: ${data.status}`);
}

async function killSubagent(id: string | undefined, options: SubagentCliOptions): Promise<void> {
  if (!id) throw new Error("Usage: cybara subagent kill <id>");
  const { data } = await request<{ success?: boolean; error?: string }>(
    options,
    `/api/subagents/${encodeURIComponent(id)}/kill`,
    { method: "POST", headers: headers(options.apiKey) }
  );
  if (!data.success) throw new Error(data.error || "Subagent is not active");
  console.log(`✓ Killed subagent: ${id}`);
}

async function clearSubagents(args: string[], options: SubagentCliOptions): Promise<void> {
  const sessionId = flagValue(args, "--session");
  const id = positionalArgs(args, ["--session"])[0];
  const path = sessionId
    ? `/api/subagents?sessionId=${encodeURIComponent(sessionId)}`
    : id
      ? `/api/subagents/${encodeURIComponent(id)}`
      : "";
  if (!path) throw new Error("Usage: cybara subagent clear <id> | --session <session-id>");
  const { data } = await request<{ success?: boolean; error?: string; cleared?: number }>(
    options,
    path,
    { method: "DELETE", headers: headers(options.apiKey) }
  );
  if (!data.success) throw new Error(data.error || "Clear failed");
  console.log(
    sessionId ? `✓ Cleared ${data.cleared || 0} completed runs` : `✓ Cleared subagent: ${id}`
  );
}

async function waitForSubagents(args: string[], options: SubagentCliOptions): Promise<void> {
  const sessionId = flagValue(args, "--session");
  const timeoutValue = flagValue(args, "--timeout");
  const runIds = positionalArgs(args, ["--session", "--timeout"]);
  if (runIds.length === 0)
    throw new Error("Usage: cybara subagent wait <id...> [--timeout <seconds>]");
  const timeoutSeconds = timeoutValue === undefined ? undefined : Number(timeoutValue);
  if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0)) {
    throw new Error("--timeout must be a non-negative number");
  }
  const { data } = await request<SubagentWaitResponse>(options, "/api/subagents/wait", {
    method: "POST",
    headers: headers(options.apiKey, true),
    body: JSON.stringify({ runIds, timeoutSeconds, requesterSessionId: sessionId }),
  });
  if (data.success === false || !Array.isArray(data.runs)) {
    throw new Error(data.error || "Unable to wait for subagents");
  }
  console.log(`status: ${data.status}`);
  console.log(`elapsed: ${(data.elapsedMs / 1000).toFixed(1)}s`);
  for (const run of data.runs) {
    console.log(`\n${run.label} [${run.status}] · ${run.toolCallCount} tools`);
    if (run.result) console.log(run.result);
    if (run.error) console.log(`Error: ${run.error}`);
  }
  if (data.pendingRunIds.length > 0) console.log(`\npending: ${data.pendingRunIds.join(", ")}`);
}

function printHelp(): void {
  console.log("Subagent Commands:");
  console.log("  cybara subagent list [--session <id>]          List runs");
  console.log("  cybara subagent show <id>                      Show activity and output");
  console.log("  cybara subagent spawn [--session <id>] <task>  Spawn a run");
  console.log("  cybara subagent wait <id...>                   Wait and collect results");
  console.log("  cybara subagent kill <id>                      Stop an active run");
  console.log("  cybara subagent clear <id>                     Clear one completed run");
  console.log("  cybara subagent clear --session <id>           Clear completed chat history");
}

export async function runSubagentCommand(
  args: string[],
  options: SubagentCliOptions
): Promise<void> {
  try {
    switch (args[0]) {
      case "list":
      case undefined:
        await listSubagents(args.slice(1), options);
        return;
      case "show":
      case "get":
        await showSubagent(args[1], options);
        return;
      case "spawn":
        await spawnSubagent(args.slice(1), options);
        return;
      case "wait":
        await waitForSubagents(args.slice(1), options);
        return;
      case "kill":
      case "stop":
        await killSubagent(args[1], options);
        return;
      case "clear":
      case "delete":
        await clearSubagents(args.slice(1), options);
        return;
      default:
        printHelp();
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
