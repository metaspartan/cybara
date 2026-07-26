import { isRateLimited, msUntilReset } from "./rate-limit-tracker";

export interface PooledCredential {
  value: string;
  label: string;
  cooldownUntil: number;
}

interface PoolOptions {
  defaultCooldownMs?: number;
}

const pools = new Map<string, PooledCredential[]>();
const optionsByPool = new Map<string, PoolOptions>();

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
  return !isRateLimited(cred.label);
}

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

export function markCredentialCooldown(
  poolName: string,
  credential: PooledCredential,
  reason: "rate_limit" | "auth" | "billing" = "rate_limit"
): void {
  const opts = optionsByPool.get(poolName);
  const baseCooldown = opts?.defaultCooldownMs ?? 60_000;
  const multiplier = reason === "rate_limit" ? 1 : 5;
  credential.cooldownUntil = Date.now() + baseCooldown * multiplier;
}

export function markCredentialHealthy(_poolName: string, credential: PooledCredential): void {
  credential.cooldownUntil = 0;
}

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
