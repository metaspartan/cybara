import { describe, expect, test } from "bun:test";
import {
  KOKORO_MODEL_ID,
  listLocalTtsModelStatus,
  LOCAL_TTS_MODELS,
  LOCAL_TTS_VOICES,
  isLocalTtsVoice,
  resolveLocalTtsVoice,
  unloadLocalTtsModel,
} from "../../src/core/local-speech";

describe("local speech catalog", () => {
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
});
