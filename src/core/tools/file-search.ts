import { Worker } from "node:worker_threads";
import { ConcurrencyLimiter } from "../concurrency-limiter";

const DEFAULT_MAX_ENTRIES = 250_000;
const DEFAULT_MAX_RESULTS = 1_000;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_TIMEOUT_MS = 10_000;
const fileSearchConcurrency = new ConcurrencyLimiter(2);

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { opendir } = require("node:fs/promises");
const { join, relative } = require("node:path");

const matcher = new Bun.Glob(workerData.pattern);
const ignoredDirectories = new Set(workerData.ignoredDirectories);

async function search() {
  const stack = [{ path: workerData.cwd, depth: 0 }];
  let matched = 0;
  let visitedEntries = 0;
  let limitReached = false;

  while (stack.length > 0 && matched < workerData.maxResults) {
    const current = stack.pop();
    if (!current) break;

    let directory;
    try {
      directory = await opendir(current.path);
    } catch {
      continue;
    }

    try {
      for await (const entry of directory) {
        visitedEntries += 1;
        if (visitedEntries > workerData.maxEntries) {
          limitReached = true;
          break;
        }
        if (entry.isSymbolicLink()) continue;

        const fullPath = join(current.path, entry.name);
        if (entry.isDirectory()) {
          if (
            current.depth < workerData.maxDepth &&
            !ignoredDirectories.has(entry.name)
          ) {
            stack.push({ path: fullPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile()) continue;

        const relativePath = relative(workerData.cwd, fullPath).replaceAll("\\\\", "/");
        if (!matcher.match(relativePath)) continue;

        matched += 1;
        parentPort.postMessage({ type: "match", file: relativePath });
        if (matched >= workerData.maxResults) {
          limitReached = true;
          break;
        }
      }
    } catch {
      continue;
    }

    if (limitReached) break;
  }

  parentPort.postMessage({ type: "done", visitedEntries, limitReached });
}

search().catch((error) => {
  parentPort.postMessage({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
});
`;

interface FileSearchWorkerData {
  cwd: string;
  pattern: string;
  maxEntries: number;
  maxResults: number;
  maxDepth: number;
  ignoredDirectories: string[];
}

interface FileSearchMatchMessage {
  type: "match";
  file: string;
}

interface FileSearchDoneMessage {
  type: "done";
  visitedEntries: number;
  limitReached: boolean;
}

interface FileSearchErrorMessage {
  type: "error";
  error: string;
}

type FileSearchWorkerMessage =
  | FileSearchMatchMessage
  | FileSearchDoneMessage
  | FileSearchErrorMessage;

export interface FileSearchOptions {
  cwd: string;
  pattern: string;
  signal?: AbortSignal;
  maxEntries?: number;
  maxResults?: number;
  maxDepth?: number;
  timeoutMs?: number;
}

export interface FileSearchResult {
  files: string[];
  visitedEntries: number;
  limitReached: boolean;
  timedOut: boolean;
  aborted: boolean;
  elapsedMs: number;
  error?: string;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export async function searchFiles(options: FileSearchOptions): Promise<FileSearchResult> {
  const startedAt = Date.now();
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxResults = positiveInteger(options.maxResults, DEFAULT_MAX_RESULTS);
  const maxDepth = positiveInteger(options.maxDepth, DEFAULT_MAX_DEPTH);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  if (options.signal?.aborted) {
    return {
      files: [],
      visitedEntries: 0,
      limitReached: false,
      timedOut: false,
      aborted: true,
      elapsedMs: 0,
    };
  }

  const release = await fileSearchConcurrency.acquire(options.signal, timeoutMs);
  if (!release) {
    return {
      files: [],
      visitedEntries: 0,
      limitReached: false,
      timedOut: options.signal?.aborted !== true,
      aborted: options.signal?.aborted === true,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const remainingTimeoutMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  try {
    return await runFileSearchWorker(options, startedAt, remainingTimeoutMs, {
      maxEntries,
      maxResults,
      maxDepth,
    });
  } finally {
    release();
  }
}

async function runFileSearchWorker(
  options: FileSearchOptions,
  startedAt: number,
  timeoutMs: number,
  limits: { maxEntries: number; maxResults: number; maxDepth: number }
): Promise<FileSearchResult> {
  const workerData: FileSearchWorkerData = {
    cwd: options.cwd,
    pattern: options.pattern,
    maxEntries: limits.maxEntries,
    maxResults: limits.maxResults,
    maxDepth: limits.maxDepth,
    ignoredDirectories: [
      "node_modules",
      ".git",
      "dist",
      "build",
      "target",
      ".build",
      ".cache",
      ".gradle",
      ".next",
      ".turbo",
      ".venv",
      "venv",
      "coverage",
      "DerivedData",
      "Pods",
    ],
  };

  return await new Promise<FileSearchResult>((resolve) => {
    const worker = new Worker(workerSource, { eval: true, workerData });
    const files: string[] = [];
    let settled = false;

    const finish = (result: Omit<FileSearchResult, "files" | "elapsedMs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      const complete = (): void => {
        resolve({ files, elapsedMs: Date.now() - startedAt, ...result });
      };
      void worker.terminate().then(complete, complete);
    };

    const abort = (): void => {
      finish({
        visitedEntries: 0,
        limitReached: false,
        timedOut: false,
        aborted: true,
      });
    };

    const timeout = setTimeout(() => {
      finish({
        visitedEntries: 0,
        limitReached: false,
        timedOut: true,
        aborted: false,
      });
    }, timeoutMs);

    worker.on("message", (message: FileSearchWorkerMessage) => {
      if (message.type === "match") {
        files.push(message.file);
        return;
      }
      if (message.type === "error") {
        finish({
          visitedEntries: 0,
          limitReached: false,
          timedOut: false,
          aborted: false,
          error: message.error,
        });
        return;
      }
      finish({
        visitedEntries: message.visitedEntries,
        limitReached: message.limitReached,
        timedOut: false,
        aborted: false,
      });
    });

    worker.on("error", (error: Error) => {
      finish({
        visitedEntries: 0,
        limitReached: false,
        timedOut: false,
        aborted: false,
        error: error.message,
      });
    });

    worker.on("exit", (code: number) => {
      if (settled) return;
      finish({
        visitedEntries: 0,
        limitReached: false,
        timedOut: false,
        aborted: false,
        error: `File search worker exited before completing with code ${code}`,
      });
    });

    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
