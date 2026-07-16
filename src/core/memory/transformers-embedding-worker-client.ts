import workerPath from "./transformers-embedding-worker.mjs" with { type: "file" };
import { join } from "node:path";
import { ensureBunRuntime, findBunRuntime } from "../bun-runtime";
import {
  ensureManagedTransformersRuntime,
  isManagedTransformersRuntimeInstalled,
  managedTransformersRuntimeDir,
} from "./transformers-package-runtime";
import {
  isTransformersEmbeddingWorkerResponse,
  type TransformersEmbeddingWorkerRequest,
  type TransformersEmbeddingWorkerResponse,
} from "./transformers-embedding-worker-protocol";

interface PendingWorkerRequest {
  resolve: (response: TransformersEmbeddingWorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number, status: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ManagedEmbeddingOptions {
  model: string;
  texts: string[];
  dtype: string;
  device: string;
  cacheDir: string;
  onProgress?: (progress: number, status: string | null) => void;
}

let worker: ReturnType<typeof Bun.spawn> | null = null;
let workerStart: Promise<ReturnType<typeof Bun.spawn>> | null = null;
let workerCacheDir = "";
let exitHookInstalled = false;
const pendingRequests = new Map<string, PendingWorkerRequest>();

function failPendingRequests(message: string): void {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
  pendingRequests.clear();
}

function handleResponse(message: unknown): void {
  if (!isTransformersEmbeddingWorkerResponse(message)) return;
  const pending = pendingRequests.get(message.id);
  if (!pending) return;
  if (message.type === "progress") {
    pending.onProgress?.(message.progress, message.status);
    return;
  }
  pendingRequests.delete(message.id);
  clearTimeout(pending.timeout);
  if (message.success) pending.resolve(message);
  else pending.reject(new Error(message.error));
}

async function startWorker(cacheDir: string): Promise<ReturnType<typeof Bun.spawn>> {
  if (worker && !worker.killed && workerCacheDir === cacheDir) return worker;
  if (worker && !worker.killed) worker.kill();
  const runtimeDir = await ensureManagedTransformersRuntime();
  const runtimePath = findBunRuntime() || (await ensureBunRuntime());
  const materializedWorkerPath = join(runtimeDir, "transformers-embedding-worker.mjs");
  await Bun.write(materializedWorkerPath, Bun.file(workerPath));
  let stderr = "";
  let stderrFinished = Promise.resolve();
  const started = Bun.spawn([runtimePath, materializedWorkerPath], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      CYBARA_TRANSFORMERS_RUNTIME_DIR: runtimeDir,
      CYBARA_TRANSFORMERS_CACHE_DIR: cacheDir,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    ipc: handleResponse,
    onExit: (subprocess, exitCode, signalCode, error) => {
      if (worker !== subprocess) return;
      worker = null;
      workerStart = null;
      void stderrFinished.then(() => {
        const detail = stderr.trim() || error?.message || signalCode || exitCode || "unknown error";
        failPendingRequests(`Managed Transformers.js worker exited: ${detail}`);
      });
    },
  });
  started.unref();
  worker = started;
  workerCacheDir = cacheDir;
  stderrFinished = (async () => {
    const stream = started.stderr;
    if (!stream || typeof stream === "number") return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stderr = `${stderr}${decoder.decode(chunk.value, { stream: true })}`.slice(-8000);
    }
    stderr = `${stderr}${decoder.decode()}`.slice(-8000);
  })();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once("exit", () => worker?.kill());
  }
  return started;
}

async function getWorker(cacheDir: string): Promise<ReturnType<typeof Bun.spawn>> {
  if (worker && !worker.killed && workerCacheDir === cacheDir) return worker;
  if (workerStart) return await workerStart;
  workerStart = startWorker(cacheDir);
  try {
    return await workerStart;
  } finally {
    workerStart = null;
  }
}

async function sendRequest(
  request: TransformersEmbeddingWorkerRequest,
  cacheDir: string,
  onProgress?: (progress: number, status: string | null) => void
): Promise<TransformersEmbeddingWorkerResponse> {
  const activeWorker = await getWorker(cacheDir);
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        pendingRequests.delete(request.id);
        reject(new Error("Managed Transformers.js worker timed out"));
      },
      10 * 60 * 1000
    );
    pendingRequests.set(request.id, { resolve, reject, onProgress, timeout });
    try {
      activeWorker.send(request);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(request.id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function hasManagedTransformersRuntime(): boolean {
  return isManagedTransformersRuntimeInstalled(managedTransformersRuntimeDir());
}

export async function verifyManagedTransformersWorker(cacheDir: string): Promise<void> {
  await sendRequest({ id: crypto.randomUUID(), action: "ping" }, cacheDir);
}

export async function embedWithManagedTransformers(
  options: ManagedEmbeddingOptions
): Promise<number[][]> {
  const response = await sendRequest(
    {
      id: crypto.randomUUID(),
      action: "embed",
      model: options.model,
      texts: options.texts,
      dtype: options.dtype,
      device: options.device,
    },
    options.cacheDir,
    options.onProgress
  );
  if (response.type !== "result" || !response.success || !response.embeddings) {
    throw new Error("Managed Transformers.js worker returned no embeddings");
  }
  return response.embeddings;
}

export async function unloadManagedTransformers(model: string, cacheDir: string): Promise<void> {
  if (!worker || worker.killed) return;
  await sendRequest({ id: crypto.randomUUID(), action: "unload", model }, cacheDir);
}
