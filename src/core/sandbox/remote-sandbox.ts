import { Sandbox, CommandExitError } from "e2b";
import { config } from "../config";

export interface RemoteSandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxId?: string;
}

export interface RemoteSandboxOptions {
  timeoutMs?: number;
  cwd?: string;
  envs?: Record<string, string>;
}

export function isRemoteSandboxConfigured(): boolean {
  const runtime = config.getSandboxRuntime();
  return typeof runtime.remoteUrl === "string" && runtime.remoteUrl.trim().length > 0;
}

function normalizeDomain(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

export async function runInRemoteSandbox(
  command: string,
  options: RemoteSandboxOptions = {}
): Promise<RemoteSandboxResult> {
  const runtime = config.getSandboxRuntime();
  const rawUrl = runtime.remoteUrl?.trim();
  if (!rawUrl) {
    throw new Error(
      "Remote sandbox URL is not configured. Set it under Settings → Command Sandbox → Remote sandbox."
    );
  }
  const apiKey = runtime.remoteApiKey?.trim() || process.env.E2B_API_KEY || undefined;
  const timeoutMs = Math.min(Math.max(5000, options.timeoutMs ?? 120_000), 600_000);

  const sandbox = await Sandbox.create({
    domain: normalizeDomain(rawUrl),
    apiKey,
    timeoutMs,
  });
  const sandboxId = (sandbox as { sandboxId?: string }).sandboxId;

  try {
    const result = await sandbox.commands.run(command, {
      cwd: options.cwd,
      envs: options.envs,
      timeoutMs,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: typeof result.exitCode === "number" ? result.exitCode : 0,
      sandboxId,
    };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
        sandboxId,
      };
    }
    throw error;
  } finally {
    try {
      await sandbox.kill();
    } catch {
      /* best-effort teardown */
    }
  }
}
