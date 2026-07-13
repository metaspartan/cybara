import { KokoroTTS } from "../node_modules/kokoro-js/dist/kokoro.js";
import { env as transformersEnv } from "../node_modules/kokoro-js/node_modules/@huggingface/transformers/dist/transformers.node.mjs";

const models = new Map();
const transcribers = new Map();
const progressByRequest = new Map();
const cacheDir = process.env.CYBARA_SPEECH_CACHE_DIR?.trim();

if (!cacheDir) throw new Error("Packaged speech runtime is not configured");
transformersEnv.cacheDir = cacheDir;

function errorMessage(error) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Model load failed";
}

function send(response) {
  process.send?.(response);
}

function progressValue(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.progress === "number") return Math.round(event.progress);
  if (typeof event.loaded === "number" && typeof event.total === "number" && event.total > 0) {
    return Math.round((event.loaded / event.total) * 100);
  }
  return null;
}

function sendProgress(id, event) {
  const progress = progressValue(event);
  if (progress === null || progressByRequest.get(id) === progress) return;
  progressByRequest.set(id, progress);
  send({ id, type: "progress", progress });
}

async function loadModel(request) {
  const ready = models.get(request.model);
  if (ready) return ready;
  const model = await KokoroTTS.from_pretrained(request.model, {
    dtype: request.dtype,
    device: "cpu",
    progress_callback: (event) => sendProgress(request.id, event),
  });
  models.set(request.model, model);
  return model;
}

async function loadTranscriber(request) {
  const ready = transcribers.get(request.model);
  if (ready) return ready;
  const transformers = await import(
    "../node_modules/@huggingface/transformers/dist/transformers.node.mjs"
  );
  transformers.env.cacheDir = cacheDir;
  const transcriber = await transformers.pipeline(
    "automatic-speech-recognition",
    request.model,
    {
      dtype: request.dtype,
      device: "cpu",
      progress_callback: (event) => sendProgress(request.id, event),
    }
  );
  transcribers.set(request.model, transcriber);
  return transcriber;
}

async function handleRequest(request) {
  try {
    if (request.action === "unload") {
      models.delete(request.model);
      send({ id: request.id, type: "result", success: true });
      return;
    }
    if (request.action === "unload_asr") {
      transcribers.delete(request.model);
      send({ id: request.id, type: "result", success: true });
      return;
    }
    if (request.action === "load_asr" || request.action === "transcribe") {
      const transcriber = await loadTranscriber(request);
      if (request.action === "load_asr") {
        send({ id: request.id, type: "result", success: true });
        return;
      }
      const bytes = Uint8Array.from(request.audio);
      if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) {
        throw new Error("Local transcription audio must contain Float32 PCM samples");
      }
      const audio = new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
      const result = await transcriber(audio, {
        ...(request.language ? { language: request.language } : {}),
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = typeof result?.text === "string" ? result.text.trim() : "";
      if (!text) throw new Error("Local transcription returned no text");
      send({ id: request.id, type: "result", success: true, text });
      return;
    }
    const model = await loadModel(request);
    if (request.action === "load") {
      send({ id: request.id, type: "result", success: true });
      return;
    }
    const audio = await model.generate(request.text, {
      voice: request.voice,
      speed: request.speed,
    });
    send({
      id: request.id,
      type: "result",
      success: true,
      wav: new Uint8Array(audio.toWav()),
    });
  } catch (error) {
    send({ id: request.id, type: "result", success: false, error: errorMessage(error) });
  } finally {
    progressByRequest.delete(request.id);
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (typeof message.id !== "string" || typeof message.model !== "string") return;
  void handleRequest(message);
});
