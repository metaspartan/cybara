import { describe, expect, test } from "bun:test";
import {
  buildReleaseChecksumUrl,
  compareVersions,
  isNewerVersion,
} from "../../src/core/versioning";

describe("compareVersions", () => {
  test("orders simple numeric versions", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("handles differing segment counts", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0);
  });

  test("strips a leading v and build metadata", () => {
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0+build", "1.0.0")).toBe(0);
    expect(compareVersions("v2.0.0-rc1", "1.9.9")).toBeGreaterThan(0);
  });
});

describe("isNewerVersion", () => {
  test("returns true only when the candidate is strictly newer", () => {
    expect(isNewerVersion("1.0.204", "1.0.203")).toBe(true);
    expect(isNewerVersion("1.0.203", "1.0.203")).toBe(false);
    expect(isNewerVersion("1.0.202", "1.0.203")).toBe(false);
  });
});

describe("buildReleaseChecksumUrl", () => {
  test("builds the latest download URL when no tag is given", () => {
    const url = buildReleaseChecksumUrl("metaspartan/cybara", "cybara-darwin-arm64");
    expect(url).toBe(
      "https://github.com/metaspartan/cybara/releases/download/latest/cybara-darwin-arm64.sha256"
    );
  });

  test("builds a tagged download URL when a tag is given", () => {
    const url = buildReleaseChecksumUrl("metaspartan/cybara", "cybara-linux-x64", "1.0.186");
    expect(url).toBe(
      "https://github.com/metaspartan/cybara/releases/download/v1.0.186/cybara-linux-x64.sha256"
    );
  });

  test("builds a Darwin ARM64 checksum URL from a versioned CLI asset", () => {
    const url = buildReleaseChecksumUrl(
      "metaspartan/cybara",
      "cybara-v1.0.1199-darwin-arm64-cli",
      "v1.0.1199"
    );
    expect(url).toBe(
      "https://github.com/metaspartan/cybara/releases/download/v1.0.1199/cybara-v1.0.1199-darwin-arm64-cli.sha256"
    );
  });

  test("uses the default repository when none is provided", () => {
    const url = buildReleaseChecksumUrl("", "cybara-windows-x64.exe");
    expect(url).toContain("releases/download/latest/cybara-windows-x64.exe.sha256");
  });
});
