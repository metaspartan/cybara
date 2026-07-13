interface PendingPermit {
  resolve: (release: (() => void) | undefined) => void;
  signal?: AbortSignal;
  abort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly pending: PendingPermit[] = [];

  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Concurrency maximum must be a positive integer");
    }
  }

  async acquire(signal?: AbortSignal, timeoutMs?: number): Promise<(() => void) | undefined> {
    if (signal?.aborted) return undefined;
    if (this.active < this.maximum) {
      this.active += 1;
      return this.createRelease();
    }

    return await new Promise<(() => void) | undefined>((resolve) => {
      const permit: PendingPermit = { resolve, signal };
      const cancel = (): void => {
        const index = this.pending.indexOf(permit);
        if (index >= 0) this.pending.splice(index, 1);
        this.cleanup(permit);
        resolve(undefined);
      };
      permit.abort = cancel;
      signal?.addEventListener("abort", cancel, { once: true });
      if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        permit.timeout = setTimeout(cancel, timeoutMs);
      }
      this.pending.push(permit);
      if (signal?.aborted) cancel();
    });
  }

  private createRelease(): () => void {
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.grantNext();
    };
  }

  private grantNext(): void {
    while (this.active < this.maximum) {
      const permit = this.pending.shift();
      if (!permit) return;
      this.cleanup(permit);
      if (permit.signal?.aborted) {
        permit.resolve(undefined);
        continue;
      }
      this.active += 1;
      permit.resolve(this.createRelease());
      return;
    }
  }

  private cleanup(permit: PendingPermit): void {
    if (permit.timeout) clearTimeout(permit.timeout);
    if (permit.abort) permit.signal?.removeEventListener("abort", permit.abort);
  }
}
