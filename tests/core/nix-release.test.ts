import { describe, expect, test } from "bun:test";

import {
  buildNixRelease,
  isCurrentNixRelease,
  parseSha256Sidecar,
  readNixReleaseVersion,
  replaceNixReleaseVersion,
  sha256HexToSri,
} from "../../src/core/nix-release";

const DIGEST = "bea1c8d39726cf6ece13d64cfecac53c039ad199f4add85ac01928ed589d1423";

describe("Nix release metadata", () => {
  test("parses release checksum sidecars and converts them to SRI", () => {
    expect(parseSha256Sidecar(`${DIGEST}  cybara-cli`)).toBe(DIGEST);
    expect(parseSha256Sidecar(`sha256:${DIGEST}`)).toBe(DIGEST);
    expect(sha256HexToSri(DIGEST)).toBe("sha256-vqHI05cmz27OE9ZM/srFPAOa0Zn0rdhawBko7VidFCM=");
    expect(() => parseSha256Sidecar("sha256-")).toThrow();
  });

  test("advancing the version clears hashes from the previous release", () => {
    const current = buildNixRelease("1.0.10", {
      "x86_64-linux": "sha256-old-x64-linux",
      "aarch64-linux": "sha256-old-arm64-linux",
      "x86_64-darwin": "sha256-old-x64-darwin",
      "aarch64-darwin": "sha256-old-arm64-darwin",
    });
    const next = replaceNixReleaseVersion(current, "1.0.11");
    expect(readNixReleaseVersion(next)).toBe("1.0.11");
    expect(next).not.toContain("old-");
    expect(next.match(/sha256-"/g)).toHaveLength(4);
  });

  test("repeating version sync preserves hashes already produced for that release", () => {
    const current = buildNixRelease("1.0.11", {
      "x86_64-linux": "sha256-current-x64-linux",
      "aarch64-linux": "sha256-current-arm64-linux",
      "x86_64-darwin": "sha256-current-x64-darwin",
      "aarch64-darwin": "sha256-current-arm64-darwin",
    });
    expect(replaceNixReleaseVersion(current, "v1.0.11")).toBe(current);
    expect(isCurrentNixRelease(current, "1.0.11")).toBe(true);
    expect(isCurrentNixRelease(current, "1.0.10")).toBe(false);
  });
});
