import { describe, expect, test } from "bun:test";
import { resampleAudioChannels } from "../../ui/src/lib/audioTranscription";

describe("local transcription audio", () => {
  test("mixes stereo to mono and resamples to 16 kHz", () => {
    const left = new Float32Array(48_000).fill(1);
    const right = new Float32Array(48_000).fill(-0.5);
    const result = resampleAudioChannels([left, right], 48_000);

    expect(result.length).toBe(16_000);
    expect(result[0]).toBeCloseTo(0.25, 5);
    expect(result[15_999]).toBeCloseTo(0.25, 5);
  });

  test("returns no samples for invalid or empty input", () => {
    expect(resampleAudioChannels([], 48_000).length).toBe(0);
    expect(resampleAudioChannels([new Float32Array([1])], 0).length).toBe(0);
  });
});
