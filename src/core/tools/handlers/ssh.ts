import { copySshFile, runSshCommand } from "../../ssh/ssh-client";
import type { ToolContext } from "../index";

const MAX_OUTPUT_CHARS = 200_000;
const OUTPUT_HEAD_CHARS = 96_000;
const OUTPUT_TAIL_CHARS = 32_000;

function readStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readNumberArg(args: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.floor(value));
    }
  }
  return fallback;
}

function formatCommandOutput(stdout: string, stderr: string): string {
  const combined = stderr ? `${stdout}\n${stderr}` : stdout;
  if (combined.length <= MAX_OUTPUT_CHARS) return combined;
  const head = combined.slice(0, OUTPUT_HEAD_CHARS);
  const tail = combined.slice(-OUTPUT_TAIL_CHARS);
  return `${head}\n... [output truncated] ...\n${tail}`;
}

export async function handleSsh(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const host = readStringArg(args, ["host"]);
  const username = readStringArg(args, ["username", "user"]);
  const password = readStringArg(args, ["password", "pass"]);
  const command = readStringArg(args, ["command", "cmd"]);
  if (!host || !username || !password || !command) {
    return {
      error:
        'host, username, password, and command are required. Example: ssh {host: "192.168.1.226", username: "ghost", password: "...", command: "nvidia-smi"}',
    };
  }
  const port = readNumberArg(args, ["port"], 22);
  const timeoutSeconds = readNumberArg(args, ["timeout_seconds", "timeout"], 60);
  const strictHostKey = args.strict_host_key === true;
  try {
    const result = await runSshCommand(
      { host, port, username, password, strictHostKey },
      { command, timeoutMs: timeoutSeconds * 1000, abortSignal: context?.abortSignal }
    );
    if (result.timedOut) {
      return { output: "Command timed out.", exit_code: null, timed_out: true, host, username };
    }
    return {
      output: formatCommandOutput(result.stdout, result.stderr),
      exit_code: result.exitCode,
      timed_out: false,
      host,
      username,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleScp(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const host = readStringArg(args, ["host"]);
  const username = readStringArg(args, ["username", "user"]);
  const password = readStringArg(args, ["password", "pass"]);
  const localPath = readStringArg(args, ["local_path"]);
  const remotePath = readStringArg(args, ["remote_path"]);
  const direction =
    args.direction === "download" ? "download" : args.direction === "upload" ? "upload" : undefined;
  if (!host || !username || !password || !localPath || !remotePath || !direction) {
    return {
      error:
        "host, username, password, direction (upload|download), local_path, and remote_path are required",
    };
  }
  const port = readNumberArg(args, ["port"], 22);
  const timeoutSeconds = readNumberArg(args, ["timeout_seconds", "timeout"], 120);
  const strictHostKey = args.strict_host_key === true;
  try {
    const result = await copySshFile(
      { host, port, username, password, strictHostKey },
      {
        direction,
        localPath,
        remotePath,
        timeoutMs: timeoutSeconds * 1000,
        abortSignal: context?.abortSignal,
      }
    );
    return {
      transferred: true,
      direction,
      local_path: localPath,
      remote_path: remotePath,
      bytes: result.bytes,
      host,
      username,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
