export interface DownloadTotalSnapshot {
  total: number;
  at: number;
}

export interface DownloadTotalCache {
  get(now?: number): Promise<DownloadTotalSnapshot>;
}

export function createDownloadTotalCache(
  fetchTotal: () => Promise<number>,
  ttlMs: number
): DownloadTotalCache {
  let snapshot: DownloadTotalSnapshot | null = null;
  let pending: Promise<DownloadTotalSnapshot> | null = null;

  async function refresh(at: number): Promise<DownloadTotalSnapshot> {
    try {
      const total = await fetchTotal();
      if (!Number.isFinite(total) || total < 0) throw new Error("Invalid download total");
      snapshot = { total, at };
      return snapshot;
    } catch (error) {
      if (snapshot) return snapshot;
      throw error;
    }
  }

  return {
    async get(now = Date.now()): Promise<DownloadTotalSnapshot> {
      if (snapshot && now - snapshot.at <= ttlMs) return snapshot;
      if (!pending) {
        pending = refresh(now).finally(() => {
          pending = null;
        });
      }
      return pending;
    },
  };
}
