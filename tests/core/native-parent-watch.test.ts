import { describe, expect, test } from "bun:test";
import {
  nativeParentExited,
  parseNativeParentProcessId,
  processExists,
  startNativeParentWatch,
} from "../../src/core/native-parent-watch";

describe("native parent watch", () => {
  test("accepts only valid process identifiers", () => {
    expect(parseNativeParentProcessId(" 42 ")).toBe(42);
    expect(parseNativeParentProcessId(undefined)).toBeNull();
    expect(parseNativeParentProcessId("1")).toBeNull();
    expect(parseNativeParentProcessId("invalid")).toBeNull();
  });

  test("detects when the native app no longer owns the gateway", () => {
    expect(nativeParentExited(42, 42)).toBe(false);
    expect(nativeParentExited(42, 1)).toBe(true);
  });

  test("does not install a watcher outside the native app runtime", () => {
    expect(
      startNativeParentWatch(
        {},
        () => 1,
        () => undefined,
        1
      )
    ).toBeNull();
  });

  test("checks whether the expected parent process still exists", () => {
    expect(processExists(process.pid)).toBe(true);
    expect(processExists(2_147_483_647)).toBe(false);
  });

  test("exits when the expected parent no longer exists", async () => {
    let exited = false;
    const stop = startNativeParentWatch(
      { CYBARA_NATIVE_APP: "1", CYBARA_NATIVE_PARENT_PID: "42" },
      () => 42,
      () => {
        exited = true;
      },
      1,
      () => false
    );
    await Bun.sleep(10);
    stop?.();
    expect(exited).toBe(true);
  });
});
