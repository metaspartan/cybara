import { expect, test } from "bun:test";
import {
  MobileSimulatorLifecycle,
  type SimulatorLifecycleDriver,
} from "../../src/core/mobile-simulator-lifecycle";
import type { MobileSimulatorDevice } from "../../src/core/mobile-simulator";

function fixture(booted = false): {
  lifecycle: MobileSimulatorLifecycle;
  counts: { starts: number; stops: number };
  device: MobileSimulatorDevice;
} {
  const counts = { starts: 0, stops: 0 };
  const device: MobileSimulatorDevice = {
    id: "avd-one",
    name: "fixture",
    platform: "android",
    state: booted ? "booted" : "shutdown",
    interactive: true,
  };
  const driver: SimulatorLifecycleDriver = {
    resolve: async () => ({ ...device }),
    boot: async () => {
      counts.starts += 1;
      device.state = "booted";
      device.id = "emulator-5554";
      return { ...device };
    },
    shutdown: async () => {
      counts.stops += 1;
      device.state = "shutdown";
    },
  };
  return { lifecycle: new MobileSimulatorLifecycle(driver), counts, device };
}

test("zero, one and two session leases stop exactly the last owned device", async () => {
  for (const sessions of [0, 1, 2]) {
    const { lifecycle, counts } = fixture();
    for (let index = 0; index < sessions; index += 1)
      await lifecycle.start("android", "fixture", `session-${index}`);
    expect(counts.starts).toBe(sessions === 0 ? 0 : 1);
    for (let index = 0; index < sessions; index += 1) {
      await lifecycle.release(`session-${index}`);
      expect(counts.stops).toBe(index === sessions - 1 ? 1 : 0);
    }
    await lifecycle.release("absent");
    expect(counts.stops).toBe(sessions === 0 ? 0 : 1);
  }
});

test("pre-existing user devices and manual leases are never stopped by session completion", async () => {
  const existing = fixture(true);
  await existing.lifecycle.start("android", "fixture", "one");
  await existing.lifecycle.release("one");
  await existing.lifecycle.shutdown();
  expect(existing.counts).toEqual({ starts: 0, stops: 0 });
  const manual = fixture();
  await manual.lifecycle.start("android", "fixture");
  await manual.lifecycle.start("android", "fixture", "one");
  await manual.lifecycle.release("one");
  expect(manual.counts.stops).toBe(0);
  await manual.lifecycle.stop("android", "fixture");
  expect(manual.counts.stops).toBe(1);
});

test("simultaneous starts share one boot and cancelled startup awaits native cleanup", async () => {
  const counts = { starts: 0, cleaned: 0, stops: 0 };
  const device: MobileSimulatorDevice = {
    id: "one",
    name: "fixture",
    platform: "ios",
    state: "shutdown",
    interactive: true,
  };
  const driver: SimulatorLifecycleDriver = {
    resolve: async () => device,
    boot: async (_device, signal) => {
      counts.starts += 1;
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            counts.cleaned += 1;
            reject(new Error("boot cancelled"));
          },
          { once: true }
        )
      );
      return device;
    },
    shutdown: async () => {
      counts.stops += 1;
    },
  };
  const lifecycle = new MobileSimulatorLifecycle(driver);
  const first = lifecycle.start("ios", "one", "first").catch((error) => error as Error);
  const second = lifecycle.start("ios", "one", "second").catch((error) => error as Error);
  await Bun.sleep(1);
  await lifecycle.release("first");
  expect(counts.cleaned).toBe(0);
  await lifecycle.release("second");
  expect((await first).message).toBe("boot cancelled");
  expect((await second).message).toBe("boot cancelled");
  expect(counts).toEqual({ starts: 1, cleaned: 1, stops: 0 });
});

test("a session ending during device discovery cannot launch a late emulator", async () => {
  const discovered = Promise.withResolvers<MobileSimulatorDevice>();
  let starts = 0;
  const lifecycle = new MobileSimulatorLifecycle({
    resolve: async () => await discovered.promise,
    boot: async (device) => {
      starts += 1;
      return device;
    },
    shutdown: async () => undefined,
  });
  const start = lifecycle.start("android", "one", "late").catch((error) => error as Error);
  await lifecycle.release("late");
  discovered.resolve({
    id: "one",
    name: "one",
    platform: "android",
    state: "shutdown",
    interactive: true,
  });
  expect((await start).message).toContain("session ended");
  expect(starts).toBe(0);
});

test("stop failure is surfaced and retried instead of dropping ownership", async () => {
  let attempts = 0;
  const device: MobileSimulatorDevice = {
    id: "one",
    name: "one",
    platform: "ios",
    state: "shutdown",
    interactive: true,
  };
  const lifecycle = new MobileSimulatorLifecycle({
    resolve: async () => device,
    boot: async () => ({ ...device, state: "booted" }),
    shutdown: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("shutdown failed");
    },
  });
  await lifecycle.start("ios", "one", "session");
  await expect(lifecycle.release("session")).rejects.toThrow("cleanup failed");
  await lifecycle.release("session");
  await lifecycle.release("session");
  expect(attempts).toBe(2);
});

test("explicit stop still shuts a pre-existing device down when requested", async () => {
  const { lifecycle, counts } = fixture(true);
  await lifecycle.start("android", "fixture", "session");
  await lifecycle.stop("android", "fixture");
  expect(counts.stops).toBe(1);
});

test("abort signal refuses startup and releases an owned boot without touching another session", async () => {
  const { lifecycle, counts } = fixture();
  const signal = new AbortController();
  signal.abort();
  await expect(lifecycle.start("android", "fixture", "aborted", signal.signal)).rejects.toThrow();
  expect(counts.starts).toBe(0);
  await lifecycle.start("android", "fixture", "owner");
  const device = await lifecycle.start("android", "fixture", "reader");
  lifecycle.retain("third", device);
  await lifecycle.release("owner");
  await lifecycle.release("reader");
  expect(counts.stops).toBe(0);
  await lifecycle.release("third");
  expect(counts.stops).toBe(1);
  await lifecycle.shutdown();
  expect(counts.stops).toBe(1);
});

test("gateway shutdown invalidates pending discovery and stops owned manual devices exactly once", async () => {
  const pending = Promise.withResolvers<MobileSimulatorDevice>();
  let starts = 0;
  const lifecycle = new MobileSimulatorLifecycle({
    resolve: async () => await pending.promise,
    boot: async (device) => {
      starts += 1;
      return device;
    },
    shutdown: async () => undefined,
  });
  const start = lifecycle.start("ios", "one", "late").catch((error) => error as Error);
  await lifecycle.shutdown();
  pending.resolve({
    id: "one",
    name: "one",
    platform: "ios",
    state: "shutdown",
    interactive: true,
  });
  expect((await start).message).toContain("session ended");
  expect(starts).toBe(0);
  const fixtureDevice = fixture();
  await fixtureDevice.lifecycle.start("android", "fixture");
  await fixtureDevice.lifecycle.shutdown();
  await fixtureDevice.lifecycle.shutdown();
  expect(fixtureDevice.counts).toEqual({ starts: 1, stops: 1 });
});

test("cancelling one shared startup rejects that waiter before another boot completes", async () => {
  const boot = Promise.withResolvers<MobileSimulatorDevice>();
  const device: MobileSimulatorDevice = {
    id: "one",
    name: "one",
    platform: "ios",
    state: "shutdown",
    interactive: true,
  };
  let stops = 0;
  const lifecycle = new MobileSimulatorLifecycle({
    resolve: async () => device,
    boot: async () => await boot.promise,
    shutdown: async () => {
      stops += 1;
    },
  });
  const abort = new AbortController();
  const first = lifecycle
    .start("ios", "one", "first", abort.signal)
    .catch((error) => error as Error);
  const second = lifecycle.start("ios", "one", "second");
  await Bun.sleep(1);
  abort.abort(new Error("first stopped"));
  const result = await Promise.race([
    first,
    Bun.sleep(100).then(() => new Error("did not cancel promptly")),
  ]);
  expect(result.message).toBe("first stopped");
  expect(stops).toBe(0);
  boot.resolve({ ...device, state: "booted" });
  await second;
  await lifecycle.release("second");
  expect(stops).toBe(1);
});
