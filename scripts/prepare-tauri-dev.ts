import { $ } from "bun";

const PORT = 4269;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parsePidSet(raw: string): number[] {
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    )
  );
}

async function listPortPids(port: number): Promise<number[]> {
  if (process.platform === "win32") {
    try {
      const output = await $`netstat -ano -p tcp`.text();
      const pids = new Set<number>();
      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const localAddress = parts[1] || "";
        const state = (parts[3] || "").toUpperCase();
        const pid = Number.parseInt(parts[4] || "", 10);
        if (!localAddress.endsWith(`:${port}`)) continue;
        if (state !== "LISTENING") continue;
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
      return Array.from(pids);
    } catch {
      return [];
    }
  }

  try {
    const output = await $`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`.text();
    return parsePidSet(output);
  } catch {
    return [];
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function killPortListeners(port: number): Promise<void> {
  const pids = await listPortPids(port);
  if (pids.length === 0) {
    console.log(`[tauri:dev] Port ${port} is free`);
    return;
  }

  console.log(`[tauri:dev] Releasing port ${port} from PID(s): ${pids.join(", ")}`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  await sleep(500);

  for (const pid of pids) {
    if (!isPidAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  await sleep(100);

  const remaining = await listPortPids(port);
  if (remaining.length > 0) {
    throw new Error(`Port ${port} is still in use by PID(s): ${remaining.join(", ")}`);
  }

  console.log(`[tauri:dev] Port ${port} is now free`);
}

async function main(): Promise<void> {
  await killPortListeners(PORT);
}

await main();
