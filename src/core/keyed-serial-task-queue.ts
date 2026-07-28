export class KeyedSerialTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<Result>(key: string, task: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let current: Promise<Result>;
    current = previous.catch(() => undefined).then(task);
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  pendingKeys(): number {
    return this.tails.size;
  }
}
