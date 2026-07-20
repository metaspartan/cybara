import { describe, expect, test } from "bun:test";
import { assertSidecarVersion } from "../../scripts/smoke-tauri-sidecar-ui";

describe("sidecar release smoke", () => {
  test("accepts a gateway matching the app version", () => {
    expect(() => assertSidecarVersion({ version: "1.0.1798" }, "1.0.1798")).not.toThrow();
  });

  test("rejects a gateway older than the app", () => {
    expect(() => assertSidecarVersion({ version: "1.0.1719" }, "1.0.1798")).toThrow(
      "Bundled gateway version 1.0.1719 does not match app version 1.0.1798"
    );
  });

  test("rejects missing or malformed gateway versions", () => {
    expect(() => assertSidecarVersion({}, "1.0.1798")).toThrow("Bundled gateway version unknown");
    expect(() => assertSidecarVersion({ version: 1798 }, "1.0.1798")).toThrow(
      "Bundled gateway version unknown"
    );
  });
});
