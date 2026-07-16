import { join } from "node:path";
import { pathToFileURL } from "node:url";

const extractors = new Map();
let transformers;

function send(response) {
  process.send?.(response);
}

function errorMessage(error) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Managed Transformers.js worker failed";
}

function progressValue(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.progress !== "number" || !Number.isFinite(event.progress)) return null;
  return Math.min(100, Math.max(0, Math.round(event.progress)));
}

function progressStatus(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.status === "string") return event.status;
  if (typeof event.file === "string") return event.file;
  return null;
}

function numericMatrix(value) {
  if (typeof value?.tolist === "function") return numericMatrix(value.tolist());
  if (!Array.isArray(value)) return [];
  if (value.length === 0) return [];
  if (typeof value[0] === "number") return [value.map(Number)];
  if (!Array.isArray(value[0])) return [];
  return value.map((row) => row.filter((item) => typeof item === "number").map(Number));
}

async function extractorFor(request) {
  const cached = extractors.get(request.model);
  if (cached) return await cached;
  const pending = transformers.pipeline("feature-extraction", request.model, {
    dtype: request.dtype,
    quantized: true,
    ...(request.device === "auto" ? {} : { device: request.device }),
    progress_callback: (event) => {
      const progress = progressValue(event);
      if (progress === null) return;
      send({
        id: request.id,
        type: "progress",
        progress,
        status: progressStatus(event),
      });
    },
  });
  extractors.set(request.model, pending);
  try {
    return await pending;
  } catch (error) {
    extractors.delete(request.model);
    throw error;
  }
}

async function unload(model) {
  const pending = extractors.get(model);
  extractors.delete(model);
  if (!pending) return;
  const extractor = await pending;
  if (typeof extractor?.dispose === "function") await extractor.dispose();
}

async function handleRequest(request) {
  try {
    if (request.action === "ping") {
      send({ id: request.id, type: "result", success: true });
      return;
    }
    if (request.action === "unload") {
      await unload(request.model);
      send({ id: request.id, type: "result", success: true });
      return;
    }
    const extractor = await extractorFor(request);
    const output = await extractor(request.texts, { pooling: "mean", normalize: true });
    const embeddings = numericMatrix(output);
    if (embeddings.length !== request.texts.length || embeddings.some((row) => row.length === 0)) {
      throw new Error("Transformers.js returned invalid embeddings");
    }
    send({ id: request.id, type: "result", success: true, embeddings });
  } catch (error) {
    send({ id: request.id, type: "result", success: false, error: errorMessage(error) });
  }
}

async function runWorker() {
  const runtimeDir = process.env.CYBARA_TRANSFORMERS_RUNTIME_DIR?.trim();
  const cacheDir = process.env.CYBARA_TRANSFORMERS_CACHE_DIR?.trim();
  if (!runtimeDir || !cacheDir) throw new Error("Managed Transformers.js worker is not configured");
  const entry = join(
    runtimeDir,
    "node_modules",
    "@huggingface",
    "transformers",
    "dist",
    "transformers.node.mjs"
  );
  transformers = await import(pathToFileURL(entry).href);
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = true;
  transformers.env.cacheDir = cacheDir;
  transformers.env.localModelPath = cacheDir;
  process.on("message", (message) => {
    if (!message || typeof message !== "object" || typeof message.id !== "string") return;
    void handleRequest(message);
  });
}

if (import.meta.main) await runWorker();

export default import.meta.path;
