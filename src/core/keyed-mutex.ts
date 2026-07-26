export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(
      () => fn(),
      () => fn()
    );
    const tail = result.then(
      () => {},
      () => {}
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  get activeKeyCount(): number {
    return this.tails.size;
  }

  isLocked(key: string): boolean {
    return this.tails.has(key);
  }

  async waitForIdle(key: string): Promise<void> {
    while (true) {
      const tail = this.tails.get(key);
      if (!tail) return;
      await tail;
      if (this.tails.get(key) === tail) return;
    }
  }
}
