import { chmodSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { resolveCybaraHome } from "./cybara-home";
import {
  isLocalSpeechWorkerResponse,
  type LocalSpeechWorkerRequest,
  type LocalSpeechWorkerResponse,
} from "./local-speech-worker-protocol";

export type LocalSpeechDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export interface LocalTtsModelInfo {
  id: string;
  label: string;
  description: string;
  sizeMb: number;
  defaultVoice: string;
}

export interface LocalTtsVoiceInfo {
  id: string;
  label: string;
  language: string;
  gender: "female" | "male";
}

export interface LocalSttModelInfo {
  id: string;
  label: string;
  description: string;
  sizeMb: number;
  language: string;
}

export interface LocalSpeechModelStatus {
  id: string;
  state: "unloaded" | "loading" | "ready" | "error";
  loadProgress: number | null;
  loadedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
}

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const WHISPER_MODEL_ID = "onnx-community/whisper-tiny";

export const LOCAL_TTS_MODELS: LocalTtsModelInfo[] = [
  {
    id: KOKORO_MODEL_ID,
    label: "Kokoro 82M",
    description: "High-quality open-weight neural TTS. Runs fully offline after the first load.",
    sizeMb: 326,
    defaultVoice: "af_heart",
  },
];

export const LOCAL_TTS_VOICES: LocalTtsVoiceInfo[] = [
  { id: "af_heart", label: "Heart", language: "en-US", gender: "female" },
  { id: "af_bella", label: "Bella", language: "en-US", gender: "female" },
  { id: "af_nicole", label: "Nicole", language: "en-US", gender: "female" },
  { id: "af_nova", label: "Nova", language: "en-US", gender: "female" },
  { id: "af_sarah", label: "Sarah", language: "en-US", gender: "female" },
  { id: "af_sky", label: "Sky", language: "en-US", gender: "female" },
  { id: "am_adam", label: "Adam", language: "en-US", gender: "male" },
  { id: "am_echo", label: "Echo", language: "en-US", gender: "male" },
  { id: "am_liam", label: "Liam", language: "en-US", gender: "male" },
  { id: "am_michael", label: "Michael", language: "en-US", gender: "male" },
  { id: "am_onyx", label: "Onyx", language: "en-US", gender: "male" },
  { id: "am_puck", label: "Puck", language: "en-US", gender: "male" },
  { id: "bf_emma", label: "Emma", language: "en-GB", gender: "female" },
  { id: "bf_isabella", label: "Isabella", language: "en-GB", gender: "female" },
  { id: "bm_george", label: "George", language: "en-GB", gender: "male" },
  { id: "bm_fable", label: "Fable", language: "en-GB", gender: "male" },
];

export const LOCAL_STT_MODELS: LocalSttModelInfo[] = [
  {
    id: WHISPER_MODEL_ID,
    label: "Whisper Tiny",
    description: "Fast multilingual speech recognition that runs locally after download.",
    sizeMb: 151,
    language: "multilingual",
  },
  {
    id: "onnx-community/whisper-tiny.en",
    label: "Whisper Tiny English",
    description: "English-only local speech recognition with lower processing overhead.",
    sizeMb: 151,
    language: "en",
  },
];

const LOCAL_VOICE_IDS = new Set(LOCAL_TTS_VOICES.map((voice) => voice.id));

export function isLocalTtsVoice(voice: string | undefined): boolean {
  return !!voice && LOCAL_VOICE_IDS.has(voice);
}

export function resolveLocalTtsVoice(voice: string | undefined, model: string): string {
  if (isLocalTtsVoice(voice)) return voice as string;
  return LOCAL_TTS_MODELS.find((entry) => entry.id === model)?.defaultVoice || "af_heart";
}

export function localSpeechCacheDir(): string {
  const dir = join(resolveCybaraHome().dir, "models", "speech");
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface KokoroTtsInstance {
  generate(
    text: string,
    options?: { voice?: string; speed?: number }
  ): Promise<{ toWav(): ArrayBuffer }>;
}

interface KokoroModule {
  KokoroTTS: {
    from_pretrained(
      modelId: string,
      options?: {
        dtype?: LocalSpeechDtype;
        device?: string;
        progress_callback?: (event: unknown) => void;
      }
    ): Promise<KokoroTtsInstance>;
  };
}

interface TransformersRuntimeModule {
  env: { cacheDir: string };
}

async function importOptionalModule(specifier: string): Promise<unknown> {
  return await import(specifier);
}

interface LocalAsrResult {
  text?: string;
}

interface LocalAsrPipeline {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<LocalAsrResult>;
}

interface LocalTransformersModule extends TransformersRuntimeModule {
  pipeline(
    task: "automatic-speech-recognition",
    model: string,
    options: {
      dtype: LocalSpeechDtype;
      device: "cpu";
      progress_callback?: (event: unknown) => void;
    }
  ): Promise<LocalAsrPipeline>;
}

export interface LocalSpeechRuntimeEntries {
  kokoro: string;
  transformers: string;
}

export interface LocalSpeechWorkerEntries {
  bun: string;
  worker: string;
  resourceDir: string;
}

interface PendingWorkerRequest {
  resolve: (response: LocalSpeechWorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const runtimeStatus = new Map<string, LocalSpeechModelStatus>();
const loadingPromises = new Map<string, Promise<KokoroTtsInstance>>();
const readyModels = new Map<string, KokoroTtsInstance>();
const localAsrPipelines = new Map<string, LocalAsrPipeline>();
const localAsrLoading = new Map<string, Promise<LocalAsrPipeline>>();
const workerRequests = new Map<string, PendingWorkerRequest>();
let speechWorker: ReturnType<typeof Bun.spawn> | null = null;
let speechWorkerExitHookInstalled = false;

export function describeSpeechWorkerExit(
  exitCode: number | null,
  signalCode: number | null,
  error: { message?: string } | null | undefined,
  stderr: string
): string {
  const detail = stderr.trim() || error?.message?.trim();
  const status = signalCode ? `signal ${signalCode}` : `exit code ${exitCode ?? "unknown"}`;
  return detail
    ? `Packaged speech runtime stopped (${status}): ${detail}`
    : `Packaged speech runtime stopped (${status})`;
}

function isSpeechWorkerExitError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Packaged speech runtime stopped (");
}

function statusFor(model: string): LocalSpeechModelStatus {
  const existing = runtimeStatus.get(model);
  if (existing) return existing;
  const created: LocalSpeechModelStatus = {
    id: model,
    state: "unloaded",
    loadProgress: null,
    loadedAt: null,
    lastUsedAt: null,
    lastError: null,
  };
  runtimeStatus.set(model, created);
  return created;
}

function patchStatus(model: string, patch: Partial<LocalSpeechModelStatus>): void {
  runtimeStatus.set(model, { ...statusFor(model), ...patch });
}

function readProgress(event: unknown): number | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  if (typeof record.progress === "number") return Math.round(record.progress);
  if (typeof record.loaded === "number" && typeof record.total === "number" && record.total > 0) {
    return Math.round((record.loaded / record.total) * 100);
  }
  return null;
}

export function describeLocalSpeechError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Model load failed";
}

export function listLocalTtsModelStatus(): LocalSpeechModelStatus[] {
  return LOCAL_TTS_MODELS.map((model) => statusFor(model.id));
}

export function listLocalSttModelStatus(): LocalSpeechModelStatus[] {
  return LOCAL_STT_MODELS.map((model) => statusFor(model.id));
}

function localSpeechRuntimeRoots(): string[] {
  const seeds = [process.env.CYBARA_RESOURCE_DIR, process.cwd(), dirname(process.execPath)].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    let current = seed;
    for (let depth = 0; depth < 6; depth += 1) {
      if (!seen.has(current)) {
        seen.add(current);
        roots.push(current);
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return roots;
}

export function findLocalSpeechRuntimeEntries(
  roots: string[] = localSpeechRuntimeRoots()
): LocalSpeechRuntimeEntries | null {
  const moduleParents = ["", "bin", "resources", join("resources", "bin")];
  for (const root of roots) {
    for (const parent of moduleParents) {
      const modules = join(root, parent, "node_modules");
      const kokoro = join(modules, "kokoro-js", "dist", "kokoro.js");
      const nestedTransformers = join(
        modules,
        "kokoro-js",
        "node_modules",
        "@huggingface",
        "transformers",
        "dist",
        "transformers.node.mjs"
      );
      const rootTransformers = join(
        modules,
        "@huggingface",
        "transformers",
        "dist",
        "transformers.node.mjs"
      );
      if (!existsSync(kokoro)) continue;
      if (existsSync(nestedTransformers)) {
        return { kokoro, transformers: nestedTransformers };
      }
      if (existsSync(rootTransformers)) {
        return { kokoro, transformers: rootTransformers };
      }
    }
  }
  return null;
}

function findLocalTransformersRuntimeEntry(
  roots: string[] = localSpeechRuntimeRoots()
): string | null {
  const moduleParents = ["", "bin", "resources", join("resources", "bin")];
  for (const root of roots) {
    for (const parent of moduleParents) {
      const entry = join(
        root,
        parent,
        "node_modules",
        "@huggingface",
        "transformers",
        "dist",
        "transformers.node.mjs"
      );
      if (existsSync(entry)) return entry;
    }
  }
  return null;
}

export function findLocalSpeechWorkerEntries(
  roots: string[] = localSpeechRuntimeRoots()
): LocalSpeechWorkerEntries | null {
  for (const resourceDir of roots) {
    const runtimeDir = join(resourceDir, "runtime");
    const worker = join(runtimeDir, "local-speech-worker.mjs");
    if (!existsSync(worker)) continue;
    for (const executable of ["bun", "bun.exe"]) {
      const bun = join(runtimeDir, executable);
      if (existsSync(bun)) return { bun, worker, resourceDir };
    }
  }
  return null;
}

function failWorkerRequests(message: string): void {
  for (const pending of workerRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
  workerRequests.clear();
}

function handleWorkerResponse(message: unknown): void {
  if (!isLocalSpeechWorkerResponse(message)) return;
  const pending = workerRequests.get(message.id);
  if (!pending) return;
  if (message.type === "progress") {
    pending.onProgress?.(message.progress);
    return;
  }
  workerRequests.delete(message.id);
  clearTimeout(pending.timeout);
  if (message.success) pending.resolve(message);
  else pending.reject(new Error(message.error));
}

function packagedSpeechWorker(): ReturnType<typeof Bun.spawn> | null {
  if (speechWorker && !speechWorker.killed) return speechWorker;
  const resourceDir = process.env.CYBARA_RESOURCE_DIR?.trim();
  if (!resourceDir) return null;
  const entries = findLocalSpeechWorkerEntries([resourceDir]);
  if (!entries) return null;
  let workerStderr = "";
  let stderrFinished = Promise.resolve();
  const worker = Bun.spawn([entries.bun, entries.worker], {
    env: {
      ...process.env,
      CYBARA_RESOURCE_DIR: entries.resourceDir,
      CYBARA_SPEECH_CACHE_DIR: localSpeechCacheDir(),
    },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "pipe",
    ipc: (message: unknown) => handleWorkerResponse(message),
    onExit: (subprocess, exitCode, signalCode, error) => {
      if (speechWorker !== subprocess) return;
      speechWorker = null;
      void stderrFinished.then(() => {
        failWorkerRequests(describeSpeechWorkerExit(exitCode, signalCode, error, workerStderr));
      });
    },
  });
  speechWorker = worker;
  stderrFinished = (async () => {
    try {
      const stderr = worker.stderr;
      if (!stderr || typeof stderr === "number") return;
      const reader = stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        workerStderr = `${workerStderr}${decoder.decode(chunk.value, { stream: true })}`.slice(
          -8_000
        );
      }
      workerStderr = `${workerStderr}${decoder.decode()}`.slice(-8_000);
    } catch {
      return;
    }
  })();
  if (!speechWorkerExitHookInstalled) {
    speechWorkerExitHookInstalled = true;
    process.once("exit", () => speechWorker?.kill());
  }
  return worker;
}

async function sendWorkerRequestOnce(
  request: LocalSpeechWorkerRequest,
  onProgress?: (progress: number) => void
): Promise<LocalSpeechWorkerResponse> {
  const worker = packagedSpeechWorker();
  if (!worker) throw new Error("Packaged speech runtime is unavailable");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        workerRequests.delete(request.id);
        reject(new Error("Packaged speech runtime timed out"));
      },
      10 * 60 * 1000
    );
    workerRequests.set(request.id, { resolve, reject, onProgress, timeout });
    try {
      worker.send(request);
    } catch (error) {
      clearTimeout(timeout);
      workerRequests.delete(request.id);
      reject(new Error(describeLocalSpeechError(error)));
    }
  });
}

async function sendWorkerRequest(
  request: LocalSpeechWorkerRequest,
  onProgress?: (progress: number) => void
): Promise<LocalSpeechWorkerResponse> {
  try {
    return await sendWorkerRequestOnce(request, onProgress);
  } catch (error) {
    if (
      request.action === "unload" ||
      request.action === "unload_asr" ||
      !process.env.CYBARA_RESOURCE_DIR?.trim() ||
      !isSpeechWorkerExitError(error)
    ) {
      throw error;
    }
    return sendWorkerRequestOnce({ ...request, id: crypto.randomUUID() }, onProgress);
  }
}

function packagedTtsProxy(model: string, dtype: LocalSpeechDtype): KokoroTtsInstance {
  return {
    async generate(text, options) {
      const response = await sendWorkerRequest({
        id: crypto.randomUUID(),
        action: "generate",
        model,
        dtype,
        text,
        voice: options?.voice || resolveLocalTtsVoice(undefined, model),
        speed: options?.speed ?? 1,
      });
      if (response.type !== "result" || !response.success || !response.wav) {
        throw new Error("Packaged speech runtime returned no audio");
      }
      const wav = Uint8Array.from(response.wav);
      return { toWav: () => wav.buffer };
    },
  };
}

async function importKokoro(): Promise<KokoroModule> {
  const entries = findLocalSpeechRuntimeEntries();
  const transformersEntry = entries
    ? entries.transformers
    : Bun.resolveSync("@huggingface/transformers", import.meta.dir);
  const transformers = (await import(
    pathToFileURL(transformersEntry).href
  )) as unknown as TransformersRuntimeModule;
  transformers.env.cacheDir = localSpeechCacheDir();
  if (entries) {
    return (await import(pathToFileURL(entries.kokoro).href)) as unknown as KokoroModule;
  }
  return (await importOptionalModule("kokoro-js")) as KokoroModule;
}

async function importLocalTransformers(): Promise<LocalTransformersModule> {
  const entry =
    findLocalTransformersRuntimeEntry() ||
    Bun.resolveSync("@huggingface/transformers", import.meta.dir);
  const runtime = (await import(pathToFileURL(entry).href)) as unknown as LocalTransformersModule;
  runtime.env.cacheDir = localSpeechCacheDir();
  return runtime;
}

export async function loadLocalTtsModel(
  model: string = KOKORO_MODEL_ID,
  dtype: LocalSpeechDtype = "q8"
): Promise<KokoroTtsInstance> {
  const ready = readyModels.get(model);
  if (ready) {
    patchStatus(model, { lastUsedAt: Date.now() });
    return ready;
  }
  const inFlight = loadingPromises.get(model);
  if (inFlight) return inFlight;

  patchStatus(model, { state: "loading", loadProgress: 0, lastError: null });
  const pending = (async () => {
    if (packagedSpeechWorker()) {
      await sendWorkerRequest(
        { id: crypto.randomUUID(), action: "load", model, dtype },
        (loadProgress) => patchStatus(model, { loadProgress })
      );
      return packagedTtsProxy(model, dtype);
    }
    const { KokoroTTS } = await importKokoro();
    const instance = await KokoroTTS.from_pretrained(model, {
      dtype,
      device: "cpu",
      progress_callback: (event) => {
        const progress = readProgress(event);
        if (progress !== null) patchStatus(model, { loadProgress: progress });
      },
    });
    return instance;
  })();
  loadingPromises.set(model, pending);
  try {
    const instance = await pending;
    readyModels.set(model, instance);
    patchStatus(model, {
      state: "ready",
      loadProgress: 100,
      loadedAt: Date.now(),
      lastUsedAt: Date.now(),
      lastError: null,
    });
    return instance;
  } catch (error) {
    const message = describeLocalSpeechError(error);
    patchStatus(model, {
      state: "error",
      loadProgress: null,
      lastError: message,
    });
    throw new Error(message);
  } finally {
    loadingPromises.delete(model);
  }
}

export function unloadLocalTtsModel(model: string = KOKORO_MODEL_ID): boolean {
  const existed = readyModels.delete(model);
  loadingPromises.delete(model);
  if (speechWorker && !speechWorker.killed) {
    void sendWorkerRequest({
      id: crypto.randomUUID(),
      action: "unload",
      model,
      dtype: "q8",
    }).catch(() => undefined);
  }
  patchStatus(model, {
    state: "unloaded",
    loadProgress: null,
    loadedAt: null,
    lastError: null,
  });
  return existed;
}

export async function loadLocalSttModel(
  model: string = WHISPER_MODEL_ID,
  dtype: LocalSpeechDtype = "q8"
): Promise<LocalAsrPipeline | null> {
  const ready = localAsrPipelines.get(model);
  if (ready) {
    patchStatus(model, { lastUsedAt: Date.now() });
    return ready;
  }
  const inFlight = localAsrLoading.get(model);
  if (inFlight) return inFlight;

  patchStatus(model, { state: "loading", loadProgress: 0, lastError: null });
  if (packagedSpeechWorker()) {
    try {
      await sendWorkerRequest(
        { id: crypto.randomUUID(), action: "load_asr", model, dtype },
        (loadProgress) => patchStatus(model, { loadProgress })
      );
      patchStatus(model, {
        state: "ready",
        loadProgress: 100,
        loadedAt: Date.now(),
        lastUsedAt: Date.now(),
        lastError: null,
      });
      return null;
    } catch (error) {
      const message = describeLocalSpeechError(error);
      patchStatus(model, { state: "error", loadProgress: null, lastError: message });
      throw new Error(message);
    }
  }

  const pending = (async () => {
    const transformers = await importLocalTransformers();
    return transformers.pipeline("automatic-speech-recognition", model, {
      dtype,
      device: "cpu",
      progress_callback: (event) => {
        const progress = readProgress(event);
        if (progress !== null) patchStatus(model, { loadProgress: progress });
      },
    });
  })();
  localAsrLoading.set(model, pending);
  try {
    const pipeline = await pending;
    localAsrPipelines.set(model, pipeline);
    patchStatus(model, {
      state: "ready",
      loadProgress: 100,
      loadedAt: Date.now(),
      lastUsedAt: Date.now(),
      lastError: null,
    });
    return pipeline;
  } catch (error) {
    const message = describeLocalSpeechError(error);
    patchStatus(model, { state: "error", loadProgress: null, lastError: message });
    throw new Error(message);
  } finally {
    localAsrLoading.delete(model);
  }
}

export async function transcribeLocalSpeech(args: {
  pcmBytes: Uint8Array;
  model?: string;
  language?: string;
  dtype?: LocalSpeechDtype;
}): Promise<{ text: string; model: string }> {
  if (args.pcmBytes.byteLength === 0 || args.pcmBytes.byteLength % 4 !== 0) {
    throw new Error("Local transcription requires 16 kHz Float32 PCM audio");
  }
  const model = args.model?.trim() || WHISPER_MODEL_ID;
  const dtype = args.dtype ?? "q8";
  if (packagedSpeechWorker()) {
    const response = await sendWorkerRequest({
      id: crypto.randomUUID(),
      action: "transcribe",
      model,
      dtype,
      audio: args.pcmBytes,
      language: args.language?.trim() || undefined,
    });
    if (response.type !== "result" || !response.success || !response.text?.trim()) {
      throw new Error("Packaged speech runtime returned no transcription");
    }
    patchStatus(model, { lastUsedAt: Date.now() });
    return { text: response.text.trim(), model };
  }
  const pipeline = await loadLocalSttModel(model, dtype);
  if (!pipeline) throw new Error("Local transcription runtime is unavailable");
  const audio = new Float32Array(
    args.pcmBytes.buffer.slice(
      args.pcmBytes.byteOffset,
      args.pcmBytes.byteOffset + args.pcmBytes.byteLength
    )
  );
  const result = await pipeline(audio, {
    ...(args.language?.trim() ? { language: args.language.trim() } : {}),
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const text = result.text?.trim();
  if (!text) throw new Error("Local transcription returned no text");
  patchStatus(model, { lastUsedAt: Date.now() });
  return { text, model };
}

export function unloadLocalSttModel(model: string = WHISPER_MODEL_ID): boolean {
  const existed = localAsrPipelines.delete(model);
  localAsrLoading.delete(model);
  if (speechWorker && !speechWorker.killed) {
    void sendWorkerRequest({
      id: crypto.randomUUID(),
      action: "unload_asr",
      model,
      dtype: "q8",
    }).catch(() => undefined);
  }
  patchStatus(model, {
    state: "unloaded",
    loadProgress: null,
    loadedAt: null,
    lastError: null,
  });
  return existed;
}

export interface LocalSpeechSynthesisResult {
  audioPath: string;
  format: "wav";
  voice: string;
  model: string;
}

export async function synthesizeLocalSpeech(args: {
  text: string;
  voice?: string;
  speed?: number;
  model?: string;
  dtype?: LocalSpeechDtype;
  outputPath: string;
}): Promise<LocalSpeechSynthesisResult> {
  const text = args.text.trim();
  if (!text) throw new Error("text is required");
  const model = args.model || KOKORO_MODEL_ID;
  const voice = resolveLocalTtsVoice(args.voice, model);
  const tts = await loadLocalTtsModel(model, args.dtype ?? "q8");
  const speed =
    typeof args.speed === "number" && Number.isFinite(args.speed)
      ? Math.max(0.5, Math.min(2, args.speed))
      : 1;
  const audio = await tts.generate(text, { voice, speed });
  const wav = audio.toWav();
  await Bun.write(args.outputPath, wav);
  try {
    chmodSync(args.outputPath, 0o600);
  } catch {
    void 0;
  }
  patchStatus(model, { lastUsedAt: Date.now() });
  return { audioPath: args.outputPath, format: "wav", voice, model };
}
