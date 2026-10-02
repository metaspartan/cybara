import type { MobileSimulatorDevice, MobileSimulatorPlatform } from "./mobile-simulator";

export interface SimulatorLifecycleDriver {
  resolve(platform: MobileSimulatorPlatform, deviceId?: string): Promise<MobileSimulatorDevice>;
  boot(device: MobileSimulatorDevice, signal: AbortSignal): Promise<MobileSimulatorDevice>;
  shutdown(device: MobileSimulatorDevice): Promise<void>;
}

interface SimulatorLease {
  device: MobileSimulatorDevice;
  owned: boolean;
  sessions: Set<string>;
  manual: boolean;
  abort: AbortController;
  ready: Promise<MobileSimulatorDevice>;
  closing?: Promise<void>;
}

export class MobileSimulatorLifecycle {
  private readonly devices = new Map<string, SimulatorLease>();
  private readonly pendingSessions = new Map<string, { generation: number; count: number }>();

  constructor(private readonly driver: SimulatorLifecycleDriver) {}

  private key(device: MobileSimulatorDevice): string {
    return `${device.platform}:${device.platform === "ios" ? device.id : device.name}`;
  }

  async start(
    platform: MobileSimulatorPlatform,
    deviceId?: string,
    sessionId?: string,
    signal?: AbortSignal
  ): Promise<MobileSimulatorDevice> {
    const state = sessionId
      ? (this.pendingSessions.get(sessionId) ?? { generation: 0, count: 0 })
      : undefined;
    if (sessionId && state) {
      state.count += 1;
      this.pendingSessions.set(sessionId, state);
    }
    try {
      return await this.acquire(platform, deviceId, sessionId, signal);
    } finally {
      if (sessionId && state) {
        state.count -= 1;
        if (state.count === 0) this.pendingSessions.delete(sessionId);
      }
    }
  }

  private async acquire(
    platform: MobileSimulatorPlatform,
    deviceId?: string,
    sessionId?: string,
    signal?: AbortSignal
  ): Promise<MobileSimulatorDevice> {
    const generation = sessionId ? (this.pendingSessions.get(sessionId)?.generation ?? 0) : 0;
    signal?.throwIfAborted();
    const device = await this.driver.resolve(platform, deviceId);
    signal?.throwIfAborted();
    if (sessionId && generation !== (this.pendingSessions.get(sessionId)?.generation ?? 0))
      throw new Error("Simulator session ended before startup");
    const key = this.key(device);
    let lease = this.devices.get(key);
    if (lease?.closing) {
      await lease.closing;
      if (sessionId && generation !== (this.pendingSessions.get(sessionId)?.generation ?? 0))
        throw new Error("Simulator session ended during cleanup");
      return await this.acquire(platform, deviceId, sessionId, signal);
    }
    if (!lease) {
      const abort = new AbortController();
      lease = {
        device,
        owned: device.state !== "booted",
        sessions: new Set(),
        manual: false,
        abort,
        ready: Promise.resolve(device),
      };
      const created = lease;
      this.devices.set(key, created);
      created.ready = created.owned
        ? this.driver.boot(device, abort.signal).then((booted) => {
            created.device = booted;
            return booted;
          })
        : Promise.resolve(device);
      void created.ready.catch(() => {
        if (this.devices.get(key) === created) this.devices.delete(key);
      });
    }
    const current = lease;
    if (sessionId) current.sessions.add(sessionId);
    else current.manual = true;
    let rejectCancelled: ((reason: unknown) => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject;
    });
    const interrupted = (): void => {
      rejectCancelled?.(signal?.reason ?? new Error("Simulator start cancelled"));
      if (sessionId)
        void this.release(sessionId).catch((error) =>
          console.warn("Simulator cancellation cleanup failed", error)
        );
    };
    signal?.addEventListener("abort", interrupted, { once: true });
    try {
      signal?.throwIfAborted();
      const ready = await (signal ? Promise.race([current.ready, cancelled]) : current.ready);
      signal?.throwIfAborted();
      if (sessionId && !current.sessions.has(sessionId))
        throw new Error("Simulator session ended during startup");
      return ready;
    } finally {
      signal?.removeEventListener("abort", interrupted);
    }
  }

  retain(sessionId: string, device: MobileSimulatorDevice): void {
    this.devices.get(this.key(device))?.sessions.add(sessionId);
  }

  private async close(key: string, lease: SimulatorLease): Promise<void> {
    if (lease.closing) return await lease.closing;
    lease.abort.abort(new Error("Simulator lease released"));
    lease.closing = (async () => {
      try {
        await lease.ready;
      } catch {
        if (this.devices.get(key) === lease) this.devices.delete(key);
        return;
      }
      if (lease.owned) await this.driver.shutdown(lease.device);
      if (this.devices.get(key) === lease) this.devices.delete(key);
    })();
    try {
      await lease.closing;
    } catch (error) {
      lease.closing = undefined;
      throw error;
    }
  }

  async release(sessionId: string): Promise<void> {
    const pending = this.pendingSessions.get(sessionId);
    if (pending) pending.generation += 1;
    const errors: unknown[] = [];
    await Promise.all(
      [...this.devices].map(async ([key, lease]) => {
        lease.sessions.delete(sessionId);
        if (lease.sessions.size || lease.manual) return;
        try {
          await this.close(key, lease);
        } catch (error) {
          errors.push(error);
        }
      })
    );
    if (errors.length) throw new AggregateError(errors, "Simulator cleanup failed");
  }

  async stop(platform: MobileSimulatorPlatform, deviceId?: string): Promise<void> {
    const device = await this.driver.resolve(platform, deviceId);
    const key = this.key(device);
    const lease = this.devices.get(key);
    if (lease) {
      lease.manual = false;
      lease.sessions.clear();
      if (!lease.owned && device.state === "booted") await this.driver.shutdown(device);
      await this.close(key, lease);
    } else if (device.state === "booted") await this.driver.shutdown(device);
  }

  async shutdown(): Promise<void> {
    for (const pending of this.pendingSessions.values()) pending.generation += 1;
    const errors: unknown[] = [];
    await Promise.all(
      [...this.devices].map(async ([key, lease]) => {
        lease.sessions.clear();
        lease.manual = false;
        try {
          await this.close(key, lease);
        } catch (error) {
          errors.push(error);
        }
      })
    );
    if (errors.length) throw new AggregateError(errors, "Simulator shutdown failed");
  }
}
