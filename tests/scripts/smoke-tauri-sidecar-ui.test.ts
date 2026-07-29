import { describe, expect, test } from "bun:test";
import {
  assertSidecarBuildCommit,
  assertSidecarVersion,
} from "../../scripts/smoke-tauri-sidecar-ui";

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
