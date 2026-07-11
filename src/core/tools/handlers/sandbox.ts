import { isRemoteSandboxConfigured, runInRemoteSandbox } from "../../sandbox/remote-sandbox";

export async function handleSandboxRun(args: Record<string, unknown>): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxId?: string;
  error?: string;
}> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) {
    return { ok: false, stdout: "", stderr: "", exitCode: 1, error: "command is required" };
  }
  if (!isRemoteSandboxConfigured()) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: 1,
      error:
        "No remote sandbox configured. Set a URL under Settings → Command Sandbox → Remote sandbox (CubeSandbox / E2B-compatible).",
    };
  }

  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : undefined;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : undefined;
  const envs =
    args.envs && typeof args.envs === "object" && !Array.isArray(args.envs)
      ? Object.fromEntries(
          Object.entries(args.envs as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value),
          ])
        )
      : undefined;

  try {
    const result = await runInRemoteSandbox(command, { cwd, timeoutMs, envs });
    return {
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      sandboxId: result.sandboxId,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
