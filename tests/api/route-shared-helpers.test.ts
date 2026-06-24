import { describe, expect, test } from "bun:test";
import {
  isObjectRecord,
  localDateKeyFromMs,
  normalizeOptionalString,
  normalizeSecretString,
  parseJsonArray,
  parseJsonObject,
  parseOptionalNumber,
  sumMetricValues,
  toFiniteNumber,
  toNonEmptyString,
} from "../../src/api/routes/_shared";

describe("route _shared pure helpers", () => {
  describe("parseJsonObject", () => {
    test("returns the object for a plain object", () => {
      const obj = { a: 1 };
      expect(parseJsonObject(obj)).toBe(obj);
    });
    test("parses a JSON object string", () => {
      expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    });
    test("returns null for arrays, primitives, malformed JSON", () => {
      expect(parseJsonObject([1, 2])).toBeNull();
      expect(parseJsonObject("not json")).toBeNull();
      expect(parseJsonObject(42)).toBeNull();
      expect(parseJsonObject('[1,2]')).toBeNull();
    });
  });

  describe("parseJsonArray", () => {
    test("returns the array for an array", () => {
      expect(parseJsonArray([1, 2])).toEqual([1, 2]);
    });
    test("parses a JSON array string", () => {
      expect(parseJsonArray("[1,2,3]")).toEqual([1, 2, 3]);
    });
    test("returns empty array for non-array input", () => {
      expect(parseJsonArray({ a: 1 })).toEqual([]);
      expect(parseJsonArray("nope")).toEqual([]);
      expect(parseJsonArray(5)).toEqual([]);
    });
  });

  describe("toFiniteNumber", () => {
    test("coerces numeric strings", () => {
      expect(toFiniteNumber("42")).toBe(42);
      expect(toFiniteNumber(3.5)).toBe(3.5);
    });
    test("returns null for non-finite / non-numeric", () => {
      expect(toFiniteNumber("abc")).toBeNull();
      expect(toFiniteNumber(null)).toBeNull();
      expect(toFiniteNumber(Infinity)).toBeNull();
      expect(toFiniteNumber(NaN)).toBeNull();
    });
  });

  describe("parseOptionalNumber / toNonEmptyString / normalizeOptionalString / normalizeSecretString", () => {
    test("parseOptionalNumber parses when valid, undefined otherwise", () => {
      expect(parseOptionalNumber("7")).toBe(7);
      expect(parseOptionalNumber(undefined)).toBeUndefined();
      expect(parseOptionalNumber("nope")).toBeUndefined();
    });
    test("toNonEmptyString trims and returns non-empty, null otherwise", () => {
      expect(toNonEmptyString("  hi  ")).toBe("hi");
      expect(toNonEmptyString("   ")).toBeNull();
      expect(toNonEmptyString(null)).toBeNull();
    });
    test("normalizeOptionalString returns string or undefined", () => {
      expect(normalizeOptionalString("x")).toBe("x");
      expect(normalizeOptionalString(undefined)).toBeUndefined();
    });
    test("normalizeSecretString trims newlines and whitespace", () => {
      expect(normalizeSecretString("  sk-key  ")).toBe("sk-key");
      expect(normalizeSecretString("line1\nline2")).toBe("line1line2");
      expect(normalizeSecretString(undefined)).toBeUndefined();
      expect(normalizeSecretString("   ")).toBeUndefined();
    });
  });

  describe("isObjectRecord", () => {
    test("true for plain objects, false for arrays/null/primitives", () => {
      expect(isObjectRecord({ a: 1 })).toBe(true);
      expect(isObjectRecord([1])).toBe(false);
      expect(isObjectRecord(null)).toBe(false);
      expect(isObjectRecord("x")).toBe(false);
    });
  });

  describe("localDateKeyFromMs", () => {
    test("returns a YYYY-MM-DD style key", () => {
      const key = localDateKeyFromMs(Date.UTC(2026, 5, 24));
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("sumMetricValues", () => {
    test("sums values for entries matching the predicate", () => {
      const entries = [
        { value: 5, created_at: "2026-06-24T00:00:00Z" },
        { value: 3, created_at: "2026-06-24T00:00:00Z" },
        { value: 2, created_at: "2026-06-25T00:00:00Z" },
      ] as never;
      // Predicate selects only June-24 entries.
      const result = sumMetricValues(entries, (_e, ts) => ts !== null && ts < Date.parse("2026-06-25T00:00:00Z"));
      expect(result).toBe(8);
    });
    test("returns 0 when nothing matches", () => {
      expect(sumMetricValues([{ value: 5, created_at: "x" }] as never, () => false)).toBe(0);
    });
  });
});
