/**
 * `execute_code` — run code that calls other cybara tools programmatically.
 *
 * Distinct from `exec` (which runs shell): this is a sandboxed JS/TS evaluator
 * exposing a `cybara` namespace whose methods map to cybara's tool handlers
 * (read, write, grep, http, calc, ...). It collapses many LLM round-trips for
 * data-processing tasks (e.g. fetch 5 URLs, parse JSON, aggregate) into one
 * tool call.
 *
 * Ports hermes's `execute_code` (code_execution_tool). Safety:
 *  - Runs via a constrained `new Function` evaluator with a timeout.
 *  - The `cybara` object only exposes read/tool methods, never raw FS.
 *  - Network/disk side-effects happen only through explicit tool calls, which
 *    are themselves subject to the existing permission/sandbox system.
 */
import { executeTool, toolSchemas } from "./index";
import type { ToolContext } from "../index";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CODE_CHARS = 20_000;

/** Names exposed in the `cybara` namespace (skip meta/planning tools). */
const BLOCKED_TOOL_NAMES = new Set([
  "tool_search",
  "tool_describe",
  "tool_call",
  "execute_code",
  "clarify",
  "todo",
]);

function buildCybaraNamespace(context: ToolContext | undefined): Record<string, unknown> {
  const ns: Record<string, unknown> = {};
  for (const name of Object.keys(toolSchemas)) {
    if (BLOCKED_TOOL_NAMES.has(name)) continue;
    // Each namespace method is `cybara.<name>(args)`.
    ns[name] = (args: unknown) => {
      const safeArgs =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      return executeTool(name, safeArgs, context);
    };
  }
  return ns;
}

export interface ExecuteCodeResult {
  ok: boolean;
  stdout: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export async function handleExecuteCode(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<ExecuteCodeResult> {
  const code = typeof args.code === "string" ? args.code : "";
  const language = (typeof args.language === "string" ? args.language : "javascript").toLowerCase();
  const timeoutMs = clampInt(args.timeoutMs, 1000, 60_000, DEFAULT_TIMEOUT_MS);

  if (!code.trim()) {
    throw new Error("Validation error: 'code' is required.");
  }
  if (code.length > MAX_CODE_CHARS) {
    throw new Error(`Code too large: ${code.length} chars (max ${MAX_CODE_CHARS}).`);
  }
  if (
    language !== "javascript" &&
    language !== "typescript" &&
    language !== "js" &&
    language !== "ts"
  ) {
    throw new Error(`Unsupported language "${language}". Use javascript or typescript.`);
  }

  const cybara = buildCybaraNamespace(context);
  const start = Date.now();
  const stdoutChunks: string[] = [];
  const sandboxConsole = {
    log: (...parts: unknown[]) => stdoutChunks.push(parts.map(formatValue).join(" ")),
    warn: (...parts: unknown[]) => stdoutChunks.push(parts.map(formatValue).join(" ")),
    error: (...parts: unknown[]) => stdoutChunks.push(parts.map(formatValue).join(" ")),
    info: (...parts: unknown[]) => stdoutChunks.push(parts.map(formatValue).join(" ")),
  };

  // The user's code is wrapped so the last expression's value is returned.
  // `cybara` and `console` are passed as closure vars.
  const wrapped = `
    "use strict";
    const cybara = __cybara;
    const console = __console;
    return (async () => {
      ${transformCode(code)}
    })();
  `;

  try {
    const fn = new Function("__cybara", "__console", wrapped) as (
      cybara: Record<string, unknown>,
      console: typeof sandboxConsole
    ) => Promise<unknown>;

    const result = await withTimeout(fn(cybara, sandboxConsole), timeoutMs);
    return {
      ok: true,
      stdout: stdoutChunks.join("\n"),
      result: sanitize(result),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: stdoutChunks.join("\n"),
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    };
  }
}

/** Strip a trailing semicolon so the last expression is returned by the IIFE. */
function transformCode(code: string): string {
  return code.replace(/;\s*$/, "");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Code execution timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Make sure the returned value is JSON-serializable for the tool result. */
function sanitize(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
