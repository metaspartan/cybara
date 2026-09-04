import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  chunkPackages,
  isAdvisoryOutage,
  isTransportKill,
  parseLockfilePackages,
  shouldFailOnVuln,
} from "../../scripts/security-audit";

const SAMPLE_LOCKFILE = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "app",
      "dependencies": {
        "zod": "3.25.76"
      }
    }
  },
  "packages": {
    "@scope/thing": ["@scope/thing@2.1.0", "", {}, "sha512-aaa"],

    "zod": ["zod@3.25.76", "", {}, "sha512-bbb"],

    "left-pad": ["left-pad@1.3.0", "", { "dependencies": { "inner": "^9.9.9" } }, "sha512-ccc"],

    "app": ["app@workspace:.", ""],

    "patched": ["patched@patch:patched@1.0.0#./patches/x.patch", "", {}, "sha512-ddd"],

    "aliased": ["aliased@npm:other@4.5.6", "", {}, "sha512-eee"],

    "multi@1.0.0": ["multi@1.0.0", "", {}, "sha512-fff"],

    "peerresolved": ["peerresolved@2.0.0 (patch_hash=abc)", "", {}, "sha512-ggg"]
  }
}`;

const NO_PACKAGES_LOCKFILE = `{
  "lockfileVersion": 1,
  "workspaces": {}
}`;

describe("parseLockfilePackages", () => {
  test("extracts pinned scoped and unscoped versions", () => {
    expect(parseLockfilePackages(SAMPLE_LOCKFILE)).toEqual([
      { name: "@scope/thing", version: "2.1.0" },
      { name: "zod", version: "3.25.76" },
      { name: "left-pad", version: "1.3.0" },
      { name: "multi", version: "1.0.0" },
    ]);
  });

  test("ignores dependency spec ranges outside the packages section", () => {
    const refs = parseLockfilePackages(SAMPLE_LOCKFILE);
    expect(refs.find((ref) => ref.name === "app")).toBeUndefined();
    expect(refs.every((ref) => /^\d/.test(ref.version))).toBe(true);
  });

  test("returns empty for lockfiles without a packages section", () => {
    expect(parseLockfilePackages(NO_PACKAGES_LOCKFILE)).toEqual([]);
    expect(parseLockfilePackages("")).toEqual([]);
    expect(parseLockfilePackages("not json at all {")).toEqual([]);
  });

  test("parses the real root lockfile", () => {
    const refs = parseLockfilePackages(readFileSync("bun.lock", "utf8"));
    expect(refs.length).toBeGreaterThan(100);
    expect(refs).toContainEqual({ name: "@solana/web3.js", version: "1.98.4" });
    expect(refs.every((ref) => !ref.version.startsWith("workspace:"))).toBe(true);
  });
});

describe("isAdvisoryOutage", () => {
  test("detects npm advisory endpoint failures", () => {
    expect(
      isAdvisoryOutage(
        "error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - 503"
      )
    ).toBe(true);
    expect(
      isAdvisoryOutage(
        "error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - Timeout"
      )
    ).toBe(true);
    expect(isAdvisoryOutage("error: fetch failed")).toBe(true);
    expect(isAdvisoryOutage("error: unable to connect to registry")).toBe(true);
  });

  test("does not classify real audit findings as outages", () => {
    expect(isAdvisoryOutage("")).toBe(false);
    expect(isAdvisoryOutage("2 vulnerabilities found\nmoderate severity vulnerability in x")).toBe(
      false
    );
    expect(isAdvisoryOutage('error: script "audit:root" exited with code 1')).toBe(false);
  });
});

describe("isTransportKill", () => {
  test("detects a timeout kill", () => {
    expect(isTransportKill({ exitCode: null, signalCode: "SIGTERM", stderr: "" })).toBe(true);
  });

  test("does not treat normal exits as kills", () => {
    expect(isTransportKill({ exitCode: 0, signalCode: null, stderr: "" })).toBe(false);
    expect(isTransportKill({ exitCode: 1, signalCode: null, stderr: "vulns" })).toBe(false);
  });
});

describe("shouldFailOnVuln", () => {
  const ignored = new Set(["GHSA-ignored-0000"]);

  test("ignores allowlisted advisory ids", () => {
    expect(shouldFailOnVuln({ id: "GHSA-ignored-0000" }, ignored)).toBe(false);
  });

  test("fails on moderate and above", () => {
    expect(
      shouldFailOnVuln({ id: "GHSA-a", database_specific: { severity: "MODERATE" } }, ignored)
    ).toBe(true);
    expect(
      shouldFailOnVuln({ id: "GHSA-a", database_specific: { severity: "HIGH" } }, ignored)
    ).toBe(true);
    expect(
      shouldFailOnVuln({ id: "GHSA-a", database_specific: { severity: "CRITICAL" } }, ignored)
    ).toBe(true);
  });

  test("skips low severity", () => {
    expect(
      shouldFailOnVuln({ id: "GHSA-a", database_specific: { severity: "LOW" } }, ignored)
    ).toBe(false);
  });

  test("fails closed when severity is unknown", () => {
    expect(shouldFailOnVuln({ id: "GHSA-a" }, ignored)).toBe(true);
    expect(shouldFailOnVuln({ id: "GHSA-a", database_specific: { severity: 7 } }, ignored)).toBe(
      true
    );
  });

  test("skips withdrawn advisories", () => {
    expect(shouldFailOnVuln({ id: "GHSA-a", withdrawn: "2026-01-01T00:00:00Z" }, ignored)).toBe(
      false
    );
  });
});

describe("chunkPackages", () => {
  const refs = Array.from({ length: 7 }, (_, i) => ({ name: `p${i}`, version: "1.0.0" }));

  test("splits into full chunks plus remainder", () => {
    expect(chunkPackages(refs, 3)).toEqual([refs.slice(0, 3), refs.slice(3, 6), refs.slice(6)]);
  });

  test("handles empty input", () => {
    expect(chunkPackages([], 500)).toEqual([]);
  });
});
