import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { nativeAudioErrorMessage } from "../../ui/src/lib/nativeDesktopAudio";

describe("native audio recorder errors", () => {
  test("preserves plugin string errors", () => {
    expect(nativeAudioErrorMessage("input device unavailable", "fallback")).toBe(
      "input device unavailable"
    );
    expect(nativeAudioErrorMessage(new Error("permission denied"), "fallback")).toBe(
      "permission denied"
    );
    expect(nativeAudioErrorMessage({ message: "device unavailable" }, "fallback")).toBe(
      "device unavailable"
    );
    expect(nativeAudioErrorMessage(null, "fallback")).toBe("fallback");
  });

  test("sends native WAV recordings directly to the gateway for local Whisper", () => {
    for (const file of ["Chat.tsx", "Voice.tsx"]) {
      const source = readFileSync(join(import.meta.dir, "../../ui/src/pages", file), "utf8");
      expect(source).toContain("...recording,");
      expect(source).not.toContain("audioBlobToLocalPcm(nativeRecordingBlob(recording))");
    }
  });
});
