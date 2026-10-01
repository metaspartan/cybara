import { expect, test } from "bun:test";
import { removeTestHome } from "../../scripts/test-home-cleanup";

function lockError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

for (const locks of [0, 1, 2])
  test(`cleanup retries ${locks} transient locks and completes without hiding failures`, async () => {
    let removed = 0;
    let waits = 0;
    await removeTestHome("fixture", {
      attempts: 3,
      remove: () => {
        removed += 1;
        if (removed <= locks) throw lockError("EBUSY");
      },
      wait: async () => {
        waits += 1;
      },
    });
    expect(removed).toBe(locks + 1);
    expect(waits).toBe(locks);
  });

test("cleanup rejects the smallest count beyond its retry boundary", async () => {
  let removed = 0;
  let waits = 0;
  await expect(
    removeTestHome("fixture", {
      attempts: 3,
      remove: () => {
        removed += 1;
        throw lockError("EBUSY");
      },
      wait: async () => {
        waits += 1;
      },
    })
  ).rejects.toThrow("EBUSY");
  expect(removed).toBe(3);
  expect(waits).toBe(2);
});

test("cleanup never retries unrelated filesystem failures", async () => {
  let removed = 0;
  let waits = 0;
  await expect(
    removeTestHome("fixture", {
      remove: () => {
        removed += 1;
        throw lockError("EINVAL");
      },
      wait: async () => {
        waits += 1;
      },
    })
  ).rejects.toThrow("EINVAL");
  expect(removed).toBe(1);
  expect(waits).toBe(0);
});
