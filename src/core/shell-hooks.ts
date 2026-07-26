import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { registerAgentHook, type AgentHookEvent } from "./agent-hooks";
import { config } from "./config";
import { buildSubprocessEnvironment } from "./subprocess-env";

export interface ShellHookConfig {
  events: string[];
  command: string;
  args?: string[];
  timeoutMs?: number;
}

interface HooksConfig {
  shell?: ShellHookConfig[];
}

const DEFAULT_TIMEOUT_MS = 5000;
const SUPPORTED_EVENTS = new Set([
  "*",
  "tool_before",
  "tool_after",
  "tool_error",
  "tool_blocked",
  "llm_request",
  "llm_response",
  "llm_error",
  "message:received",
  "message:sent",
]);

function loadHookConfigs(): ShellHookConfig[] {
  try {
    const cfg = config.get("hooks") as HooksConfig | undefined;
    const hooks = cfg?.shell;
    if (!Array.isArray(hooks)) return [];
    return hooks.filter((h) => h && typeof h.command === "string" && Array.isArray(h.events));
  } catch {
    return [];
  }
}

function eventMatches(hook: ShellHookConfig, type: string): boolean {
  return hook.events.some((e) => e === "*" || e === type);
}

function wrapForWindowsBatch(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const lowered = cmd.toLowerCase();
  if (process.platform === "win32" && (lowered.endsWith(".cmd") || lowered.endsWith(".bat"))) {
    return { cmd: "cmd.exe", args: ["/d", "/s", "/c", cmd, ...args] };
  }
  return { cmd, args };
}

function resolveCommand(command: string): { cmd: string; args: string[] } | null {
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [cmd, ...baseArgs] = parts;
  const looksLikePath = cmd.includes("/") || cmd.includes("\\") || /^[A-Za-z]:/.test(cmd);
  if (!existsSync(cmd) && !looksLikePath) {
    return wrapForWindowsBatch(cmd, baseArgs);
  }
  if (existsSync(cmd) && !statSync(cmd).isDirectory()) {
    return wrapForWindowsBatch(cmd, baseArgs);
  }
  return null;
}

function runShellHook(
  hook: ShellHookConfig,
  event: AgentHookEvent
): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const resolved = resolveCommand(hook.command);
    if (!resolved) {
      resolve(undefined);
      return;
    }
    const args = [...resolved.args, ...(hook.args ?? [])];
    let settled = false;
    const finish = (value: Record<string, unknown> | undefined) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const child = spawn(resolved.cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildSubprocessEnvironment({ CYBARA_HOOK_EVENT: event.type }),
    });

    const timer = setTimeout(() => {
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch {}
        console.warn(
          `[ShellHook] ${hook.command} timed out after ${hook.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
        );
        finish(undefined);
      }
    }, hook.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      console.warn(`[ShellHook ${hook.command}] stderr: ${chunk.toString().trim()}`);
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (!trimmed) {
        finish(undefined);
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        finish(
          parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
        );
      } catch {
        finish(undefined);
      }
    });

    try {
      child.stdin?.end(JSON.stringify(event));
    } catch {
      clearTimeout(timer);
      finish(undefined);
    }
  });
}

let registered = false;

export function registerShellHooks(): { count: number } {
  if (registered) {
    return { count: 0 };
  }
  registered = true;

  const hooks = loadHookConfigs();
  let count = 0;

  for (const hook of hooks) {
    const invalidEvents = hook.events.filter((e) => !SUPPORTED_EVENTS.has(e));
    if (invalidEvents.length > 0) {
      console.warn(
        `[ShellHook] ${hook.command} has unsupported events: ${invalidEvents.join(", ")}. Skipping.`
      );
      continue;
    }
    if (!resolveCommand(hook.command)) {
      console.warn(`[ShellHook] command not found or not executable: ${hook.command}. Skipping.`);
      continue;
    }

    registerAgentHook(async (event: AgentHookEvent) => {
      if (!eventMatches(hook, event.type)) return undefined;
      return runShellHook(hook, event);
    });
    count += 1;
    console.log(`[ShellHook] Registered ${hook.command} for [${hook.events.join(", ")}]`);
  }

  return { count };
}

export function resetShellHooksForTests(): void {
  registered = false;
}
