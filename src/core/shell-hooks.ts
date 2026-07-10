/**
 * User-defined shell-script hooks.
 *
 * Extends cybara's in-process TS hook system (src/core/agent-hooks.ts) so users
 * can register shell scripts that run on lifecycle events (tool_before/after,
 * llm_request, message:sent). Configured via the cybara config file under
 * `hooks.shell`.
 *
 * Contract: the script receives a JSON event on stdin and may return a decision
 * object on stdout. For `tool_before`, returning {"block": true, "reason": "..."}
 * blocks the tool call. Events are only sent for allowlisted scripts.
 */
import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { registerAgentHook, type AgentHookEvent } from "./agent-hooks";
import { config } from "./config";

export interface ShellHookConfig {
  /** Event types this hook fires on. "*" = all. */
  events: string[];
  /** Absolute path (or $PATH-resolved) to the script. */
  command: string;
  /** Extra args passed after the event JSON. */
  args?: string[];
  /** Timeout in ms. Default 5000. */
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
  // Support "cmd arg arg" strings as well as bare paths.
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [cmd, ...baseArgs] = parts;
  const looksLikePath = cmd.includes("/") || cmd.includes("\\") || /^[A-Za-z]:/.test(cmd);
  if (!existsSync(cmd) && !looksLikePath) {
    // Bare command on PATH — allow (spawn will resolve). We can't pre-verify.
    return wrapForWindowsBatch(cmd, baseArgs);
  }
  if (existsSync(cmd) && !statSync(cmd).isDirectory()) {
    return wrapForWindowsBatch(cmd, baseArgs);
  }
  return null;
}

/**
 * Run a shell hook for an event. Returns the hook's parsed decision (if any).
 * The event is serialized to stdin as JSON; the script's stdout is parsed as a
 * decision object. Timeouts and failures resolve to "no decision" so a broken
 * user script never breaks the agent loop.
 */
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
      env: { ...process.env, CYBARA_HOOK_EVENT: event.type },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
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

/**
 * Register all user-defined shell hooks from config. Idempotent — safe to call
 * once at agent startup. Hooks that fail validation are skipped with a warning.
 */
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

/** Reset registration state (for tests). */
export function resetShellHooksForTests(): void {
  registered = false;
}
