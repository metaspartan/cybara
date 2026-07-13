import { describe, expect, test } from "bun:test";
import { createSerializedSettingsPersistence } from "../../ui/src/pages/settings/serializedSettingsPersistence";

describe("serialized settings persistence", () => {
  test("keeps rapid updates ordered and non-overlapping", async () => {
    const started: number[] = [];
    const completed: number[] = [];
    let active = 0;
    let maxActive = 0;
    const persistence = createSerializedSettingsPersistence<number>(async (value) => {
      started.push(value);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(value === 1 ? 15 : 1);
      completed.push(value);
      active -= 1;
    });

    await Promise.all([persistence.enqueue(1), persistence.enqueue(2), persistence.enqueue(3)]);

    expect(started).toEqual([1, 2, 3]);
    expect(completed).toEqual([1, 2, 3]);
    expect(maxActive).toBe(1);
  });

  test("continues saving after a failed update", async () => {
    const saved: string[] = [];
    const persistence = createSerializedSettingsPersistence<string>(async (value) => {
      if (value === "bad") throw new Error("save failed");
      saved.push(value);
    });

    const failed = persistence.enqueue("bad");
    const recovered = persistence.enqueue("good");

    await expect(failed).rejects.toThrow("save failed");
    await expect(recovered).resolves.toBeUndefined();
    expect(saved).toEqual(["good"]);
  });
});
