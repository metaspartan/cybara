export class RecentMessageIds {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxEntries = 5_000
  ) {}

  accept(key: string, now = Date.now()): boolean {
    const expiresAt = this.entries.get(key);
    if (expiresAt && expiresAt > now) return false;
    this.entries.delete(key);
    this.entries.set(key, now + this.ttlMs);
    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now || this.entries.size > this.maxEntries) {
        this.entries.delete(key);
      }
      if (this.entries.size <= this.maxEntries && expiresAt > now) break;
    }
  }
}
