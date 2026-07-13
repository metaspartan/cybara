import { describe, expect, test } from "bun:test";
import {
  decodeWaveAudio,
  normalizeLocalTranscriptionAudio,
} from "../../src/core/local-speech-audio";

function stereoPcm16Wave(sampleRate: number, frameCount: number): Uint8Array {
  const channels = 2;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = 44 + frame * blockAlign;
    view.setInt16(offset, 16_384, true);
    view.setInt16(offset + 2, -8_192, true);
  }
  return bytes;
}

describe("local speech WAV normalization", () => {
  test("decodes native stereo WAV and resamples it to 16 kHz mono Float32 PCM", () => {
    const wav = stereoPcm16Wave(48_000, 4_800);
    const decoded = decodeWaveAudio(wav);
    const normalized = normalizeLocalTranscriptionAudio({ bytes: wav, mimeType: "audio/wav" });
    const samples = new Float32Array(normalized.buffer);

    expect(decoded.channels).toBe(2);
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.samples[0]).toBeCloseTo(0.125, 4);
    expect(samples.length).toBe(1_600);
    expect(samples[0]).toBeCloseTo(0.125, 4);
  });

  test("keeps valid Float32 PCM and rejects empty or unsupported recordings", () => {
    const pcm = new Float32Array(1_600).fill(0.2);
    const bytes = new Uint8Array(pcm.buffer);
    expect(
      normalizeLocalTranscriptionAudio({ bytes, mimeType: "audio/pcm-f32le;rate=16000" })
    ).toEqual(bytes);
    expect(() =>
      normalizeLocalTranscriptionAudio({ bytes: new Uint8Array(44), mimeType: "audio/wav" })
    ).toThrow("valid WAV");
    expect(() => normalizeLocalTranscriptionAudio({ bytes, mimeType: "audio/webm" })).toThrow(
      "WAV or 16 kHz Float32 PCM"
    );
  });
});
