import { describe, expect, test } from "bun:test";
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
});
