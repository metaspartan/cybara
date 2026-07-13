export interface TranscriptionAudioPayload {
  audioBase64: string;
  mimeType: string;
  fileName: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function monoSample(channels: Float32Array[], position: number): number {
  const lower = Math.floor(position);
  const upper = Math.min((channels[0]?.length || 1) - 1, lower + 1);
  const ratio = position - lower;
  let sample = 0;
  for (const values of channels) {
    sample += (values[lower] ?? 0) * (1 - ratio) + (values[upper] ?? 0) * ratio;
  }
  return sample / Math.max(1, channels.length);
}

export function resampleAudioChannels(
  channels: Float32Array[],
  sourceSampleRate: number,
  targetSampleRate: number = 16_000
): Float32Array {
  const sourceLength = channels[0]?.length || 0;
  if (sourceLength === 0 || sourceSampleRate <= 0 || targetSampleRate <= 0) {
    return new Float32Array();
  }
  const sampleCount = Math.max(1, Math.round((sourceLength / sourceSampleRate) * targetSampleRate));
  const samples = new Float32Array(sampleCount);
  const ratio = sourceSampleRate / targetSampleRate;
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = monoSample(channels, Math.min(sourceLength - 1, index * ratio));
  }
  return samples;
}

export async function audioBlobToLocalPcm(blob: Blob): Promise<TranscriptionAudioPayload> {
  if (blob.size < 32) {
    throw new Error("No usable audio was captured. Record for at least a moment and try again.");
  }
  const context = new AudioContext();
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new Error(
        "This recording format could not be processed for local Whisper. Try recording again or use automatic transcription."
      );
    }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
      decoded.getChannelData(channel)
    );
    const samples = resampleAudioChannels(channels, decoded.sampleRate);
    if (samples.length < 320) {
      throw new Error("No usable audio was captured. Record for at least a moment and try again.");
    }
    return {
      audioBase64: bytesToBase64(new Uint8Array(samples.buffer)),
      mimeType: "audio/pcm-f32le;rate=16000",
      fileName: "dictation.pcm",
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function audioBlobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );
}
