import { describe, expect, test } from "bun:test";
import { nextVoiceActivityState } from "../../ui/src/pages/voice/voiceActivity";

describe("voice activity detection", () => {
  test("waits for speech before tracking silence", () => {
    expect(
      nextVoiceActivityState({
        rms: 0.01,
        now: 2_000,
        recordingStartedAt: 0,
        speechDetected: false,
        silenceStartedAt: null,
      })
    ).toEqual({ speechDetected: false, silenceStartedAt: null, shouldStop: false });
  });

  test("stops after sustained silence following speech", () => {
    expect(
      nextVoiceActivityState({
        rms: 0.01,
        now: 3_500,
        recordingStartedAt: 0,
        speechDetected: true,
        silenceStartedAt: 2_000,
      })
    ).toEqual({ speechDetected: true, silenceStartedAt: 2_000, shouldStop: true });
  });

  test("resets silence tracking when speech resumes", () => {
    expect(
      nextVoiceActivityState({
        rms: 0.08,
        now: 3_000,
        recordingStartedAt: 0,
        speechDetected: true,
        silenceStartedAt: 2_000,
      })
    ).toEqual({ speechDetected: true, silenceStartedAt: null, shouldStop: false });
  });

  test("stops an empty recording after the idle timeout", () => {
    expect(
      nextVoiceActivityState({
        rms: 0,
        now: 15_001,
        recordingStartedAt: 0,
        speechDetected: false,
        silenceStartedAt: null,
      }).shouldStop
    ).toBe(true);
  });
});
