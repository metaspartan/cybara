/**
 * A per-key serial execution queue. Calls with the same key run one at a time,
 * in submission order; calls with different keys run concurrently.
 *
 * Used to serialize chat turns per session so two near-simultaneous messages to
 * the same session can't interleave their user/assistant pushes or race a
 * mid-turn conversation compaction (which reassigns the message array).
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  /** Run `fn` after any in-flight work for `key` has settled. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Run fn once the previous work settles, regardless of whether it resolved
    // or rejected — one failed turn must not wedge the queue for the session.
    const result = prev.then(
      () => fn(),
      () => fn()
    );
    // The tail the next caller waits on settles after fn settles (either way).
    const tail = result.then(
      () => {},
      () => {}
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      // Drop the key once the queue drains so the map doesn't grow unbounded.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Number of keys with in-flight/queued work (for tests/diagnostics). */
  get activeKeyCount(): number {
    return this.tails.size;
  }
}
