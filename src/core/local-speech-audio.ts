export interface DecodedWaveAudio {
  channels: number;
  sampleRate: number;
  samples: Float32Array;
}

interface WaveFormat {
  audioFormat: number;
  bitsPerSample: number;
  blockAlign: number;
  channels: number;
  sampleRate: number;
}

function fourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readPcm24(view: DataView, offset: number): number {
  const value =
    view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
  return (value & 0x800000 ? value | 0xff000000 : value) / 8_388_608;
}

function readWaveSample(
  view: DataView,
  offset: number,
  audioFormat: number,
  bitsPerSample: number
): number {
  if (audioFormat === 1) {
    if (bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
    if (bitsPerSample === 16) return view.getInt16(offset, true) / 32_768;
    if (bitsPerSample === 24) return readPcm24(view, offset);
    if (bitsPerSample === 32) return view.getInt32(offset, true) / 2_147_483_648;
  }
  if (audioFormat === 3) {
    if (bitsPerSample === 32) return view.getFloat32(offset, true);
    if (bitsPerSample === 64) return view.getFloat64(offset, true);
  }
  throw new Error(`Unsupported WAV sample format ${audioFormat}/${bitsPerSample}`);
}

function parseWaveFormat(view: DataView, offset: number, size: number): WaveFormat {
  if (size < 16) throw new Error("WAV format chunk is incomplete");
  const channels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const bitsPerSample = view.getUint16(offset + 14, true);
  const audioFormat = view.getUint16(offset, true);
  const bytesPerSample = bitsPerSample / 8;
  if (
    channels < 1 ||
    channels > 32 ||
    sampleRate < 1 ||
    sampleRate > 384_000 ||
    !Number.isInteger(bytesPerSample) ||
    bytesPerSample < 1 ||
    blockAlign < channels * bytesPerSample
  ) {
    throw new Error("WAV format is invalid");
  }
  return { audioFormat, bitsPerSample, blockAlign, channels, sampleRate };
}

function sampleByteWidth(format: WaveFormat): number {
  const width = format.bitsPerSample / 8;
  if (
    (format.audioFormat === 1 && (width === 1 || width === 2 || width === 3 || width === 4)) ||
    (format.audioFormat === 3 && (width === 4 || width === 8))
  ) {
    return width;
  }
  throw new Error(`Unsupported WAV sample format ${format.audioFormat}/${format.bitsPerSample}`);
}

export function decodeWaveAudio(bytes: Uint8Array): DecodedWaveAudio {
  if (bytes.byteLength < 44) throw new Error("WAV recording is empty or incomplete");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCc(view, 0) !== "RIFF" || fourCc(view, 8) !== "WAVE") {
    throw new Error("Recording is not a valid WAV file");
  }

  let format: WaveFormat | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const chunkId = fourCc(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const contentOffset = offset + 8;
    const contentEnd = contentOffset + chunkSize;
    if (contentEnd > view.byteLength) throw new Error("WAV chunk exceeds the recording length");
    if (chunkId === "fmt ") format = parseWaveFormat(view, contentOffset, chunkSize);
    if (chunkId === "data") {
      dataOffset = contentOffset;
      dataSize = chunkSize;
    }
    offset = contentEnd + (chunkSize % 2);
  }

  if (!format) throw new Error("WAV recording has no format information");
  if (dataOffset < 0 || dataSize === 0) throw new Error("No audio was captured");
  const width = sampleByteWidth(format);
  const frameCount = Math.floor(dataSize / format.blockAlign);
  if (frameCount === 0) throw new Error("No audio was captured");

  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * format.blockAlign;
    let mixed = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const value = readWaveSample(
        view,
        frameOffset + channel * width,
        format.audioFormat,
        format.bitsPerSample
      );
      mixed += Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
    samples[frame] = mixed / format.channels;
  }

  return { channels: format.channels, sampleRate: format.sampleRate, samples };
}

export function resampleMonoAudio(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number = 16_000
): Float32Array {
  if (samples.length === 0 || sourceSampleRate <= 0 || targetSampleRate <= 0) {
    return new Float32Array();
  }
  if (sourceSampleRate === targetSampleRate) return samples.slice();
  const outputLength = Math.max(
    1,
    Math.round((samples.length / sourceSampleRate) * targetSampleRate)
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = Math.min(samples.length - 1, index * ratio);
    const lower = Math.floor(position);
    const upper = Math.min(samples.length - 1, lower + 1);
    const fraction = position - lower;
    output[index] = (samples[lower] ?? 0) * (1 - fraction) + (samples[upper] ?? 0) * fraction;
  }
  return output;
}

function float32Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.byteLength);
  bytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  return bytes;
}

export function normalizeLocalTranscriptionAudio(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Uint8Array {
  const mimeType = input.mimeType.trim().toLowerCase();
  let samples: Float32Array;
  if (mimeType.startsWith("audio/pcm-f32le")) {
    if (input.bytes.byteLength % 4 !== 0) {
      throw new Error("Local transcription requires complete Float32 PCM samples");
    }
    samples = new Float32Array(
      input.bytes.buffer.slice(
        input.bytes.byteOffset,
        input.bytes.byteOffset + input.bytes.byteLength
      )
    );
  } else if (
    mimeType === "audio/wav" ||
    mimeType === "audio/wave" ||
    mimeType === "audio/x-wav" ||
    (input.bytes.byteLength >= 12 && String.fromCharCode(...input.bytes.subarray(0, 4)) === "RIFF")
  ) {
    const decoded = decodeWaveAudio(input.bytes);
    samples = resampleMonoAudio(decoded.samples, decoded.sampleRate);
  } else {
    throw new Error("Local transcription requires WAV or 16 kHz Float32 PCM audio");
  }
  if (samples.length < 320) {
    throw new Error("No usable audio was captured. Record for at least a moment and try again.");
  }
  return float32Bytes(samples);
}
