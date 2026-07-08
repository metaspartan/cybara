export interface ReplayGuardOptions {
  maxSkewMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

export class ReplayGuard {
  private readonly maxSkewMs: number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly seen = new Map<string, number>();

  constructor(options: ReplayGuardOptions = {}) {
    this.maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  check(nonce: string, timestampMs: number): { ok: boolean; reason?: string } {
    if (!nonce) return { ok: false, reason: "missing nonce" };
    if (!Number.isFinite(timestampMs)) return { ok: false, reason: "invalid timestamp" };

    const current = this.now();
    if (Math.abs(current - timestampMs) > this.maxSkewMs) {
      return { ok: false, reason: "stale timestamp" };
    }

    this.prune(current);

    const key = `${timestampMs}:${nonce}`;
    if (this.seen.has(key)) return { ok: false, reason: "replayed nonce" };

    this.seen.set(key, current);
    return { ok: true };
  }

  private prune(current: number): void {
    for (const [key, at] of this.seen) {
      if (current - at > this.ttlMs) this.seen.delete(key);
    }
    if (this.seen.size > this.maxEntries) {
      const excess = this.seen.size - this.maxEntries;
      let removed = 0;
      for (const key of this.seen.keys()) {
        this.seen.delete(key);
        if (++removed >= excess) break;
      }
    }
  }
}

export function parseTimestampSeconds(raw: string): number {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return Number.NaN;
  return seconds * 1000;
}
