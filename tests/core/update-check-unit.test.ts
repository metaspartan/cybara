import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { compareVersions, isNewerVersion } from "../../src/core/versioning";
import {
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  isUpdateCheckDisabled,
} from "../../src/core/update-check";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

describe("update-check semver comparison (compareVersions / isNewerVersion)", () => {
  test("update-check uses a strict > 0 newer decision", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
  });

  test("equal versions compare to 0 (many forms)", () => {
    const equalPairs: Array<[string, string]> = [
      ["1.0.0", "1.0.0"],
      ["v1.0.0", "1.0.0"],
      ["1.0.0", "V1.0.0"],
      ["2.10.3", "2.10.3"],
      ["1.0", "1.0.0"],
      ["1", "1.0.0"],
      ["  1.2.3  ", "1.2.3"],
      ["1.2.3", "1.2.3+build.99"],
    ];
    for (const [a, b] of equalPairs) {
      expect(compareVersions(a, b)).toBe(0);
      expect(isNewerVersion(a, b)).toBe(false);
      expect(isNewerVersion(b, a)).toBe(false);
    }
  });

  test("numeric ordering across each segment", () => {
    expect(sign(compareVersions("1.0.1", "1.0.0"))).toBe(1);
    expect(sign(compareVersions("1.1.0", "1.0.9"))).toBe(1);
    expect(sign(compareVersions("2.0.0", "1.99.99"))).toBe(1);
    expect(sign(compareVersions("1.0.0", "1.0.1"))).toBe(-1);
    expect(sign(compareVersions("1.0.10", "1.0.9"))).toBe(1);
    expect(sign(compareVersions("1.0.100", "1.0.20"))).toBe(1);
  });

  test("prerelease/build suffixes are stripped before compare", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3-rc.1", "1.2.3-rc.2")).toBe(0);
    expect(sign(compareVersions("1.2.4-beta", "1.2.3"))).toBe(1);
  });

  test("antisymmetry: compare(a,b) and compare(b,a) have opposite sign", () => {
    const rand = mulberry32(0xc0ffee);
    const seg = () => Math.floor(rand() * 30);
    const ver = () => `${seg()}.${seg()}.${seg()}`;
    for (let i = 0; i < 2000; i++) {
      const a = ver();
      const b = ver();
      const ab = sign(compareVersions(a, b));
      const ba = sign(compareVersions(b, a));
      expect(ab + ba).toBe(0);
      expect(isNewerVersion(a, b)).toBe(ab === 1);
    }
  });

  test("total-order transitivity holds on random triples", () => {
    const rand = mulberry32(0x1234abcd);
    const seg = () => Math.floor(rand() * 12);
    const ver = () => `${seg()}.${seg()}.${seg()}`;
    for (let i = 0; i < 1000; i++) {
      const a = ver();
      const b = ver();
      const c = ver();
      const ab = sign(compareVersions(a, b));
      const bc = sign(compareVersions(b, c));
      const ac = sign(compareVersions(a, c));
      if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
      if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
    }
  });

  test("malformed / garbage versions never throw and return a number", () => {
    const garbage = [
      "",
      "   ",
      "abc",
      "1.x.3",
      "...",
      "1..2",
      "v",
      "1.2.3.4.5.6",
      "🚀.0.0",
      "-1.0.0",
      "NaN.0.0",
      "Infinity",
      "1.2.3-",
      "1.2.3+",
    ];
    for (const a of garbage) {
      for (const b of [...garbage, "1.0.0"]) {
        const r = compareVersions(a, b);
        expect(typeof r).toBe("number");
        expect(Number.isNaN(r)).toBe(false);
        expect(() => isNewerVersion(a, b)).not.toThrow();
      }
    }
  });

  test("comparison is reflexive (compare(a,a) === 0)", () => {
    const rand = mulberry32(0x99);
    const seg = () => Math.floor(rand() * 50);
    for (let i = 0; i < 500; i++) {
      const v = `${seg()}.${seg()}.${seg()}`;
      expect(compareVersions(v, v)).toBe(0);
    }
  });
});

describe("isUpdateCheckDisabled", () => {
  const KEY = "CYBARA_DISABLE_UPDATE_CHECK";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  test("disabled for '1' and 'true'", () => {
    process.env[KEY] = "1";
    expect(isUpdateCheckDisabled()).toBe(true);
    process.env[KEY] = "true";
    expect(isUpdateCheckDisabled()).toBe(true);
  });

  test("not disabled for unset / other values", () => {
    delete process.env[KEY];
    expect(isUpdateCheckDisabled()).toBe(false);
    for (const v of ["0", "false", "", "yes", "TRUE", "2"]) {
      process.env[KEY] = v;
      expect(isUpdateCheckDisabled()).toBe(false);
    }
  });
});

describe("update-check constants", () => {
  test("default interval is 6 hours in ms", () => {
    expect(DEFAULT_UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
