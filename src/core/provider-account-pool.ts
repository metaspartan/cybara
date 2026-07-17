import { config } from "./config";
import type { Provider } from "./database";
import type { LiveProviderUsage } from "./provider-usage-source";

export type ProviderAccountFailure = "auth" | "billing" | "rate_limit";

export interface ProviderAccountPoolMember {
  providerId: string;
  priority?: number;
}

export interface ProviderAccountPool {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  accounts: ProviderAccountPoolMember[];
}

export interface ProviderAccountPoolInput {
  name: string;
  provider: string;
  enabled?: boolean;
  accounts: Array<{ providerId: string; priority?: number }>;
}

const STORAGE_KEY = "provider_account_pools";
const ROUTE_PREFIX = "pool:";
const cooldownUntil = new Map<string, number>();

const COOLDOWN_MS: Record<ProviderAccountFailure, number> = {
  auth: 5 * 60 * 1000,
  billing: 24 * 60 * 60 * 1000,
  rate_limit: 60 * 60 * 1000,
};

function boundedPriority(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

function normalizeStoredPool(value: unknown): ProviderAccountPool | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
  const provider = typeof record.provider === "string" ? record.provider.trim() : "";
  if (!id || !name || !provider || !Array.isArray(record.accounts)) return undefined;
  let accounts: ProviderAccountPoolMember[] = record.accounts.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const account = entry as Record<string, unknown>;
    const providerId =
      typeof account.providerId === "string"
        ? account.providerId.trim()
        : typeof account.provider_id === "string"
          ? account.provider_id.trim()
          : "";
    return providerId ? [{ providerId, priority: boundedPriority(account.priority) }] : [];
  });
  if (accounts.length > 0 && accounts.every((account) => account.priority === 100)) {
    accounts = accounts.map((account) => ({ providerId: account.providerId }));
  }
  return {
    id,
    name,
    provider,
    enabled: record.enabled !== false,
    accounts,
  };
}

export function listProviderAccountPools(): ProviderAccountPool[] {
  const stored = config.get<unknown>(STORAGE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const pool = normalizeStoredPool(entry);
    return pool ? [pool] : [];
  });
}

export function getProviderAccountPool(id: string): ProviderAccountPool | undefined {
  return listProviderAccountPools().find((pool) => pool.id === id);
}

export function providerAccountPoolRouteId(id: string): string {
  return `${ROUTE_PREFIX}${id}`;
}

export function parseProviderAccountPoolRouteId(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value.startsWith(ROUTE_PREFIX)) return undefined;
  const id = value.slice(ROUTE_PREFIX.length).trim();
  return id || undefined;
}

export function providerAccountPoolRouteProvider(value: string | undefined): string | undefined {
  const id = parseProviderAccountPoolRouteId(value);
  return id ? getProviderAccountPool(id)?.provider : undefined;
}

function saveProviderAccountPools(pools: ProviderAccountPool[]): void {
  config.set(STORAGE_KEY, pools);
}

function normalizedPoolInput(
  input: ProviderAccountPoolInput,
  providers: readonly Provider[],
  existingId?: string
): Omit<ProviderAccountPool, "id"> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!name) throw new Error("Validation error: Pool name is required");
  if (!provider) throw new Error("Validation error: Pool provider is required");
  if (!Array.isArray(input.accounts) || input.accounts.length === 0) {
    throw new Error("Validation error: Select at least one provider account");
  }
  const providersById = new Map(providers.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const accounts = input.accounts.map((entry) => {
    const providerId = typeof entry.providerId === "string" ? entry.providerId.trim() : "";
    const account = providersById.get(providerId);
    if (!account || account.provider !== provider) {
      throw new Error("Validation error: Pool accounts must use the selected provider type");
    }
    if (seen.has(providerId)) throw new Error("Validation error: Pool accounts must be unique");
    seen.add(providerId);
    const priority = boundedPriority(entry.priority);
    return priority === undefined ? { providerId } : { providerId, priority };
  });
  const occupied = new Set(
    listProviderAccountPools()
      .filter((pool) => pool.id !== existingId)
      .flatMap((pool) => pool.accounts.map((account) => account.providerId))
  );
  if (accounts.some((account) => occupied.has(account.providerId))) {
    throw new Error("Validation error: A provider account can belong to only one pool");
  }
  if (accounts.some((account) => account.priority !== undefined)) {
    accounts.sort((left, right) => {
      if (left.priority === undefined) return 1;
      if (right.priority === undefined) return -1;
      return left.priority - right.priority || left.providerId.localeCompare(right.providerId);
    });
  }
  return {
    name,
    provider,
    enabled: input.enabled !== false,
    accounts,
  };
}

export function createProviderAccountPool(
  input: ProviderAccountPoolInput,
  providers: readonly Provider[]
): ProviderAccountPool {
  const pool = {
    id: crypto.randomUUID(),
    ...normalizedPoolInput(input, providers),
  };
  saveProviderAccountPools([...listProviderAccountPools(), pool]);
  return pool;
}

export function updateProviderAccountPool(
  id: string,
  input: ProviderAccountPoolInput,
  providers: readonly Provider[]
): ProviderAccountPool | undefined {
  const pools = listProviderAccountPools();
  const index = pools.findIndex((pool) => pool.id === id);
  if (index < 0) return undefined;
  const pool = { id, ...normalizedPoolInput(input, providers, id) };
  pools[index] = pool;
  saveProviderAccountPools(pools);
  return pool;
}

export function deleteProviderAccountPool(id: string): boolean {
  const pools = listProviderAccountPools();
  const next = pools.filter((pool) => pool.id !== id);
  if (next.length === pools.length) return false;
  saveProviderAccountPools(next);
  return true;
}

export function removeProviderFromAccountPools(providerId: string): void {
  const pools = listProviderAccountPools();
  const next = pools.flatMap((pool) => {
    const accounts = pool.accounts.filter((account) => account.providerId !== providerId);
    return accounts.length > 0 ? [{ ...pool, accounts }] : [];
  });
  if (JSON.stringify(next) !== JSON.stringify(pools)) saveProviderAccountPools(next);
  cooldownUntil.delete(providerId);
}

function isAvailable(providerId: string, now: number): boolean {
  const until = cooldownUntil.get(providerId) ?? 0;
  if (until <= now) {
    cooldownUntil.delete(providerId);
    return true;
  }
  return false;
}

export function providerAccountPoolCandidates(
  poolId: string | undefined,
  primary: Provider,
  providers: readonly Provider[],
  now = Date.now(),
  remainingByProviderId: ReadonlyMap<string, number> = new Map()
): Provider[] {
  if (!poolId) return [primary];
  const pool = getProviderAccountPool(poolId);
  if (!pool?.enabled || pool.provider !== primary.provider) return [];
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return pool.accounts
    .flatMap((member, index) => {
      const provider = providersById.get(member.providerId);
      return provider && provider.provider === pool.provider && isAvailable(provider.id, now)
        ? [{ provider, member, index }]
        : [];
    })
    .sort((left, right) => {
      const leftPriority = left.member.priority;
      const rightPriority = right.member.priority;
      if (leftPriority !== undefined || rightPriority !== undefined) {
        if (leftPriority === undefined) return 1;
        if (rightPriority === undefined) return -1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      }
      const leftRemaining = remainingByProviderId.get(left.provider.id);
      const rightRemaining = remainingByProviderId.get(right.provider.id);
      if (leftRemaining !== undefined || rightRemaining !== undefined) {
        if (leftRemaining === undefined) return 1;
        if (rightRemaining === undefined) return -1;
        if (leftRemaining !== rightRemaining) return rightRemaining - leftRemaining;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.provider);
}

export function providerAccountRemainingPercent(
  usage: LiveProviderUsage | null
): number | undefined {
  if (!usage) return undefined;
  const windows = [usage.fiveHour, usage.weekly, usage.monthly].filter(
    (window): window is NonNullable<typeof window> => Boolean(window)
  );
  if (windows.length === 0) return undefined;
  const limited = windows.filter((window) => window.unlimited !== true);
  if (limited.length === 0) return 100;
  return Math.min(...limited.map((window) => Math.max(0, Math.min(100, 100 - window.usedPercent))));
}

export function markProviderAccountUnavailable(
  providerId: string,
  failure: ProviderAccountFailure,
  now = Date.now()
): void {
  cooldownUntil.set(providerId, now + COOLDOWN_MS[failure]);
}

export function markProviderAccountHealthy(providerId: string): void {
  cooldownUntil.delete(providerId);
}

export function providerAccountCooldownUntil(providerId: string): number | undefined {
  const until = cooldownUntil.get(providerId);
  if (until === undefined) return undefined;
  if (until <= Date.now()) {
    cooldownUntil.delete(providerId);
    return undefined;
  }
  return until;
}

export function resetProviderAccountPoolsForTests(): void {
  cooldownUntil.clear();
  config.set(STORAGE_KEY, []);
}
