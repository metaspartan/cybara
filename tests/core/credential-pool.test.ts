import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  acquireCredential,
  markCredentialCooldown,
  markCredentialHealthy,
  msUntilAnyAvailable,
  poolSize,
  registerCredentials,
  registerCredentialsFromEnv,
  type PooledCredential,
} from "../../src/core/credential-pool";

function freshPool(name: string, keys: string[]): string {
  registerCredentials(name, keys);
  return name;
}

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

const TRACKED_ENV_VARS = [
  "TESTPROV_API_KEY",
  "TESTPROV_API_KEY_2",
  "TESTPROV_API_KEY_3",
  "TESTPROV_API_KEY_4",
  "TESTPROV_API_KEY_20",
  "TESTPROV_API_KEY_21",
];

describe("credential-pool", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of TRACKED_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TRACKED_ENV_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe("env discovery", () => {
    test("discovers base key with no suffixes", () => {
      process.env.TESTPROV_API_KEY = "base";
      const name = `env-base-${Date.now()}`;
      const count = registerCredentialsFromEnv(name, "TESTPROV_API_KEY");
      expect(count).toBe(1);
      expect(poolSize(name)).toBe(1);
      expect(acquireCredential(name)?.value).toBe("base");
    });

    test("discovers base + _2/_3 suffixed keys in order", () => {
      process.env.TESTPROV_API_KEY = "k1";
      process.env.TESTPROV_API_KEY_2 = "k2";
      process.env.TESTPROV_API_KEY_3 = "k3";
      const name = `env-multi-${Date.now()}`;
      const count = registerCredentialsFromEnv(name, "TESTPROV_API_KEY");
      expect(count).toBe(3);
      expect(poolSize(name)).toBe(3);
      const seen = new Set([
        acquireCredential(name)?.value,
        acquireCredential(name)?.value,
        acquireCredential(name)?.value,
      ]);
      expect(seen).toEqual(new Set(["k1", "k2", "k3"]));
    });

    test("skips a missing intermediate suffix but keeps later ones", () => {
      process.env.TESTPROV_API_KEY = "k1";
      process.env.TESTPROV_API_KEY_3 = "k3";
      const name = `env-gap-${Date.now()}`;
      const count = registerCredentialsFromEnv(name, "TESTPROV_API_KEY");
      expect(count).toBe(2);
      const seen = new Set<string | undefined>();
      for (let i = 0; i < 4; i += 1) seen.add(acquireCredential(name)?.value);
      expect(seen).toEqual(new Set(["k1", "k3"]));
    });

    test("expands comma-separated values in a single env var", () => {
      process.env.TESTPROV_API_KEY = " a , b ,c ";
      const name = `env-csv-${Date.now()}`;
      const count = registerCredentialsFromEnv(name, "TESTPROV_API_KEY");
      expect(count).toBe(3);
      const seen = new Set<string | undefined>();
      for (let i = 0; i < 5; i += 1) seen.add(acquireCredential(name)?.value);
      expect(seen).toEqual(new Set(["a", "b", "c"]));
    });

    test("stops scanning suffixes at the 20-key cap", () => {
      process.env.TESTPROV_API_KEY = "k1";
      process.env.TESTPROV_API_KEY_20 = "k20";
      process.env.TESTPROV_API_KEY_21 = "k21";
      const name = `env-cap-${Date.now()}`;
      const count = registerCredentialsFromEnv(name, "TESTPROV_API_KEY");
      expect(count).toBe(2);
      const seen = new Set<string | undefined>();
      for (let i = 0; i < 4; i += 1) seen.add(acquireCredential(name)?.value);
      expect(seen).toEqual(new Set(["k1", "k20"]));
    });

    test("returns 0 and an empty pool when no env vars are set", () => {
      const name = `env-none-${Date.now()}`;
      const count = registerCredentialsFromEnv(name, "TESTPROV_API_KEY");
      expect(count).toBe(0);
      expect(poolSize(name)).toBe(0);
      expect(acquireCredential(name)).toBeNull();
    });
  });

  describe("selection", () => {
    test("returns null for an empty pool", () => {
      const name = `empty-${Date.now()}`;
      registerCredentials(name, []);
      expect(poolSize(name)).toBe(0);
      expect(acquireCredential(name)).toBeNull();
      expect(msUntilAnyAvailable(name)).toBe(Infinity);
    });

    test("filters out empty/whitespace-only values on register", () => {
      const name = `filter-${Date.now()}`;
      registerCredentials(name, ["ok", ""]);
      expect(poolSize(name)).toBe(1);
      expect(acquireCredential(name)?.value).toBe("ok");
    });

    test("round-robin across multiple credentials wraps around", () => {
      const name = freshPool(`rr-${Date.now()}`, ["k1", "k2", "k3"]);
      const first = acquireCredential(name)?.value;
      const second = acquireCredential(name)?.value;
      const third = acquireCredential(name)?.value;
      expect(new Set([first, second, third]).size).toBe(3);
      expect(acquireCredential(name)?.value).toBe(first);
    });

    test("single-credential pool always returns the same key (no rotation)", () => {
      const name = freshPool(`single-${Date.now()}`, ["only"]);
      for (let i = 0; i < 10; i += 1) {
        expect(acquireCredential(name)?.value).toBe("only");
      }
    });

    test("single-credential pool returns null while cooled, recovers after", () => {
      const name = freshPool(`single-cool-${Date.now()}`, ["only"]);
      const cred = acquireCredential(name)!;
      markCredentialCooldown(name, cred, "rate_limit");
      expect(acquireCredential(name)).toBeNull();
      cred.cooldownUntil = Date.now() - 1;
      expect(acquireCredential(name)?.value).toBe("only");
    });

    test("re-registering replaces the pool (idempotent)", () => {
      const name = `reReg-${Date.now()}`;
      registerCredentials(name, ["a", "b", "c"]);
      expect(poolSize(name)).toBe(3);
      registerCredentials(name, ["x"]);
      expect(poolSize(name)).toBe(1);
      expect(acquireCredential(name)?.value).toBe("x");
    });
  });

  describe("cooldown and recovery", () => {
    test("a cooled credential is skipped while a healthy one exists", () => {
      const name = freshPool(`cool-${Date.now()}`, ["a", "b", "c"]);
      const first = acquireCredential(name)!;
      markCredentialCooldown(name, first, "rate_limit");
      for (let i = 0; i < 10; i += 1) {
        const next = acquireCredential(name);
        expect(next).not.toBeNull();
        expect(next!.value).not.toBe(first.value);
      }
    });

    test("markCredentialHealthy clears the cooldown", () => {
      const name = freshPool(`healthy-${Date.now()}`, ["a", "b"]);
      const first = acquireCredential(name)!;
      markCredentialCooldown(name, first, "rate_limit");
      expect(first.cooldownUntil).toBeGreaterThan(Date.now());
      markCredentialHealthy(name, first);
      expect(first.cooldownUntil).toBe(0);
      const seen = new Set([acquireCredential(name)?.value, acquireCredential(name)?.value]);
      expect(seen).toContain(first.value);
    });

    test("credential becomes available again once its cooldown has elapsed", () => {
      const name = freshPool(`recover-${Date.now()}`, ["a", "b"]);
      const cred = acquireCredential(name)!;
      markCredentialCooldown(name, cred, "rate_limit");
      const cooledValue = cred.value;
      let sawCooled = false;
      for (let i = 0; i < 6; i += 1) {
        if (acquireCredential(name)?.value === cooledValue) sawCooled = true;
      }
      expect(sawCooled).toBe(false);
      cred.cooldownUntil = Date.now() - 1;
      const seen = new Set<string | undefined>();
      for (let i = 0; i < 6; i += 1) seen.add(acquireCredential(name)?.value);
      expect(seen).toContain(cooledValue);
    });

    test("all cooled => acquire returns null and msUntilAnyAvailable is finite/positive", () => {
      const name = freshPool(`all-cool-${Date.now()}`, ["a", "b"]);
      const opts = { defaultCooldownMs: 5_000 };
      registerCredentials(name, ["a", "b"], opts);
      const a = acquireCredential(name)!;
      markCredentialCooldown(name, a, "rate_limit");
      const b = acquireCredential(name)!;
      markCredentialCooldown(name, b, "rate_limit");
      expect(acquireCredential(name)).toBeNull();
      const wait = msUntilAnyAvailable(name);
      expect(wait).toBeGreaterThan(0);
      expect(Number.isFinite(wait)).toBe(true);
      expect(wait).toBeLessThanOrEqual(5_000);
    });

    test("auth cooldown lasts longer than a rate-limit cooldown", () => {
      const name = freshPool(`auth-${Date.now()}`, ["a", "b"]);
      const opts = { defaultCooldownMs: 1_000 };
      registerCredentials(name, ["a", "b"], opts);
      const cred = acquireCredential(name)!;
      markCredentialCooldown(name, cred, "rate_limit");
      const rateLimitUntil = cred.cooldownUntil;
      cred.cooldownUntil = 0;
      markCredentialCooldown(name, cred, "auth");
      expect(cred.cooldownUntil).toBeGreaterThan(rateLimitUntil);
      cred.cooldownUntil = 0;
      markCredentialCooldown(name, cred, "billing");
      const billingUntil = cred.cooldownUntil;
      cred.cooldownUntil = 0;
      markCredentialCooldown(name, cred, "rate_limit");
      expect(billingUntil).toBeGreaterThan(cred.cooldownUntil);
    });

    test("msUntilAnyAvailable is 0 when a credential is ready", () => {
      const name = freshPool(`ready-${Date.now()}`, ["a", "b"]);
      expect(msUntilAnyAvailable(name)).toBe(0);
    });
  });

  describe("fuzz: report-failure / acquire invariants", () => {
    test("never returns a cooled key while a healthy one exists; never throws; stays in set", () => {
      const reasons: Array<"rate_limit" | "auth" | "billing"> = ["rate_limit", "auth", "billing"];

      for (let seed = 1; seed <= 40; seed += 1) {
        const rand = mulberry32(seed);
        const keyCount = 1 + Math.floor(rand() * 6);
        const keys = Array.from({ length: keyCount }, (_, i) => `s${seed}-k${i}`);
        const keySet = new Set(keys);
        const name = `fuzz-${seed}-${Date.now()}`;
        registerCredentials(name, keys, { defaultCooldownMs: 1_000 });
        const byValue = new Map<string, PooledCredential>();

        for (let step = 0; step < 200; step += 1) {
          let acquired: PooledCredential | null = null;
          expect(() => {
            acquired = acquireCredential(name);
          }).not.toThrow();

          const healthyExists = keys.some((k) => {
            const c = byValue.get(k);
            return !c || c.cooldownUntil <= Date.now();
          });

          if (acquired) {
            const cred = acquired as PooledCredential;
            expect(keySet.has(cred.value)).toBe(true);
            byValue.set(cred.value, cred);
            expect(cred.cooldownUntil <= Date.now()).toBe(true);

            const roll = rand();
            if (roll < 0.45) {
              markCredentialCooldown(name, cred, reasons[Math.floor(rand() * reasons.length)]);
            } else if (roll < 0.6) {
              markCredentialHealthy(name, cred);
            }
          } else {
            expect(healthyExists).toBe(false);
          }

          if (rand() < 0.2) {
            const target = byValue.get(keys[Math.floor(rand() * keys.length)]);
            if (target) target.cooldownUntil = Date.now() - 1;
          }

          const wait = msUntilAnyAvailable(name);
          expect(wait).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test("with at least one perpetually-healthy key, acquire is never null", () => {
      for (let seed = 100; seed <= 120; seed += 1) {
        const rand = mulberry32(seed);
        const keys = ["healthy", `s${seed}-a`, `s${seed}-b`, `s${seed}-c`];
        const name = `fuzz-live-${seed}-${Date.now()}`;
        registerCredentials(name, keys, { defaultCooldownMs: 10_000 });

        for (let step = 0; step < 150; step += 1) {
          const cred = acquireCredential(name);
          expect(cred).not.toBeNull();
          if (cred!.value !== "healthy" && rand() < 0.7) {
            markCredentialCooldown(name, cred!, "rate_limit");
          }
        }
      }
    });
  });
});
