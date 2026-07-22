import { describe, expect, test } from "bun:test";
import { coalescePendingWork } from "../../src/core/coalesced-work";

describe("coalesced work", () => {
  test("shares one operation across concurrent callers", async () => {
    const pending = new Map<string, Promise<number>>();
    let calls = 0;
    let release: ((value: number) => void) | undefined;
    const operation = (): Promise<number> => {
      calls += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const first = coalescePendingWork(pending, "preview", operation);
    const second = coalescePendingWork(pending, "preview", operation);
    const third = coalescePendingWork(pending, "preview", operation);

    expect(calls).toBe(1);
    expect(pending.size).toBe(1);
    release?.(42);
    expect(await Promise.all([first, second, third])).toEqual([42, 42, 42]);
    expect(pending.size).toBe(0);
  });

  test("clears failed work so the next caller can retry", async () => {
    const pending = new Map<string, Promise<string>>();
    let calls = 0;
    const operation = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new Error("capture failed");
      return "recovered";
    };

    await expect(coalescePendingWork(pending, "preview", operation)).rejects.toThrow(
      "capture failed"
    );
    expect(pending.size).toBe(0);
    expect(await coalescePendingWork(pending, "preview", operation)).toBe("recovered");
    expect(calls).toBe(2);
  });

  test("does not merge different work keys", async () => {
    const pending = new Map<string, Promise<string>>();
    let calls = 0;
    const operation = async (value: string): Promise<string> => {
      calls += 1;
      await Bun.sleep(1);
      return value;
    };

    expect(
      await Promise.all([
        coalescePendingWork(pending, "ios", () => operation("ios")),
        coalescePendingWork(pending, "android", () => operation("android")),
      ])
    ).toEqual(["ios", "android"]);
    expect(calls).toBe(2);
  });
});
