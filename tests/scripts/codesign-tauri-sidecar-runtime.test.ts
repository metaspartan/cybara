import { describe, expect, test } from "bun:test";
import { resolveMacOSCodesignIdentity } from "../../scripts/codesign-tauri-sidecar-runtime";

describe("Tauri sidecar runtime signing helper", () => {
  test("resolves the macOS signing identity from CI-compatible environment names", () => {
    expect(
      resolveMacOSCodesignIdentity({
        CYBARA_MACOS_SIGN_IDENTITY: "Developer ID Application: Example",
      })
    ).toBe("Developer ID Application: Example");

    expect(
      resolveMacOSCodesignIdentity({
        MACOS_SIGN_IDENTITY: "Developer ID Application: Fallback",
      })
    ).toBe("Developer ID Application: Fallback");

    expect(resolveMacOSCodesignIdentity({ APPLE_SIGNING_IDENTITY: "Apple Identity" })).toBe(
      "Apple Identity"
    );
    expect(resolveMacOSCodesignIdentity({})).toBeNull();
  });
});
