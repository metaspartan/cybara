/**
 * Credential pool — rotate across multiple API keys per provider.
 *
 * Lets operators supply several keys for one provider (e.g.
 * `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_2`, …) so that a 429/quota/auth
 * failure on one key can trigger rotation to another instead of failing the
 * whole request. Round-robin selection with per-credential cooldown.
 *
 * Designed to wrap a provider fetch: acquire a credential, run the request,
 * release it (optionally marking it cooled-down on rate-limit/auth failure).
 */

import { isRateLimited, msUntilReset } from "./rate-limit-tracker";

export interface PooledCredential {
  /** The secret value passed to the provider (API key). */
  value: string;
  /** Optional label for logging (never the secret itself). */
  label: string;
  /** Epoch ms until which this credential should be skipped. */
  cooldownUntil: number;
}

interface PoolOptions {
  /** Default cooldown applied when a credential hits a rate limit (ms). */
  defaultCooldownMs?: number;
}

const pools = new Map<string, PooledCredential[]>();
const optionsByPool = new Map<string, PoolOptions>();

/**
 * Register credentials for a pool from environment variables matching a prefix.
 * Reads `PREFIX`, `PREFIX_2`, `PREFIX_3`, … Also accepts comma-separated values
 * in the base var. Idempotent — re-registering replaces the pool.
 */
export function registerCredentialsFromEnv(
  poolName: string,
  baseEnvVar: string,
  options?: PoolOptions
): number {
  const values: string[] = [];
  const base = process.env[baseEnvVar];
  if (base) {
    values.push(
      ...base
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    );
  }
  for (let i = 2; i <= 20; i += 1) {
    const extra = process.env[`${baseEnvVar}_${i}`];
    if (extra)
      values.push(
        ...extra
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      );
  }
  registerCredentials(poolName, values, options);
  return values.length;
}

/** Register an explicit list of credential values for a pool. */
export function registerCredentials(
  poolName: string,
  values: string[],
  options?: PoolOptions
): void {
  const creds: PooledCredential[] = values
    .filter((v) => typeof v === "string" && v.length > 0)
    .map((value, index) => ({ value, label: `${poolName}#${index + 1}`, cooldownUntil: 0 }));
  if (creds.length > 0) {
    pools.set(poolName, creds);
    if (options) optionsByPool.set(poolName, options);
  } else {
    pools.delete(poolName);
    optionsByPool.delete(poolName);
  }
}

export function poolSize(poolName: string): number {
  return pools.get(poolName)?.length ?? 0;
}

function nowAvailable(cred: PooledCredential): boolean {
  if (cred.cooldownUntil > Date.now()) return false;
  // Also respect tracked rate-limit windows for this credential.
  return !isRateLimited(cred.label);
}

/**
 * Acquire the next usable credential for a pool, round-robin. Returns null if
 * the pool is empty or all credentials are on cooldown. Does NOT block — callers
 * decide whether to wait using `msUntilAnyAvailable`.
 */
const roundRobinCursor = new Map<string, number>();
export function acquireCredential(poolName: string): PooledCredential | null {
  const creds = pools.get(poolName);
  if (!creds || creds.length === 0) return null;
  if (creds.length === 1) {
    return nowAvailable(creds[0]) ? creds[0] : null;
  }
  const start = roundRobinCursor.get(poolName) ?? 0;
  for (let offset = 0; offset < creds.length; offset += 1) {
    const index = (start + offset) % creds.length;
    if (nowAvailable(creds[index])) {
      roundRobinCursor.set(poolName, (index + 1) % creds.length);
      return creds[index];
    }
  }
  return null;
}

/** Mark a credential as rate-limited/auth-failed; it will be skipped until cooldown. */
export function markCredentialCooldown(
  poolName: string,
  credential: PooledCredential,
  reason: "rate_limit" | "auth" | "billing" = "rate_limit"
): void {
  const opts = optionsByPool.get(poolName);
  const baseCooldown = opts?.defaultCooldownMs ?? 60_000;
  // Auth/billing failures cool down longer than a transient rate-limit.
  const multiplier = reason === "rate_limit" ? 1 : 5;
  credential.cooldownUntil = Date.now() + baseCooldown * multiplier;
}

/** Clear a credential's cooldown after a successful use. */
export function markCredentialHealthy(_poolName: string, credential: PooledCredential): void {
  credential.cooldownUntil = 0;
}

/** Minimum ms until any credential in the pool becomes available (0 if one is ready). */
export function msUntilAnyAvailable(poolName: string): number {
  const creds = pools.get(poolName);
  if (!creds || creds.length === 0) return Infinity;
  const anyReady = creds.some(nowAvailable);
  if (anyReady) return 0;
  let min = Infinity;
  for (const cred of creds) {
    const credWait = Math.max(0, cred.cooldownUntil - Date.now());
    const limitWait = msUntilReset(cred.label);
    const wait = Math.max(credWait, limitWait);
    if (wait < min) min = wait;
  }
  return min;
}
