export interface VoiceActivityState {
  speechDetected: boolean;
  silenceStartedAt: number | null;
  shouldStop: boolean;
}

export interface VoiceActivityInput {
  rms: number;
  now: number;
  recordingStartedAt: number;
  speechDetected: boolean;
  silenceStartedAt: number | null;
  threshold?: number;
  silenceDurationMs?: number;
  noSpeechTimeoutMs?: number;
}

export function nextVoiceActivityState(input: VoiceActivityInput): VoiceActivityState {
  const threshold = input.threshold ?? 0.035;
  const silenceDurationMs = input.silenceDurationMs ?? 1_400;
  const noSpeechTimeoutMs = input.noSpeechTimeoutMs ?? 15_000;
  if (input.rms >= threshold) {
    return { speechDetected: true, silenceStartedAt: null, shouldStop: false };
  }
  if (!input.speechDetected) {
    return {
      speechDetected: false,
      silenceStartedAt: null,
      shouldStop: input.now - input.recordingStartedAt >= noSpeechTimeoutMs,
    };
  }
  const silenceStartedAt = input.silenceStartedAt ?? input.now;
  return {
    speechDetected: true,
    silenceStartedAt,
    shouldStop: input.now - silenceStartedAt >= silenceDurationMs,
  };
}
