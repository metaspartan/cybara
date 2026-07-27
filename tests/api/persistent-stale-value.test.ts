import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createPersistentStaleValue } from "../../src/api/persistent-stale-value";

interface TestValue {
  count: number;
}

const temporaryDirectories: string[] = [];

function isTestValue(value: unknown): value is TestValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { count?: unknown }).count === "number"
  );
}

async function temporaryCachePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cybara-persistent-cache-"));
  temporaryDirectories.push(directory);
  return join(directory, "cache.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("persistent stale value", () => {
  test("deduplicates computation and restores a fresh value from disk", async () => {
    const filePath = await temporaryCachePath();
    let firstComputations = 0;
    const first = createPersistentStaleValue<TestValue>({
      filePath,
      ttlMs: 60_000,
      version: 1,
      compute: async () => {
        firstComputations += 1;
        await Bun.sleep(10);
        return { count: 7 };
      },
      isValue: isTestValue,
    });

    expect(await Promise.all([first(), first(), first()])).toEqual([
      { count: 7 },
      { count: 7 },
      { count: 7 },
    ]);
    expect(firstComputations).toBe(1);

    let restoredComputations = 0;
    const restored = createPersistentStaleValue<TestValue>({
      filePath,
      ttlMs: 60_000,
      version: 1,
      compute: () => ({ count: ++restoredComputations }),
      isValue: isTestValue,
    });

    expect(await restored()).toEqual({ count: 7 });
    expect(restoredComputations).toBe(0);
  });

  test("serves an expired persisted value while refreshing it", async () => {
    const filePath = await temporaryCachePath();
    await Bun.write(
      filePath,
      JSON.stringify({ version: 1, at: Date.now() - 60_000, value: { count: 3 } })
    );
    let computations = 0;
    const value = createPersistentStaleValue<TestValue>({
      filePath,
      ttlMs: 10,
      version: 1,
      compute: async () => {
        computations += 1;
        await Bun.sleep(20);
        return { count: 9 };
      },
      isValue: isTestValue,
    });

    const started = performance.now();
    expect(await value()).toEqual({ count: 3 });
    expect(performance.now() - started).toBeLessThan(15);
    expect(computations).toBe(1);
    await Bun.sleep(30);
    expect(await value()).toEqual({ count: 9 });
  });

  test("rejects incompatible cache versions and malformed values", async () => {
    const filePath = await temporaryCachePath();
    await Bun.write(
      filePath,
      JSON.stringify({ version: 1, at: Date.now(), value: { count: "invalid" } })
    );
    let computations = 0;
    const value = createPersistentStaleValue<TestValue>({
      filePath,
      ttlMs: 60_000,
      version: 2,
      compute: () => ({ count: ++computations }),
      isValue: isTestValue,
    });

    expect(await value()).toEqual({ count: 1 });
    expect(computations).toBe(1);
  });

  test("retries after a synchronous computation failure", async () => {
    const filePath = await temporaryCachePath();
    let computations = 0;
    const value = createPersistentStaleValue<TestValue>({
      filePath,
      ttlMs: 60_000,
      version: 1,
      compute: () => {
        computations += 1;
        if (computations === 1) throw new Error("temporary failure");
        return { count: computations };
      },
      isValue: isTestValue,
    });

    await expect(value()).rejects.toThrow("temporary failure");
    expect(await value()).toEqual({ count: 2 });
  });
});
