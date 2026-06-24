import { describe, expect, test } from "bun:test";
import {
  acquireCredential,
  markCredentialCooldown,
  markCredentialHealthy,
  msUntilAnyAvailable,
  poolSize,
  registerCredentials,
} from "../../src/core/credential-pool";

function freshPool(name: string, keys: string[]): string {
  registerCredentials(name, keys);
  return name;
}

describe("credential-pool", () => {
  test("returns null for an empty pool", () => {
    const name = `empty-${Date.now()}`;
    registerCredentials(name, []);
    expect(poolSize(name)).toBe(0);
    expect(acquireCredential(name)).toBeNull();
  });

  test("round-robin across multiple credentials", () => {
    const name = freshPool(`rr-${Date.now()}`, ["k1", "k2", "k3"]);
    const first = acquireCredential(name)?.value;
    const second = acquireCredential(name)?.value;
    const third = acquireCredential(name)?.value;
    expect(new Set([first, second, third]).size).toBe(3);
    // 4th wraps back to the first credential.
    const fourth = acquireCredential(name)?.value;
    expect(fourth).toBe(first);
  });

  test("a single-credential pool always returns the same key", () => {
    const name = freshPool(`single-${Date.now()}`, ["only"]);
    expect(acquireCredential(name)?.value).toBe("only");
    expect(acquireCredential(name)?.value).toBe("only");
  });

  test("cooled-down credentials are skipped", () => {
    const name = freshPool(`cool-${Date.now()}`, ["a", "b", "c"]);
    const first = acquireCredential(name)!;
    markCredentialCooldown(name, first, "rate_limit");
    // Should not return the cooled-down credential.
    for (let i = 0; i < 5; i += 1) {
      const next = acquireCredential(name);
      if (next) expect(next.value).not.toBe(first.value);
    }
  });

  test("markCredentialHealthy clears the cooldown", () => {
    const name = freshPool(`healthy-${Date.now()}`, ["a", "b"]);
    const first = acquireCredential(name)!;
    markCredentialCooldown(name, first, "rate_limit");
    markCredentialHealthy(name, first);
    // Now it's available again.
    const available = [acquireCredential(name)?.value, acquireCredential(name)?.value];
    expect(available).toContain(first.value);
  });

  test("auth cooldowns last longer than rate-limit cooldowns", () => {
    const name = freshPool(`auth-${Date.now()}`, ["a", "b"]);
    const cred = acquireCredential(name)!;
    const before = cred.cooldownUntil;
    markCredentialCooldown(name, cred, "auth");
    expect(cred.cooldownUntil).toBeGreaterThan(before);
    const authCooldown = cred.cooldownUntil;
    cred.cooldownUntil = 0;
    markCredentialHealthy(name, cred);
    markCredentialCooldown(name, cred, "rate_limit");
    expect(cred.cooldownUntil).toBeLessThan(authCooldown);
  });

  test("msUntilAnyAvailable is 0 when a credential is ready", () => {
    const name = freshPool(`ready-${Date.now()}`, ["a", "b"]);
    expect(msUntilAnyAvailable(name)).toBe(0);
  });
});
