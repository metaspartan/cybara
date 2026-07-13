import { existsSync } from "fs";
import { appendFile } from "fs/promises";
import { homeDir } from "../../paths";
import { buildSandboxedShellPlan } from "../../sandbox";
import { createLogger } from "../../logger";
import { getPathSeparator, isWindows, shellEscapeArg } from "../../platform";
import { persistToolOutputForRecovery } from "../../tool-output-recovery";
import type { ToolContext } from "../index";

const log = createLogger("ProcessTool");
const STREAM_DRAIN_GRACE_MS = 200;
const MAX_CAPTURED_OUTPUT_CHARS = 1_000_000;
const OUTPUT_HEAD_CHARS = 96_000;
const OUTPUT_TAIL_CHARS = 32_000;
const OUTPUT_APPEND_BATCH_CHARS = 256_000;

interface CollectedProcessOutput {
  content: string;
  recoveryPath?: string;
}

async function collectProcessOutput(
  stream: ReadableStream<Uint8Array>,
  exited: Promise<number>,
  options: { sessionId?: string; toolName: string; streamName: string }
): Promise<CollectedProcessOutput> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let head = "";
  let tail = "";
  let pendingAppend = "";
  let recoveryPath: string | undefined;
  const drainDeadline = exited.then(
    () => new Promise<"stop">((resolve) => setTimeout(() => resolve("stop"), STREAM_DRAIN_GRACE_MS))
  );

  const appendPending = async (): Promise<void> => {
    if (!recoveryPath || !pendingAppend) return;
    const pending = pendingAppend;
    pendingAppend = "";
    try {
      await appendFile(recoveryPath, pending, "utf8");
    } catch {
      recoveryPath = undefined;
    }
  };

  for (;;) {
    const next = await Promise.race([
      reader.read().then((result) => ({ kind: "read" as const, result })),
      drainDeadline.then(() => ({ kind: "stop" as const })),
    ]);
    if (next.kind === "stop") {
      await reader.cancel().catch(() => undefined);
      break;
    }
    if (next.result.done) break;
    const text = decoder.decode(next.result.value, { stream: true });
    if (!head) {
      output += text;
      if (output.length > MAX_CAPTURED_OUTPUT_CHARS) {
        recoveryPath = persistToolOutputForRecovery({
          content: output,
          sessionId: options.sessionId,
          toolName: `${options.toolName}-${options.streamName}`,
        });
        head = output.slice(0, OUTPUT_HEAD_CHARS);
        tail = output.slice(-OUTPUT_TAIL_CHARS);
        output = "";
      }
      continue;
    }

    tail = `${tail}${text}`.slice(-OUTPUT_TAIL_CHARS);
    if (recoveryPath) {
      pendingAppend += text;
      if (pendingAppend.length >= OUTPUT_APPEND_BATCH_CHARS) {
        await appendPending();
      }
    }
  }

  const finalText = decoder.decode();
  if (!head) {
    output += finalText;
    return { content: output };
  }
  if (finalText) {
    tail = `${tail}${finalText}`.slice(-OUTPUT_TAIL_CHARS);
    if (recoveryPath) pendingAppend += finalText;
  }
  await appendPending();
  const recoveryHint = recoveryPath
    ? `Full output saved to: ${recoveryPath}`
    : "Full output exceeded the in-memory limit and could not be saved.";
  return {
    content: `${head}\n[truncated: process output exceeded ${MAX_CAPTURED_OUTPUT_CHARS.toLocaleString()} characters]\n${recoveryHint}\n${tail}`,
    recoveryPath,
  };
}

interface CapturedProcessOptions {
  command: string[];
  displayCommand: string;
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutSeconds: number;
  signal?: AbortSignal;
  toolName: string;
  sessionId?: string;
}

interface CapturedProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  pid: number;
  timedOut: boolean;
  aborted: boolean;
}

async function runCapturedProcess(options: CapturedProcessOptions): Promise<CapturedProcessResult> {
  const proc = Bun.spawn(options.command, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });
  const key = String(proc.pid);
  let timedOut = false;
  let aborted = false;
  let forceKillTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const killProcess = (): void => {
    killSubprocessTree(proc);
    forceKillTimeoutId = setTimeout(() => killSubprocessTree(proc, "SIGKILL"), 750);
  };
  const abortHandler = (): void => {
    aborted = true;
    killProcess();
  };
  const timeoutId = setTimeout(() => {
    timedOut = true;
    killProcess();
  }, options.timeoutSeconds * 1000);
  if (options.signal?.aborted) {
    abortHandler();
  } else {
    options.signal?.addEventListener("abort", abortHandler, { once: true });
  }
  runningProcesses.set(key, {
    pid: proc.pid,
    command: options.displayCommand,
    startedAt: new Date(),
    proc,
  });

  try {
    const exitedPromise = proc.exited;
    const [stdout, stderr, exitCode] = await Promise.all([
      collectProcessOutput(proc.stdout, exitedPromise, {
        sessionId: options.sessionId,
        toolName: options.toolName,
        streamName: "stdout",
      }),
      collectProcessOutput(proc.stderr, exitedPromise, {
        sessionId: options.sessionId,
        toolName: options.toolName,
        streamName: "stderr",
      }),
      exitedPromise,
    ]);
    return {
      stdout: stdout.content,
      stderr: stderr.content,
      exitCode: exitCode ?? 0,
      pid: proc.pid,
      timedOut,
      aborted,
    };
  } finally {
    clearTimeout(timeoutId);
    if (forceKillTimeoutId) clearTimeout(forceKillTimeoutId);
    options.signal?.removeEventListener("abort", abortHandler);
    runningProcesses.delete(key);
  }
}

function expandTilde(path: string | undefined): string | undefined {
  if (!path) return path;
  if (path.startsWith("~")) {
    return path.replace(/^~/, homeDir);
  }
  return path;
}

export async function handleExec(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  output: string;
  exitCode: number;
  pid?: number;
  cwd?: string;
  sandboxProvider?: string;
}> {
  const command =
    typeof args.command === "string"
      ? (args.command as string).trim()
      : typeof args.cmd === "string"
        ? (args.cmd as string).trim()
        : "";
  const timeout = args.timeout as number | undefined;
  const workdir = expandTilde(args.workdir as string | undefined);
  const env = args.env as Record<string, string> | undefined;

  if (!command) {
    return {
      output:
        'Error: command is required. Provide a non-empty command string (for example: {"command":"ls -la"}).',
      exitCode: 2,
      cwd: workdir,
    };
  }

  if (workdir && !existsSync(workdir)) {
    return {
      output: `Error: Working directory does not exist: ${workdir}`,
      exitCode: 1,
      cwd: workdir,
    };
  }

  try {
    const fullEnv = { ...process.env, ...env };
    if (!isWindows() && !fullEnv.PATH?.split(getPathSeparator()).includes("/usr/sbin")) {
      fullEnv.PATH = ["/usr/sbin", fullEnv.PATH].filter(Boolean).join(getPathSeparator());
    }
    const timeoutSeconds =
      typeof timeout === "number" && Number.isFinite(timeout)
        ? Math.min(Math.max(timeout, 1), 300)
        : 30;

    let plan: ReturnType<typeof buildSandboxedShellPlan>;
    try {
      plan = buildSandboxedShellPlan({
        command,
        workdir: workdir || homeDir,
        env,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("Failed to build sandbox plan for exec", {
        cwd: workdir || homeDir,
        error: message,
      });
      return {
        output: `Error: ${message}`,
        exitCode: 1,
        cwd: workdir || homeDir,
      };
    }

    const startedAt = Date.now();
    log.info("Executing command", {
      cwd: plan.cwd,
      sandboxEnabled: plan.enabled,
      sandboxProvider: plan.provider || "host",
      timeoutSeconds: timeoutSeconds || null,
    });

    const spawnEnv =
      plan.provider === "podman" || plan.provider === "docker"
        ? { ...process.env, PATH: fullEnv.PATH }
        : fullEnv;
    if (args.background === true) {
      const proc = Bun.spawn(plan.command, {
        cwd: plan.cwd,
        env: spawnEnv,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: process.platform !== "win32",
      });
      const key = String(proc.pid);
      runningProcesses.set(key, { pid: proc.pid, command, startedAt: new Date(startedAt), proc });
      proc.unref();
      void proc.exited.finally(() => runningProcesses.delete(key));
      return {
        output: `Started background process ${proc.pid}.`,
        exitCode: 0,
        pid: proc.pid,
        cwd: plan.cwd,
        sandboxProvider: plan.provider || undefined,
      };
    }
    const captured = await runCapturedProcess({
      command: plan.command,
      displayCommand: command,
      cwd: plan.cwd,
      env: spawnEnv,
      timeoutSeconds,
      signal: context?.abortSignal,
      toolName: "exec",
      sessionId: context?.sessionId,
    });

    log.info("Command completed", {
      cwd: plan.cwd,
      sandboxProvider: plan.provider || "host",
      exitCode: captured.exitCode,
      durationMs: Date.now() - startedAt,
      timedOut: captured.timedOut,
      aborted: captured.aborted,
    });

    const statusOutput = captured.timedOut
      ? `\nCommand timed out after ${timeoutSeconds} second${timeoutSeconds === 1 ? "" : "s"}.`
      : captured.aborted
        ? "\nCommand interrupted."
        : "";
    return {
      output: captured.stdout + (captured.stderr ? "\n" + captured.stderr : "") + statusOutput,
      exitCode: captured.aborted ? 130 : captured.timedOut ? 124 : captured.exitCode,
      pid: captured.pid,
      cwd: plan.cwd,
      sandboxProvider: plan.provider || undefined,
    };
  } catch (error) {
    const err = error as { message?: string };
    log.exception("Command execution failed", error, {
      cwd: workdir || homeDir,
    });
    return {
      output: err.message || "Command failed",
      exitCode: 1,
    };
  }
}

export async function handleExecAsync(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ pid: number; output: string; exitCode: number; sandboxProvider?: string }> {
  const command =
    typeof args.command === "string"
      ? (args.command as string).trim()
      : typeof args.cmd === "string"
        ? (args.cmd as string).trim()
        : "";
  const workdir = expandTilde(args.workdir as string | undefined);

  if (!command) {
    return {
      pid: 0,
      output:
        'Error: command is required. Provide a non-empty command string (for example: {"command":"ls -la"}).',
      exitCode: 2,
    };
  }

  let plan: ReturnType<typeof buildSandboxedShellPlan>;
  try {
    plan = buildSandboxedShellPlan({
      command,
      workdir: workdir || homeDir,
      env: {},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("Failed to build sandbox plan for async exec", {
      cwd: workdir || homeDir,
      error: message,
    });
    return {
      pid: 0,
      output: `Error: ${message}`,
      exitCode: 1,
    };
  }

  log.info("Executing async command", {
    cwd: plan.cwd,
    sandboxEnabled: plan.enabled,
    sandboxProvider: plan.provider || "host",
  });

  const captured = await runCapturedProcess({
    command: plan.command,
    displayCommand: command,
    cwd: plan.cwd,
    env: { ...process.env },
    timeoutSeconds: 300,
    signal: context?.abortSignal,
    toolName: "exec-async",
    sessionId: context?.sessionId,
  });
  log.info("Async command completed", {
    cwd: plan.cwd,
    sandboxProvider: plan.provider || "host",
    exitCode: captured.exitCode,
    timedOut: captured.timedOut,
    aborted: captured.aborted,
  });

  return {
    pid: captured.pid,
    output:
      captured.stdout +
      (captured.stderr ? "\n" + captured.stderr : "") +
      (captured.timedOut ? "\nCommand timed out after 300 seconds." : "") +
      (captured.aborted ? "\nCommand interrupted." : ""),
    exitCode: captured.aborted ? 130 : captured.timedOut ? 124 : captured.exitCode,
    sandboxProvider: plan.provider || undefined,
  };
}

type RunningProcess = {
  pid: number;
  command: string;
  startedAt: Date;
  proc: Bun.Subprocess;
};
const runningProcesses = new Map<string, RunningProcess>();

type ProcessSignal = Parameters<Bun.Subprocess["kill"]>[0];

function killSubprocessTree(proc: Bun.Subprocess, signal: ProcessSignal = "SIGTERM"): void {
  if (process.platform === "win32") {
    try {
      Bun.spawn(["taskkill", "/pid", String(proc.pid), "/t", "/f"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return;
    } catch {
      void 0;
    }
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      void 0;
    }
  }

  try {
    proc.kill(signal);
  } catch {
    void 0;
  }
}

export async function handleProcess(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;

  switch (action) {
    case "list": {
      return Array.from(runningProcesses.values()).map((p) => ({
        sessionId: p.pid.toString(),
        command: p.command,
        startedAt: p.startedAt.toISOString(),
      }));
    }
    case "kill": {
      const sessionId = args.sessionId as string;
      if (!sessionId) throw new Error("sessionId required for kill action");
      const entry = runningProcesses.get(sessionId);
      if (!entry) {
        return { success: false, error: `No running process with id ${sessionId}` };
      }
      try {
        killSubprocessTree(entry.proc);
      } catch (error) {
        log.warn("Failed to kill process", { sessionId, error: String(error) });
      }
      runningProcesses.delete(sessionId);
      return { success: true, pid: entry.pid };
    }
    case "status": {
      const sessionId = args.sessionId as string;
      if (!sessionId) throw new Error("sessionId required for status action");
      const entry = runningProcesses.get(sessionId);
      return entry
        ? {
            running: true,
            pid: entry.pid,
            command: entry.command,
            startedAt: entry.startedAt.toISOString(),
          }
        : { running: false };
    }
    default:
      throw new Error(`Unknown process action: ${action}`);
  }
}

export async function handleGit(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ output: string; exitCode: number; sandboxProvider?: string }> {
  let command = (args.command as string | undefined)?.trim();
  const workdir = expandTilde(args.workdir as string | undefined);

  if (!command) {
    throw new Error("Git command is required");
  }

  if (command.startsWith("git ")) {
    command = command.slice(4).trim();
  }

  const segments = command
    .match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g)
    ?.map((token) =>
      token.startsWith('"') && token.endsWith('"')
        ? token.slice(1, -1)
        : token.startsWith("'") && token.endsWith("'")
          ? token.slice(1, -1)
          : token
    )
    .filter(Boolean);

  if (!segments || segments.length === 0) {
    throw new Error("Git command is required");
  }

  if (workdir && !existsSync(workdir)) {
    return {
      output: `Error: Working directory does not exist: ${workdir}`,
      exitCode: 1,
    };
  }

  const gitCommand = `git ${segments.map((segment) => shellEscapeArg(segment)).join(" ")}`;
  let plan: ReturnType<typeof buildSandboxedShellPlan>;
  try {
    plan = buildSandboxedShellPlan({
      command: gitCommand,
      workdir: workdir || homeDir,
      env: {},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("Failed to build sandbox plan for git", {
      cwd: workdir || homeDir,
      error: message,
    });
    return {
      output: `Error: ${message}`,
      exitCode: 1,
    };
  }

  const startedAt = Date.now();
  log.info("Executing git command", {
    cwd: plan.cwd,
    sandboxEnabled: plan.enabled,
    sandboxProvider: plan.provider || "host",
  });

  const timeout = args.timeout as number | undefined;
  const timeoutSeconds =
    typeof timeout === "number" && Number.isFinite(timeout)
      ? Math.min(Math.max(timeout, 1), 300)
      : 60;
  const baseEnv =
    plan.provider === "podman" || plan.provider === "docker"
      ? { ...process.env, PATH: process.env.PATH }
      : { ...process.env };
  const captured = await runCapturedProcess({
    command: plan.command,
    displayCommand: gitCommand,
    cwd: plan.cwd,
    env: {
      ...baseEnv,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
    },
    timeoutSeconds,
    signal: context?.abortSignal,
    toolName: "git",
    sessionId: context?.sessionId,
  });

  log.info("Git command completed", {
    cwd: plan.cwd,
    sandboxProvider: plan.provider || "host",
    exitCode: captured.exitCode,
    durationMs: Date.now() - startedAt,
    timedOut: captured.timedOut,
    aborted: captured.aborted,
  });
  const statusOutput = captured.timedOut
    ? `\nGit command timed out after ${timeoutSeconds} second${timeoutSeconds === 1 ? "" : "s"}.`
    : captured.aborted
      ? "\nGit command interrupted."
      : "";
  return {
    output: captured.stdout + (captured.stderr ? "\n" + captured.stderr : "") + statusOutput,
    exitCode: captured.aborted ? 130 : captured.timedOut ? 124 : captured.exitCode,
    sandboxProvider: plan.provider || undefined,
  };
}
