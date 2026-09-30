import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { hasBinary, prewarmBinaryAvailability } from "../../src/core/skills/gating";

const presentBinary = basename(process.execPath);
const missingBinary = "cybara-definitely-not-a-real-binary";

describe("binary availability gating", () => {
  test("reports a missing binary as unavailable", () => {
    expect(hasBinary(missingBinary)).toBe(false);
  });

  test("returns a stable answer for repeated lookups of a missing binary", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(hasBinary(missingBinary)).toBe(false);
    }
  });

  test("detects the running runtime binary on PATH", () => {
    expect(hasBinary(presentBinary)).toBe(true);
  });

  test("returns a stable answer for repeated lookups of a present binary", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(hasBinary(presentBinary)).toBe(true);
    }
  });

  test("prewarm agrees with synchronous lookups for available binaries", async () => {
    await prewarmBinaryAvailability([presentBinary]);
    expect(hasBinary(presentBinary)).toBe(true);
  });

  test("prewarm agrees with synchronous lookups for unavailable binaries", async () => {
    const uniqueMissing = `${missingBinary}-prewarm`;
    await prewarmBinaryAvailability([uniqueMissing]);
    expect(hasBinary(uniqueMissing)).toBe(false);
  });

  test("prewarm does not corrupt availability of other binaries", async () => {
    await prewarmBinaryAvailability([presentBinary, missingBinary]);
    expect(hasBinary(presentBinary)).toBe(true);
    expect(hasBinary(missingBinary)).toBe(false);
  });

  test("prewarm tolerates empty, blank and duplicated input", async () => {
    await prewarmBinaryAvailability([]);
    await prewarmBinaryAvailability(["", "   "]);
    await prewarmBinaryAvailability([presentBinary, presentBinary, presentBinary]);
    expect(hasBinary("")).toBe(false);
    expect(hasBinary(presentBinary)).toBe(true);
  });
});
