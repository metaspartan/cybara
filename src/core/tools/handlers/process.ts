import { existsSync } from "fs";
import { homeDir } from "../../paths";

function expandTilde(path: string | undefined): string | undefined {
  if (!path) return path;
  if (path.startsWith("~")) {
    return path.replace(/^~/, homeDir);
  }
  return path;
}

export async function handleExec(
  args: Record<string, unknown>
): Promise<{ output: string; exitCode: number; cwd?: string }> {
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

    const result = Bun.spawnSync(["sh", "-c", command], {
      cwd: workdir || homeDir,
      env: fullEnv,
      timeout: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
    });

    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();

    return {
      output: stdout + (stderr ? "\n" + stderr : ""),
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    const err = error as { message?: string };
    return {
      output: err.message || "Command failed",
      exitCode: 1,
    };
  }
}

export async function handleExecAsync(
  args: Record<string, unknown>
): Promise<{ pid: number; output: string; exitCode: number }> {
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

  const proc = Bun.spawn(["sh", "-c", command], {
    cwd: workdir || homeDir,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    pid: proc.pid,
    output: stdout + (stderr ? "\n" + stderr : ""),
    exitCode,
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
): Promise<{ output: string; exitCode: number }> {
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

  const result = Bun.spawnSync(["git", ...segments], {
    cwd: workdir || homeDir,
    env: { ...process.env },
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  return {
    output: stdout + (stderr ? "\n" + stderr : ""),
    exitCode: result.exitCode ?? 0,
  };
}
