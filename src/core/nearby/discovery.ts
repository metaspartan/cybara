import type { NearbyLanInterface } from "./network";
import { isNearbyPrivateAddress, nearbyLanInterfaces, normalizeNearbyAddress } from "./network";
import { NEARBY_PROTOCOL } from "./types";

export const NEARBY_DISCOVERY_PORT = 4270;

export function resolveNearbyDiscoveryPort(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65_535
    ? parsed
    : NEARBY_DISCOVERY_PORT;
}

const MAX_DATAGRAM_BYTES = 2048;
const ANNOUNCEMENT_INTERVAL_MS = 8000;
const REFRESH_DELAYS_MS = [0, 250, 1000] as const;

export interface NearbyDiscoveryAnnouncement {
  protocol: typeof NEARBY_PROTOCOL;
  kind: "announce";
  peerId: string;
  peerName: string;
  fingerprint: string;
  port: number;
}

interface NearbyDiscoveryProbe {
  protocol: typeof NEARBY_PROTOCOL;
  kind: "probe";
}

type NearbyDiscoveryDatagram = NearbyDiscoveryAnnouncement | NearbyDiscoveryProbe;

export interface NearbyLanDiscoveryOptions {
  discoveryPort?: number;
  targetAddresses?: readonly string[];
  getAnnouncement: () => NearbyDiscoveryAnnouncement | null;
  onAnnouncement: (announcement: NearbyDiscoveryAnnouncement, sourceAddress: string) => void;
  onError?: (error: Error) => void;
}

export interface NearbyLanDiscoveryStatus {
  running: boolean;
  boundPort: number | null;
  fallback: boolean;
}

function ipv4Number(value: string): number | null {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((total, part) => ((total << 8) | part) >>> 0, 0);
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

export function nearbyBroadcastAddresses(
  interfaces: readonly NearbyLanInterface[] = nearbyLanInterfaces()
): string[] {
  const addresses = interfaces.flatMap((entry) => {
    const address = ipv4Number(entry.address);
    const netmask = ipv4Number(entry.netmask);
    if (address === null || netmask === null) return [];
    return [numberToIpv4(((address & netmask) | ~netmask) >>> 0)];
  });
  return [...new Set([...addresses, "255.255.255.255"])];
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function parseNearbyDiscoveryDatagram(data: Uint8Array): NearbyDiscoveryDatagram | null {
  if (data.byteLength === 0 || data.byteLength > MAX_DATAGRAM_BYTES) return null;
  try {
    const value = JSON.parse(Buffer.from(data).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.protocol !== NEARBY_PROTOCOL) return null;
    if (record.kind === "probe") return { protocol: NEARBY_PROTOCOL, kind: "probe" };
    if (
      record.kind !== "announce" ||
      !isBoundedString(record.peerId, 128) ||
      !isBoundedString(record.peerName, 64) ||
      typeof record.fingerprint !== "string" ||
      !/^[a-f0-9]{24}$/i.test(record.fingerprint) ||
      typeof record.port !== "number" ||
      !Number.isInteger(record.port) ||
      record.port < 1024 ||
      record.port > 65535
    ) {
      return null;
    }
    return {
      protocol: NEARBY_PROTOCOL,
      kind: "announce",
      peerId: record.peerId,
      peerName: record.peerName,
      fingerprint: record.fingerprint,
      port: record.port,
    };
  } catch {
    return null;
  }
}

export class NearbyLanDiscovery {
  private socket: Bun.udp.Socket<"buffer"> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private refreshTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly discoveryPort: number;
  private readonly configuredTargetAddresses: readonly string[] | null;

  constructor(private readonly options: NearbyLanDiscoveryOptions) {
    this.discoveryPort = options.discoveryPort ?? NEARBY_DISCOVERY_PORT;
    this.configuredTargetAddresses = options.targetAddresses ?? null;
  }

  async start(): Promise<void> {
    if (this.socket) return;
    try {
      this.socket = await this.createSocket(this.discoveryPort);
    } catch {
      this.socket = await this.createSocket(0);
    }
    this.socket.setBroadcast(true);
    this.socket.setTTL(1);
    this.refresh();
    this.interval = setInterval(() => this.sendDiscovery(), ANNOUNCEMENT_INTERVAL_MS);
  }

  status(): NearbyLanDiscoveryStatus {
    return {
      running: this.socket !== null,
      boundPort: this.socket?.port ?? null,
      fallback: this.socket !== null && this.socket.port !== this.discoveryPort,
    };
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const timer of this.refreshTimers) clearTimeout(timer);
    this.refreshTimers = [];
    this.socket?.close();
    this.socket = null;
  }

  refresh(): void {
    for (const timer of this.refreshTimers) clearTimeout(timer);
    this.refreshTimers = REFRESH_DELAYS_MS.map((delay) =>
      setTimeout(() => this.sendDiscovery(), delay)
    );
  }

  private async createSocket(port: number): Promise<Bun.udp.Socket<"buffer">> {
    return Bun.udpSocket({
      hostname: "0.0.0.0",
      port,
      binaryType: "buffer",
      socket: {
        data: (_socket, data, sourcePort, sourceAddress, flags) => {
          if (flags.truncated) return;
          this.receive(data, sourcePort, sourceAddress);
        },
        error: (_socket, error) => this.options.onError?.(error),
      },
    });
  }

  private receive(data: Buffer, sourcePort: number, sourceAddress: string): void {
    const address = normalizeNearbyAddress(sourceAddress);
    if (!isNearbyPrivateAddress(address)) return;
    const datagram = parseNearbyDiscoveryDatagram(data);
    if (!datagram) return;
    if (datagram.kind === "probe") {
      this.sendAnnouncement(address, sourcePort);
      return;
    }
    this.options.onAnnouncement(datagram, address);
  }

  private sendDiscovery(): void {
    this.sendToTargets({ protocol: NEARBY_PROTOCOL, kind: "probe" });
    const announcement = this.options.getAnnouncement();
    if (announcement) this.sendToTargets(announcement);
  }

  private sendAnnouncement(address: string, port: number): void {
    const announcement = this.options.getAnnouncement();
    if (!announcement || !this.socket) return;
    this.socket.send(JSON.stringify(announcement), port, address);
  }

  private sendToTargets(datagram: NearbyDiscoveryDatagram): void {
    if (!this.socket) return;
    const payload = JSON.stringify(datagram);
    const targetAddresses = this.configuredTargetAddresses ?? nearbyBroadcastAddresses();
    for (const address of targetAddresses) {
      try {
        this.socket.send(payload, this.discoveryPort, address);
      } catch (error) {
        this.options.onError?.(error instanceof Error ? error : new Error("Discovery send failed"));
      }
    }
  }
}
