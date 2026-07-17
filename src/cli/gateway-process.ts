import { closeSync, mkdirSync, openSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface GatewayBackgroundProcess {
  logPath: string;
  pid: number;
}

interface GatewaySpawnOptions {
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
  stdin: "ignore" | "inherit";
  stdout: "inherit" | number;
  stderr: "inherit" | number;
}

interface GatewaySubprocess {
  pid: number;
  exited: Promise<number>;
  unref(): void;
}

interface GatewayProcessDependencies {
  closeLog?: (descriptor: number) => void;
  openLog?: (path: string) => number;
  spawn?: (command: string[], options: GatewaySpawnOptions) => GatewaySubprocess;
}

function spawnGateway(command: string[], options: GatewaySpawnOptions): GatewaySubprocess {
  const child = Bun.spawn(command, options);
  return {
    pid: child.pid,
    exited: child.exited,
    unref: () => child.unref(),
  };
}

export function resolveGatewayLogPath(): string {
  const base = process.env.CYBARA_HOME || join(process.env.HOME || homedir(), ".cybara");
  const dir = join(base, "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, "gateway.out.log");
}

export function startGatewayBackground(
  dependencies: GatewayProcessDependencies = {}
): GatewayBackgroundProcess {
  const logPath = resolveGatewayLogPath();
  const closeLog = dependencies.closeLog ?? closeSync;
  const openLog = dependencies.openLog ?? ((path: string) => openSync(path, "a"));
  const spawn = dependencies.spawn ?? spawnGateway;
  const logFd = openLog(logPath);
  try {
    const child = spawn(["bun", "run", "dev"], {
      env: { ...process.env, CYBARA_GATEWAY_LOG_CAPTURE: "0" },
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
      detached: true,
    });
    child.unref();
    return { logPath, pid: child.pid };
  } finally {
    closeLog(logFd);
  }
}

export async function runGatewayForeground(
  dependencies: GatewayProcessDependencies = {}
): Promise<number> {
  const spawn = dependencies.spawn ?? spawnGateway;
  const child = spawn(["bun", "run", "dev"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}
