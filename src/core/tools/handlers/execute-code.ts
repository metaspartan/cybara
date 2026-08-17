import { findBunRuntime } from "../../bun-runtime";
import { readSubprocessStreamAsText } from "../../subprocess-output";
import { executeTool, toolSchemas } from "./index";
import type { ToolContext } from "../index";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CODE_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 262_144;
const BLOCKED_TOOL_NAMES = new Set([
  "tool_search",
  "tool_describe",
  "tool_call",
  "execute_code",
  "clarify",
  "todo",
]);

const EXECUTE_CODE_WORKER_SOURCE = String.raw`
const pending = new Map();
const allowed = new Set();
let nextId = 1;
const send = (message) => process.send?.(message);
const safe = (value) => {
  try {
    structuredClone(value);
    return value;
  } catch {
    return String(value);
  }
};
const output = (...parts) => send({
  type: "output",
  text: parts.map((value) => typeof value === "string" ? value : JSON.stringify(safe(value))).join(" ")
});
const runtimeConsole = {
  log: output,
  warn: output,
  error: output,
  info: output
};
const cybara = new Proxy(Object.create(null), {
  get(_target, property) {
    if (typeof property !== "string" || !allowed.has(property)) return undefined;
    return (args = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ type: "tool_call", id, name: property, args });
    });
  }
});
process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "tool_result") {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "Tool call failed"));
    return;
  }
  if (message.type !== "execute" || typeof message.source !== "string") return;
  for (const name of Array.isArray(message.allowedTools) ? message.allowedTools : []) {
    if (typeof name === "string") allowed.add(name);
  }
  try {
    const load = new Function(message.source + "\nreturn __cybara_user;");
    const execute = load();
    const result = await execute(cybara, runtimeConsole);
    send({ type: "complete", result: safe(result) });
  } catch (error) {
    send({ type: "failed", error: error instanceof Error ? error.message : String(error) });
  }
});
send({ type: "ready" });
`;

interface ExecuteWorkerMessage {
  type: "ready" | "output" | "tool_call" | "complete" | "failed";
  id?: number;
  name?: string;
  args?: unknown;
  text?: string;
  result?: unknown;
  error?: string;
}

export interface ExecuteCodeResult {
  ok: boolean;
  stdout: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

function isExecuteWorkerMessage(value: unknown): value is ExecuteWorkerMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as Record<string, unknown>).type;
  return (
    type === "ready" ||
    type === "output" ||
    type === "tool_call" ||
    type === "complete" ||
    type === "failed"
  );
}

function allowedToolNames(context: ToolContext | undefined): string[] {
  const allowed = context?.allowedToolNames ? new Set(context.allowedToolNames) : undefined;
  return Object.keys(toolSchemas).filter(
    (name) => !BLOCKED_TOOL_NAMES.has(name) && (!allowed || allowed.has(name))
  );
}

function compileUserFunction(code: string, language: string): string {
  const loader = language === "typescript" || language === "ts" ? "ts" : "js";
  const wrapped = `async function __cybara_user(cybara, console) {\n${code}\n}`;
  return new Bun.Transpiler({ loader }).transformSync(wrapped, loader);
}

function workerEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    NO_COLOR: "1",
    CYBARA_EXECUTE_CODE_CHILD: "1",
  };
  for (const name of ["PATH", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function appendOutput(chunks: string[], value: string): void {
  const used = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (used >= MAX_OUTPUT_CHARS) return;
  chunks.push(value.slice(0, MAX_OUTPUT_CHARS - used));
}

function toToolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function runInChild(
  source: string,
  timeoutMs: number,
  context: ToolContext | undefined
): Promise<ExecuteCodeResult> {
  const runtime = findBunRuntime();
  if (!runtime) {
    return {
      ok: false,
      stdout: "",
      error: "A Bun runtime is required for host code execution",
      durationMs: 0,
    };
  }

  const startedAt = Date.now();
  const stdout: string[] = [];
  const toolAbort = new AbortController();
  const nestedContext = context ? { ...context, abortSignal: toolAbort.signal } : undefined;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult: ((value: ExecuteCodeResult) => void) | undefined;
  let processHandle: ReturnType<typeof Bun.spawn> | undefined;

  const result = new Promise<ExecuteCodeResult>((resolve) => {
    resolveResult = resolve;
  });

  const finish = (value: Omit<ExecuteCodeResult, "durationMs" | "stdout">): void => {
    if (settled || !resolveResult) return;
    settled = true;
    if (timer) clearTimeout(timer);
    context?.abortSignal?.removeEventListener("abort", abortFromContext);
    toolAbort.abort(value.error || "Code execution finished");
    processHandle?.kill();
    resolveResult({
      ...value,
      stdout: stdout.join("\n"),
      durationMs: Date.now() - startedAt,
    });
  };

  const stop = (error: string): void => {
    finish({ ok: false, error });
  };

  const abortFromContext = (): void => stop("Code execution was interrupted");

  const handleMessage = (raw: unknown): void => {
    if (!isExecuteWorkerMessage(raw) || settled) return;
    if (raw.type === "ready") {
      processHandle?.send({
        type: "execute",
        source,
        allowedTools: allowedToolNames(context),
      });
      return;
    }
    if (raw.type === "output") {
      appendOutput(stdout, raw.text ?? "");
      return;
    }
    if (raw.type === "complete") {
      finish({ ok: true, result: raw.result });
      return;
    }
    if (raw.type === "failed") {
      finish({ ok: false, error: raw.error || "Code execution failed" });
      return;
    }
    if (raw.type !== "tool_call" || typeof raw.id !== "number" || typeof raw.name !== "string") {
      return;
    }
    const permitted = allowedToolNames(context).includes(raw.name);
    if (!permitted) {
      processHandle?.send({
        type: "tool_result",
        id: raw.id,
        ok: false,
        error: `Tool '${raw.name}' is not enabled for this execution`,
      });
      return;
    }
    void executeTool(raw.name, toToolArgs(raw.args), nestedContext).then(
      (toolResult) => {
        if (!settled) {
          processHandle?.send({ type: "tool_result", id: raw.id, ok: true, result: toolResult });
        }
      },
      (error: unknown) => {
        if (!settled) {
          processHandle?.send({
            type: "tool_result",
            id: raw.id,
            ok: false,
            error: errorText(error),
          });
        }
      }
    );
  };

  processHandle = Bun.spawn([runtime, "--eval", EXECUTE_CODE_WORKER_SOURCE], {
    cwd: context?.workspaceDir || process.cwd(),
    env: workerEnvironment(),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    ipc: handleMessage,
    onExit: (_process, exitCode, signalCode, error) => {
      if (settled) return;
      const detail = error
        ? errorText(error)
        : `Host code process exited before completion (${signalCode || exitCode || "unknown"})`;
      finish({ ok: false, error: detail });
    },
  });

  const stderr = processHandle.stderr;
  if (stderr && typeof stderr !== "number") {
    void readSubprocessStreamAsText(stderr).then((text) => {
      const trimmed = text.trim();
      if (trimmed) appendOutput(stdout, trimmed);
    });
  }

  context?.abortSignal?.addEventListener("abort", abortFromContext, { once: true });
  timer = setTimeout(() => stop(`Code execution timed out after ${timeoutMs}ms`), timeoutMs);
  return result;
}

export async function handleExecuteCode(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<ExecuteCodeResult> {
  const code = typeof args.code === "string" ? args.code : "";
  const language = (typeof args.language === "string" ? args.language : "javascript").toLowerCase();
  const timeoutMs = clampInt(args.timeoutMs, 1000, 60_000, DEFAULT_TIMEOUT_MS);

  if (!code.trim()) throw new Error("Validation error: 'code' is required.");
  if (code.length > MAX_CODE_CHARS) {
    throw new Error(`Code too large: ${code.length} chars (max ${MAX_CODE_CHARS}).`);
  }
  if (!["javascript", "typescript", "js", "ts"].includes(language)) {
    throw new Error(`Unsupported language "${language}". Use javascript or typescript.`);
  }

  try {
    return await runInChild(compileUserFunction(code, language), timeoutMs, context);
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      error: errorText(error),
      durationMs: 0,
    };
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}
