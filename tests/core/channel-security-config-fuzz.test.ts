import { describe, expect, test } from "bun:test";
import {
  buildChannelSecurityConfig,
  generatePairingCode,
  DEFAULT_SECURITY_CONFIG,
} from "../../src/core/channels/security";

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

const rand = mulberry32(0xbadf00d);
function randInt(max: number): number {
  return Math.floor(rand() * max);
}

const POOLS = [
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  " \t\n\r-_.!@#$%^&*()[]{}|\\:;\"'<>,?/",
  "日本語漢字😀🔥💀áéíóúßÆ​  ",
];
function randString(maxLen: number): string {
  const pool = POOLS[randInt(POOLS.length)];
  const len = randInt(maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[randInt(pool.length)];
  return out;
}

function randValue(depth = 0): unknown {
  switch (randInt(depth > 2 ? 6 : 9)) {
    case 0:
      return randString(40);
    case 1:
      return randInt(1_000_000) - 500_000;
    case 2:
      return rand() > 0.5;
    case 3:
      return null;
    case 4:
      return undefined;
    case 5:
      return Array.from({ length: randInt(6) }, () => randValue(depth + 1));
    case 6:
      return { [randString(6)]: randValue(depth + 1) };
    case 7:
      return NaN;
    default:
      return { dm_policy: randValue(depth + 1), group_policy: randValue(depth + 1) };
  }
}

const VALID_DM = new Set(["pairing", "allowlist", "open", "disabled"]);
const VALID_GROUP = new Set(["owner_only", "allowlist", "open", "disabled"]);

function assertValidShape(cfg: ReturnType<typeof buildChannelSecurityConfig>): void {
  const merged = { ...DEFAULT_SECURITY_CONFIG, ...cfg };
  expect(VALID_DM.has(merged.dm_policy)).toBe(true);
  expect(VALID_GROUP.has(merged.group_policy)).toBe(true);
  expect(typeof merged.group_owner_sender_id).toBe("string");
  expect(Array.isArray(merged.allowed_senders)).toBe(true);
  for (const s of merged.allowed_senders) {
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toBe(s.trim());
  }
  expect(typeof merged.pairing_expiry_minutes).toBe("number");
  expect(typeof merged.max_pending_pairings).toBe("number");
}

describe("buildChannelSecurityConfig fuzz", () => {
  test("fixed adversarial inputs never throw and yield a valid shape", () => {
    const fixed: Record<string, unknown>[] = [
      {},
      { dm_policy: "open" },
      { dm_policy: "OPEN" },
      { dm_policy: 123, group_policy: [] },
      { dm_policy: null, group_policy: null },
      { dm_policy: "'; DROP TABLE channels; --" },
      { group_owner_sender_id: "   spaced   " },
      { group_owner_sender_id: 42 },
      { owner_sender_id: "fallback-owner" },
      { allowed_senders: ["a", "", "  ", "b", 1, null, undefined, {}, ["nested"]] },
      { allowed_senders: "not-an-array" },
      { allowed_senders: new Array(10_000).fill("x") },
      { allowed_senders: [" trimmed ", "\t\n"] },
      { dm_policy: "😀", group_policy: "日本語" },
      { dm_policy: "A".repeat(100_000) },
      { __proto__: { dm_policy: "open" } },
      { constructor: "x", toString: "y" },
    ];
    for (const input of fixed) {
      let out: ReturnType<typeof buildChannelSecurityConfig>;
      expect(() => {
        out = buildChannelSecurityConfig(input);
      }).not.toThrow();
      assertValidShape(out!);
    }
  });

  test("2000 random garbage objects never throw and yield a valid shape", () => {
    for (let i = 0; i < 2000; i++) {
      const obj: Record<string, unknown> = {};
      const nKeys = randInt(6);
      const knownKeys = [
        "dm_policy",
        "group_policy",
        "group_owner_sender_id",
        "owner_sender_id",
        "allowed_senders",
        randString(8),
      ];
      for (let k = 0; k < nKeys; k++) {
        obj[knownKeys[randInt(knownKeys.length)]] = randValue();
      }
      let out: ReturnType<typeof buildChannelSecurityConfig>;
      expect(() => {
        out = buildChannelSecurityConfig(obj);
      }).not.toThrow();
      assertValidShape(out!);
    }
  });

  test("valid policies are preserved; invalid fall back to defaults", () => {
    for (const p of VALID_DM) {
      expect(buildChannelSecurityConfig({ dm_policy: p }).dm_policy).toBe(p);
    }
    for (const p of VALID_GROUP) {
      expect(buildChannelSecurityConfig({ group_policy: p }).group_policy).toBe(p);
    }
    expect(buildChannelSecurityConfig({ dm_policy: "nope" }).dm_policy).toBe("pairing");
    expect(buildChannelSecurityConfig({ group_policy: "nope" }).group_policy).toBe("owner_only");
  });

  test("owner_sender_id is used as fallback and trimmed", () => {
    expect(buildChannelSecurityConfig({ owner_sender_id: "  bob  " }).group_owner_sender_id).toBe(
      "bob"
    );
    expect(
      buildChannelSecurityConfig({ group_owner_sender_id: "alice", owner_sender_id: "bob" })
        .group_owner_sender_id
    ).toBe("alice");
  });
});

describe("generatePairingCode", () => {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const AMBIGUOUS = new Set(["0", "O", "1", "I"]);

  test("5000 codes: correct length, charset, no ambiguous chars, low collision rate", () => {
    const seen = new Set<string>();
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const code = generatePairingCode();
      expect(code.length).toBe(6);
      for (const ch of code) {
        expect(ALPHABET.includes(ch)).toBe(true);
        expect(AMBIGUOUS.has(ch)).toBe(false);
      }
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThanOrEqual(N - 3);
  });

  test("charset covers a broad range across many samples (entropy sanity)", () => {
    const chars = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      for (const ch of generatePairingCode()) chars.add(ch);
    }
    expect(chars.size).toBeGreaterThan(ALPHABET.length - 4);
  });
});
