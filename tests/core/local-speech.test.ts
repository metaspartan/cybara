import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  describeLocalSpeechError,
  findLocalSpeechRuntimeEntries,
  findLocalSpeechWorkerEntries,
  isLocalTtsVoice,
  KOKORO_MODEL_ID,
  LOCAL_TTS_MODELS,
  LOCAL_TTS_VOICES,
  listLocalTtsModelStatus,
  localSpeechCacheDir,
  resolveLocalTtsVoice,
  unloadLocalTtsModel,
} from "../../src/core/local-speech";

const originalCybaraHome = process.env.CYBARA_HOME;

afterEach(() => {
  if (originalCybaraHome === undefined) delete process.env.CYBARA_HOME;
  else process.env.CYBARA_HOME = originalCybaraHome;
});

describe("local speech catalog", () => {
  test("preserves resolver messages thrown by compiled Bun modules", () => {
    expect(describeLocalSpeechError({ message: "Cannot find package 'onnxruntime-common'" })).toBe(
      "Cannot find package 'onnxruntime-common'"
    );
    expect(describeLocalSpeechError("runtime unavailable")).toBe("runtime unavailable");
  });

  test("exposes Kokoro with a defined default voice and voice catalog", () => {
    expect(LOCAL_TTS_MODELS.length).toBeGreaterThan(0);
    const kokoro = LOCAL_TTS_MODELS.find((model) => model.id === KOKORO_MODEL_ID);
    expect(kokoro).toBeDefined();
    expect(kokoro?.sizeMb).toBeGreaterThan(0);
    expect(LOCAL_TTS_VOICES.some((voice) => voice.id === kokoro?.defaultVoice)).toBe(true);
    expect(LOCAL_TTS_VOICES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(LOCAL_TTS_VOICES.map((voice) => voice.id)).size).toBe(LOCAL_TTS_VOICES.length);
  });

  test("validates and resolves voices with a safe fallback", () => {
    expect(isLocalTtsVoice("af_heart")).toBe(true);
    expect(isLocalTtsVoice("not-a-voice")).toBe(false);
    expect(isLocalTtsVoice(undefined)).toBe(false);
    expect(resolveLocalTtsVoice("am_onyx", KOKORO_MODEL_ID)).toBe("am_onyx");
    expect(resolveLocalTtsVoice("bogus", KOKORO_MODEL_ID)).toBe("af_heart");
    expect(resolveLocalTtsVoice(undefined, KOKORO_MODEL_ID)).toBe("af_heart");
  });

  test("reports model status and supports unload transitions", () => {
    const status = listLocalTtsModelStatus();
    expect(status.length).toBe(LOCAL_TTS_MODELS.length);
    expect(status[0].id).toBe(KOKORO_MODEL_ID);
    expect(["unloaded", "loading", "ready", "error"]).toContain(status[0].state);
    unloadLocalTtsModel(KOKORO_MODEL_ID);
    expect(listLocalTtsModelStatus()[0].state).toBe("unloaded");
  });

  test("stores model downloads under the writable Cybara data directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-local-speech-cache-"));
    try {
      process.env.CYBARA_HOME = dir;
      expect(localSpeechCacheDir()).toBe(join(dir, "models", "speech"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("discovers the packaged Kokoro runtime from a Tauri resource directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-local-speech-runtime-"));
    const modules = join(dir, "node_modules");
    const kokoro = join(modules, "kokoro-js", "dist", "kokoro.js");
    const transformers = join(
      modules,
      "kokoro-js",
      "node_modules",
      "@huggingface",
      "transformers",
      "dist",
      "transformers.node.mjs"
    );
    try {
      mkdirSync(join(kokoro, ".."), { recursive: true });
      mkdirSync(join(transformers, ".."), { recursive: true });
      writeFileSync(kokoro, "export const KokoroTTS = {};");
      writeFileSync(transformers, "export const env = {};");
      expect(findLocalSpeechRuntimeEntries([dir])).toEqual({ kokoro, transformers });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("discovers the packaged persistent speech worker", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-local-speech-worker-"));
    const runtime = join(dir, "runtime");
    try {
      mkdirSync(runtime, { recursive: true });
      writeFileSync(join(runtime, "bun"), "runtime");
      writeFileSync(join(runtime, "local-speech-worker.mjs"), "worker");
      expect(findLocalSpeechWorkerEntries([dir])).toEqual({
        bun: join(runtime, "bun"),
        worker: join(runtime, "local-speech-worker.mjs"),
        resourceDir: dir,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
