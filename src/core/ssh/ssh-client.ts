import { stat } from "fs/promises";
import type { Client, ClientChannel, ConnectConfig, SFTPWrapper } from "ssh2";

export interface SshConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  strictHostKey?: boolean;
  readyTimeoutMs?: number;
}

export interface SshCommandOptions {
  command: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface SshCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface SshCopyOptions {
  direction: "upload" | "download";
  localPath: string;
  remotePath: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface SshCopyResult {
  bytes: number | null;
}

const DEFAULT_SSH_PORT = 22;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const MAX_CAPTURE_BYTES = 1_000_000;

interface CapturedText {
  text: string;
  full: boolean;
}

function appendCaptured(chunk: Buffer, target: CapturedText): void {
  if (target.full) return;
  const next = `${target.text}${chunk.toString("utf8")}`;
  if (next.length > MAX_CAPTURE_BYTES) {
    target.text = next.slice(0, MAX_CAPTURE_BYTES);
    target.full = true;
  } else {
    target.text = next;
  }
}

function buildConnectConfig(connection: SshConnectionOptions): ConnectConfig {
  return {
    host: connection.host,
    port: connection.port ?? DEFAULT_SSH_PORT,
    username: connection.username,
    password: connection.password,
    readyTimeout: connection.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    keepaliveInterval: 15_000,
    hostVerifier: connection.strictHostKey === true ? undefined : () => true,
  };
}

function runCommandViaClient(
  client: Client,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (execError: Error | undefined, stream: ClientChannel) => {
      if (execError) {
        reject(execError);
        return;
      }
      const stdout: CapturedText = { text: "", full: false };
      const stderr: CapturedText = { text: "", full: false };
      stream.on("data", (chunk: Buffer) => appendCaptured(chunk, stdout));
      stream.stderr.on("data", (chunk: Buffer) => appendCaptured(chunk, stderr));
      stream.on("close", (exitCode: number) => {
        resolve({ stdout: stdout.text, stderr: stderr.text, exitCode: exitCode ?? null });
      });
      stream.on("error", reject);
    });
  });
}

export async function runSshCommand(
  connection: SshConnectionOptions,
  options: SshCommandOptions
): Promise<SshCommandResult> {
  const { Client } = await import("ssh2");
  const client = new Client();
  const deadlineMs = options.timeoutMs ?? 60_000;
  let settled = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = (): void => {
    if (settled) return;
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    client.destroy();
  };
  options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await new Promise<SshCommandResult>((resolve, reject) => {
      const finish = (result: SshCommandResult): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(result);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        reject(error);
      };
      timeoutTimer = setTimeout(() => {
        client.destroy();
        finish({ stdout: "", stderr: "", exitCode: null, timedOut: true });
      }, deadlineMs);
      client.on("ready", () => {
        void runCommandViaClient(client, options.command).then(
          (result) => finish({ ...result, timedOut: false }),
          (error: unknown) => fail(error)
        );
      });
      client.on("error", (error: Error) => fail(error));
      client.on("close", () => {
        if (!settled) fail(new Error("SSH connection closed before the command completed"));
      });
      client.connect(buildConnectConfig(connection));
    });
  } finally {
    options.abortSignal?.removeEventListener("abort", onAbort);
    client.end();
  }
}

function sftpStat(sftp: SFTPWrapper, path: string): Promise<{ size: number }> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (error: Error | undefined, attrs?: { size: number }) => {
      if (error || !attrs) {
        reject(error ?? new Error("stat failed"));
        return;
      }
      resolve({ size: attrs.size });
    });
  });
}

async function measureTransferBytes(
  direction: "upload" | "download",
  path: string,
  sftp: SFTPWrapper
): Promise<number | null> {
  try {
    if (direction === "upload") {
      const remote = await sftpStat(sftp, path);
      return remote.size;
    }
    const local = await stat(path);
    return local.size;
  } catch {
    return null;
  }
}

export async function copySshFile(
  connection: SshConnectionOptions,
  options: SshCopyOptions
): Promise<SshCopyResult> {
  const { Client } = await import("ssh2");
  const client = new Client();
  const timeoutMs = options.timeoutMs ?? 60_000;
  let settled = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = (): void => {
    if (settled) return;
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    client.destroy();
  };
  options.abortSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await new Promise<SshCopyResult>((resolve, reject) => {
      const finish = (result: SshCopyResult): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(result);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        reject(error);
      };
      timeoutTimer = setTimeout(() => {
        client.destroy();
        fail(new Error("SSH file transfer timed out"));
      }, timeoutMs);
      client.on("ready", () => {
        client.sftp((sftpError: Error | undefined, sftp: SFTPWrapper | undefined) => {
          if (sftpError || !sftp) {
            fail(sftpError ?? new Error("SFTP subsystem unavailable"));
            return;
          }
          const callback = (transferError?: Error | null): void => {
            if (transferError) {
              fail(transferError);
              return;
            }
            const bytePath =
              options.direction === "upload" ? options.remotePath : options.localPath;
            void measureTransferBytes(options.direction, bytePath, sftp).then(
              (bytes) => finish({ bytes }),
              () => finish({ bytes: null })
            );
          };
          if (options.direction === "upload") {
            sftp.fastPut(options.localPath, options.remotePath, callback);
          } else {
            sftp.fastGet(options.remotePath, options.localPath, callback);
          }
        });
      });
      client.on("error", (error: Error) => fail(error));
      client.connect(buildConnectConfig(connection));
    });
  } finally {
    options.abortSignal?.removeEventListener("abort", onAbort);
    client.end();
  }
}
