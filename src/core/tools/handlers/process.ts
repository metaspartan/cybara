import { existsSync } from "fs";
import { homeDir } from "../../paths";
import { buildSandboxedShellPlan } from "../../sandbox";
import { createLogger } from "../../logger";
import { getPathSeparator, isWindows } from "../../platform";
import type { ToolContext } from "../index";

const log = createLogger("ProcessTool");

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
): Promise<{ output: string; exitCode: number; cwd?: string; sandboxProvider?: string }> {
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
        : undefined;

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
    const proc = Bun.spawn(plan.command, {
      cwd: plan.cwd,
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
      detached: process.platform !== "win32",
    });
    const key = String(proc.pid);
    let timedOut = false;
    let aborted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const killProcess = () => {
      killSubprocessTree(proc);
      forceKillTimeoutId = setTimeout(() => killSubprocessTree(proc, "SIGKILL"), 750);
    };
    const abortHandler = () => {
      aborted = true;
      killProcess();
    };
    if (timeoutSeconds) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        killProcess();
      }, timeoutSeconds * 1000);
    }
    if (context?.abortSignal?.aborted) {
      abortHandler();
    } else {
      context?.abortSignal?.addEventListener("abort", abortHandler, { once: true });
    }
    runningProcesses.set(key, { pid: proc.pid, command, startedAt: new Date(startedAt), proc });

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const [stdoutText, stderrText, exited] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      stdout = stdoutText;
      stderr = stderrText;
      exitCode = exited ?? 0;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillTimeoutId) clearTimeout(forceKillTimeoutId);
      context?.abortSignal?.removeEventListener("abort", abortHandler);
      runningProcesses.delete(key);
    }

    log.info("Command completed", {
      cwd: plan.cwd,
      sandboxProvider: plan.provider || "host",
      exitCode,
      durationMs: Date.now() - startedAt,
      timedOut,
      aborted,
    });

    const statusOutput = timedOut
      ? `\nCommand timed out after ${timeoutSeconds} second${timeoutSeconds === 1 ? "" : "s"}.`
      : aborted
        ? "\nCommand interrupted."
        : "";
    return {
      output: stdout + (stderr ? "\n" + stderr : "") + statusOutput,
      exitCode: aborted ? 130 : timedOut ? 124 : exitCode,
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
  args: Record<string, unknown>
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

  const proc = Bun.spawn(plan.command, {
    cwd: plan.cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });

  // Register the live handle so `process` list/status/kill can see and terminate
  // it while it runs. `await proc.exited` yields the event loop, so a concurrent
  // `process({action:"kill"})` call can run and actually kill it.
  const key = String(proc.pid);
  runningProcesses.set(key, { pid: proc.pid, command, startedAt: new Date(), proc });
  try {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    log.info("Async command completed", {
      cwd: plan.cwd,
      sandboxProvider: plan.provider || "host",
      exitCode,
    });

    return {
      pid: proc.pid,
      output: stdout + (stderr ? "\n" + stderr : ""),
      exitCode,
      sandboxProvider: plan.provider || undefined,
    };
  } finally {
    runningProcesses.delete(key);
  }
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
    } catch {}
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {}
  }

  try {
    proc.kill(signal);
  } catch {}
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
      // Actually terminate the process — the previous implementation only
      // removed the map entry, leaving the process running.
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
  args: Record<string, unknown>
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

  const shellEscape = (value: string): string => {
    if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value;
    return "'" + value.split("'").join("'\"'\"'") + "'";
  };

  const gitCommand = `git ${segments.map(shellEscape).join(" ")}`;
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

  const result = Bun.spawnSync(plan.command, {
    cwd: plan.cwd,
    env:
      plan.provider === "podman" || plan.provider === "docker"
        ? { ...process.env, PATH: process.env.PATH }
        : { ...process.env },
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  log.info("Git command completed", {
    cwd: plan.cwd,
    sandboxProvider: plan.provider || "host",
    exitCode: result.exitCode ?? 0,
    durationMs: Date.now() - startedAt,
  });
  return {
    output: stdout + (stderr ? "\n" + stderr : ""),
    exitCode: result.exitCode ?? 0,
    sandboxProvider: plan.provider || undefined,
  };
}
