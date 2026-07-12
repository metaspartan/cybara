import { chmodSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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

export interface LocalSpeechModelStatus {
  id: string;
  state: "unloaded" | "loading" | "ready" | "error";
  loadProgress: number | null;
  loadedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
}

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

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

const LOCAL_VOICE_IDS = new Set(LOCAL_TTS_VOICES.map((voice) => voice.id));

export function isLocalTtsVoice(voice: string | undefined): boolean {
  return !!voice && LOCAL_VOICE_IDS.has(voice);
}

export function resolveLocalTtsVoice(voice: string | undefined, model: string): string {
  if (isLocalTtsVoice(voice)) return voice as string;
  return LOCAL_TTS_MODELS.find((entry) => entry.id === model)?.defaultVoice || "af_heart";
}

export function localSpeechCacheDir(): string {
  const dir = join(
    process.env.HOME || process.env.USERPROFILE || homedir(),
    ".cybara",
    "models",
    "speech"
  );
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

const runtimeStatus = new Map<string, LocalSpeechModelStatus>();
const loadingPromises = new Map<string, Promise<KokoroTtsInstance>>();
const readyModels = new Map<string, KokoroTtsInstance>();

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

export function listLocalTtsModelStatus(): LocalSpeechModelStatus[] {
  return LOCAL_TTS_MODELS.map((model) => statusFor(model.id));
}

async function importKokoro(): Promise<KokoroModule> {
  return (await import("kokoro-js")) as unknown as KokoroModule;
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
    patchStatus(model, {
      state: "error",
      loadProgress: null,
      lastError: error instanceof Error ? error.message : "Model load failed",
    });
    throw error;
  } finally {
    loadingPromises.delete(model);
  }
}

export function unloadLocalTtsModel(model: string = KOKORO_MODEL_ID): boolean {
  const existed = readyModels.delete(model);
  loadingPromises.delete(model);
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
