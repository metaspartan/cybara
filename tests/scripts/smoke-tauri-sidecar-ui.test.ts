import { describe, expect, test } from "bun:test";
import {
  assertSidecarBuildCommit,
  assertSidecarVersion,
  sidecarSmokeAuthorization,
  sidecarStartTimeoutMs,
} from "../../scripts/smoke-tauri-sidecar-ui";

describe("sidecar release smoke", () => {
  test("gives emulated sidecars a generous startup window that CI can override", () => {
    expect(sidecarStartTimeoutMs({})).toBe(120_000);
    expect(sidecarStartTimeoutMs({ CYBARA_SIDECAR_SMOKE_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(sidecarStartTimeoutMs({ CYBARA_SIDECAR_SMOKE_TIMEOUT_MS: "nope" })).toBe(120_000);
    expect(sidecarStartTimeoutMs({ CYBARA_SIDECAR_SMOKE_TIMEOUT_MS: "-5" })).toBe(120_000);
  });

  test("release Android builds install only the SDK packages that still exist", async () => {
    const workflow = await Bun.file(".github/workflows/release.yml").text();
    const setup = workflow.slice(workflow.indexOf("name: Setup Android SDK"));
    expect(setup.slice(0, 260)).toContain("packages: platform-tools");
  });

  test("authenticates production sidecar requests with the isolated smoke key", () => {
    expect(sidecarSmokeAuthorization("cybara_smoke_test")).toBe("Bearer cybara_smoke_test");
  });

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

describe("Tauri sidecar build commit", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";

  test("accepts the exact compiled release commit", () => {
    expect(() => assertSidecarBuildCommit({ commit }, commit.toUpperCase())).not.toThrow();
  });

  test("rejects unavailable or mismatched release commits", () => {
    expect(() => assertSidecarBuildCommit({ commit: null }, commit)).toThrow(
      "Bundled gateway commit unavailable"
    );
    expect(() => assertSidecarBuildCommit({ commit: "abcdef0" }, commit)).toThrow(
      "does not match release commit"
    );
  });
});
