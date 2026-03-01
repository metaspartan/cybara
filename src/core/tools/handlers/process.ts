import { existsSync } from "fs";
import { homeDir } from "../../paths";
import { buildSandboxedShellPlan } from "../../sandbox";
import { createLogger } from "../../logger";

const log = createLogger("ProcessTool");

function expandTilde(path: string | undefined): string | undefined {
  if (!path) return path;
  if (path.startsWith("~")) {
    return path.replace(/^~/, homeDir);
  }
  return path;
}

export async function handleExec(
  args: Record<string, unknown>
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
    if (!fullEnv.PATH?.includes("/usr/sbin")) {
      fullEnv.PATH = "/usr/sbin:" + fullEnv.PATH;
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
    const result = Bun.spawnSync(plan.command, {
      cwd: plan.cwd,
      env: spawnEnv,
      timeout: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    log.info("Command completed", {
      cwd: plan.cwd,
      sandboxProvider: plan.provider || "host",
      exitCode: result.exitCode ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return {
      output: stdout + (stderr ? "\n" + stderr : ""),
      exitCode: result.exitCode ?? 0,
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
  });

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
}

const runningProcesses = new Map<string, { pid: number; command: string; startedAt: Date }>();

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
      runningProcesses.delete(sessionId);
      return { success: true };
    }
    case "status": {
      const sessionId = args.sessionId as string;
      if (!sessionId) throw new Error("sessionId required for status action");
      const proc = runningProcesses.get(sessionId);
      return proc ? { running: true, ...proc } : { running: false };
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
