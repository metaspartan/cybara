import { mkdir, rename, rm } from "fs/promises";
import { dirname } from "path";

interface PersistedValue<T> {
  version: number;
  at: number;
  value: T;
}

export interface PersistentStaleValueOptions<T> {
  filePath: string;
  ttlMs: number;
  version: number;
  compute: () => Promise<T> | T;
  isValue: (value: unknown) => value is T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePersistedValue<T>(
  value: unknown,
  version: number,
  isValue: (candidate: unknown) => candidate is T
): PersistedValue<T> | null {
  if (!isRecord(value) || value.version !== version || typeof value.at !== "number") return null;
  if (!Number.isFinite(value.at) || !isValue(value.value)) return null;
  return { version, at: value.at, value: value.value };
}

async function readPersistedValue<T>(
  options: PersistentStaleValueOptions<T>
): Promise<PersistedValue<T> | null> {
  try {
    const file = Bun.file(options.filePath);
    if (!(await file.exists())) return null;
    const parsed: unknown = await file.json();
    return parsePersistedValue(parsed, options.version, options.isValue);
  } catch {
    return null;
  }
}

async function writePersistedValue<T>(filePath: string, record: PersistedValue<T>): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await Bun.write(temporaryPath, JSON.stringify(record));
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export function createPersistentStaleValue<T>(
  options: PersistentStaleValueOptions<T>
): () => Promise<T> {
  let cached: PersistedValue<T> | null = null;
  let loadTask: Promise<PersistedValue<T> | null> | null = null;
  let refreshTask: Promise<T> | null = null;

  const refresh = (): Promise<T> => {
    if (refreshTask) return refreshTask;
    const task = Promise.resolve()
      .then(options.compute)
      .then(async (value) => {
        const record = { version: options.version, at: Date.now(), value };
        cached = record;
        await writePersistedValue(options.filePath, record).catch(() => {});
        return value;
      })
      .finally(() => {
        if (refreshTask === task) refreshTask = null;
      });
    refreshTask = task;
    return task;
  };

  return async (): Promise<T> => {
    const now = Date.now();
    if (cached && now - cached.at < options.ttlMs) return cached.value;
    if (cached) {
      refresh().catch(() => {});
      return cached.value;
    }

    loadTask ??= readPersistedValue(options);
    const persisted = await loadTask;
    if (persisted) {
      cached = persisted;
      if (now - persisted.at >= options.ttlMs) refresh().catch(() => {});
      return persisted.value;
    }
    return refresh();
  };
}
