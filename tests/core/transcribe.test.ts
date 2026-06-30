import { describe, expect, test } from "bun:test";
import { selectTranscribeBackend } from "../../src/core/tools/handlers/transcribe";

describe("transcription backend selection", () => {
  test("prefers Groq (whisper-large-v3) when set", () => {
    expect(selectTranscribeBackend({ GROQ_API_KEY: "g", OPENAI_API_KEY: "o" })).toEqual({
      backend: "groq",
      model: "whisper-large-v3",
    });
  });

  test("falls back to OpenAI whisper-1", () => {
    expect(selectTranscribeBackend({ OPENAI_API_KEY: "o" })).toEqual({
      backend: "openai",
      model: "whisper-1",
    });
  });

  test("null when no key configured", () => {
    expect(selectTranscribeBackend({})).toBeNull();
  });
});
