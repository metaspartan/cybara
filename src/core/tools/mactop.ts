export type MactopSampleResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function normalizeMactopSampleCount(value: unknown, fallback = 3, max = 10): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(parsed)), max);
}

export function macToolEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    PATH: `/usr/sbin:${process.env.PATH || ""}`,
  };
}

export function hasMactopBinary(): boolean {
  try {
    const result = Bun.spawnSync(["which", "mactop"], {
      stdout: "ignore",
      stderr: "ignore",
      env: macToolEnv(),
    });
    return (result.exitCode ?? 1) === 0;
  } catch {
    return false;
  }
}

export function runMactopJsonSamples(count: number): MactopSampleResult {
  const safeCount = normalizeMactopSampleCount(count);
  const result = Bun.spawnSync(
    ["mactop", "--headless", "--count", String(safeCount), "--format", "json"],
    {
      timeout: (safeCount + 5) * 1000,
      env: macToolEnv(),
    }
  );

  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export function collectMacSystemFallback(): {
  source: "system_fallback";
  cpu: { model: string; cores: string };
  memory: string;
} {
  const env = macToolEnv();
  const cpuInfo = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.brand_string"], { env })
    .stdout.toString()
    .trim();
  const coreCount = Bun.spawnSync(["sysctl", "-n", "machdep.cpu.core_count"], { env })
    .stdout.toString()
    .trim();
  const memory = Bun.spawnSync(["vm_stat"], { env })
    .stdout.toString()
    .trim()
    .split("\n")
    .slice(0, 5)
    .join("\n");

  return {
    source: "system_fallback",
    cpu: { model: cpuInfo, cores: coreCount },
    memory,
  };
}
