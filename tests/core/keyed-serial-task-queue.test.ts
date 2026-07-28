import { describe, expect, test } from "bun:test";
import { KeyedSerialTaskQueue } from "../../src/core/keyed-serial-task-queue";

describe("keyed serial task queue", () => {
  test("runs work for one key in invocation order", async () => {
    const queue = new KeyedSerialTaskQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = queue.run("page-1", async () => {
      events.push("first:start");
      await firstPending;
      events.push("first:end");
      return 1;
    });
    const second = queue.run("page-1", async () => {
      events.push("second");
      return 2;
    });

    await Bun.sleep(0);
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
    expect(queue.pendingKeys()).toBe(0);
  });

  test("does not let a failed task block later work", async () => {
    const queue = new KeyedSerialTaskQueue();
    const failed = queue.run("page-1", async () => {
      throw new Error("resize failed");
    });
    const recovered = queue.run("page-1", async () => "recovered");

    await expect(failed).rejects.toThrow("resize failed");
    expect(await recovered).toBe("recovered");
  });

  test("allows different keys to run concurrently", async () => {
    const queue = new KeyedSerialTaskQueue();
    const events: string[] = [];
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run("page-1", async () => {
      await pending;
      events.push("page-1");
    });
    const second = queue.run("page-2", async () => {
      events.push("page-2");
    });

    await second;
    expect(events).toEqual(["page-2"]);
    release?.();
    await first;
  });
});
