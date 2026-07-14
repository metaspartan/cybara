import Bonjour from "bonjour-service";
import type Browser from "bonjour-service/dist/lib/browser";
import type Service from "bonjour-service/dist/lib/service";
import { randomUUID } from "crypto";
import { createLogger } from "../logger";
import {
  createNearbyPairingProof,
  decryptNearbyEnvelope,
  deriveNearbySharedKey,
  deriveNearbyVerificationCode,
  encryptNearbyEnvelope,
  getNearbyFingerprint,
  verifyNearbyPairingProof,
  verifyNearbyPeerIdentity,
} from "./crypto";
import { isNearbyPrivateAddress, normalizeNearbyAddress, parseNearbyBaseUrl } from "./network";
import {
  getNearbyIdentity,
  getNearbyIncomingTransfers,
  getNearbyPeers,
  getNearbySettings,
  setNearbyIncomingTransfers,
  setNearbyPeers,
  setNearbySettings,
} from "./store";
import { createNearbySessionBundle, importNearbySessionBundle } from "./transfer";
import {
  NEARBY_PROTOCOL,
  NEARBY_SERVICE_TYPE,
  type NearbyDiscoveredPeer,
  type NearbyEncryptedEnvelope,
  type NearbyIncomingTransfer,
  type NearbyPairingView,
  type NearbyPeer,
  type NearbySessionBundle,
  type NearbySettings,
  type NearbyStatus,
} from "./types";

const log = createLogger("Nearby");
const PAIRING_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_STALE_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_PAIRINGS = 100;
const MAX_MESSAGES = 10_000;
const MAX_MESSAGE_CHARS = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4;
const MAX_TITLE_CHARS = 512;
const MAX_ID_CHARS = 128;
const MAX_WORKSPACE_FIELD_CHARS = 256;

interface PendingPairing extends NearbyPairingView {
  peerPublicKey: string;
  sharedKey: string;
}

interface PairRequestBody {
  protocol: string;
  peerId: string;
  peerName: string;
  publicKey: string;
  callbackPort: number;
}

interface PairConfirmBody {
  protocol: string;
  pairingId: string;
  peerId: string;
  proof: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES)
    throw new Error("Nearby message is too large");
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("Nearby message is too large");
  return JSON.parse(text) as unknown;
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Nearby request failed";
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isValidDate(value: unknown): value is string {
  return isBoundedString(value, 64) && Number.isFinite(Date.parse(value));
}

function isValidImageData(value: unknown): value is string {
  if (!isBoundedString(value, MAX_IMAGE_BASE64_CHARS)) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 && decoded.length <= MAX_IMAGE_BYTES;
}

function isValidImageUrl(value: unknown): value is string {
  if (!isBoundedString(value, 4096)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isWorkspaceDescriptor(value: unknown): boolean {
  if (value === null) return true;
  const workspace = asRecord(value);
  return (
    workspace !== null &&
    isBoundedString(workspace.name, MAX_WORKSPACE_FIELD_CHARS) &&
    (workspace.gitRemoteHash === undefined ||
      (typeof workspace.gitRemoteHash === "string" &&
        /^[a-f0-9]{24}$/.test(workspace.gitRemoteHash))) &&
    (workspace.branch === undefined ||
      isBoundedString(workspace.branch, MAX_WORKSPACE_FIELD_CHARS)) &&
    (workspace.commit === undefined ||
      (typeof workspace.commit === "string" && /^[a-f0-9]{7,64}$/i.test(workspace.commit))) &&
    (workspace.dirty === undefined || typeof workspace.dirty === "boolean")
  );
}

export function isNearbyEncryptedEnvelope(value: unknown): value is NearbyEncryptedEnvelope {
  const envelope = asRecord(value);
  return (
    envelope?.protocol === NEARBY_PROTOCOL &&
    isBoundedString(envelope.senderId, MAX_ID_CHARS) &&
    isBoundedString(envelope.requestId, MAX_ID_CHARS) &&
    isValidDate(envelope.timestamp) &&
    isBoundedString(envelope.nonce, 64) &&
    isBoundedString(envelope.ciphertext, MAX_BODY_BYTES * 2) &&
    isBoundedString(envelope.tag, 64)
  );
}

export function isNearbySessionBundle(value: unknown): value is NearbySessionBundle {
  const record = asRecord(value);
  return (
    record?.protocol === NEARBY_PROTOCOL &&
    record.kind === "session" &&
    isBoundedString(record.transferId, MAX_ID_CHARS) &&
    isBoundedString(record.sourceSessionId, MAX_ID_CHARS) &&
    isBoundedString(record.sourceAgentId, MAX_ID_CHARS) &&
    isValidDate(record.createdAt) &&
    isValidDate(record.updatedAt) &&
    (record.title === null ||
      (typeof record.title === "string" && record.title.length <= MAX_TITLE_CHARS)) &&
    isWorkspaceDescriptor(record.workspace) &&
    Array.isArray(record.messages) &&
    record.messages.length <= MAX_MESSAGES &&
    record.messages.every((message) => {
      const item = asRecord(message);
      return (
        (item?.role === "user" || item?.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.length <= MAX_MESSAGE_CHARS &&
        (item.images === undefined ||
          (Array.isArray(item.images) &&
            item.images.length <= 20 &&
            item.images.every((image) => {
              const media = asRecord(image);
              return (
                media !== null &&
                ((media.data !== undefined && isValidImageData(media.data)) ||
                  (media.url !== undefined && isValidImageUrl(media.url))) &&
                (media.mimeType === undefined ||
                  (typeof media.mimeType === "string" &&
                    media.mimeType.startsWith("image/") &&
                    media.mimeType.length <= 64))
              );
            })))
      );
    })
  );
}

function serviceTxt(service: Service): Record<string, string> {
  const raw = service.txt;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") output[key] = value;
    else if (Buffer.isBuffer(value)) output[key] = value.toString("utf8");
  }
  return output;
}

function addressUrl(address: string, port: number): string | null {
  const normalized = normalizeNearbyAddress(address);
  if (!isNearbyPrivateAddress(normalized)) return null;
  const host = normalized.includes(":") ? `[${normalized}]` : normalized;
  try {
    return parseNearbyBaseUrl(`http://${host}:${port}`);
  } catch {
    return null;
  }
}

export class NearbyService {
  private server: Bun.Server<unknown> | null = null;
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private publishedService: Service | null = null;
  private discoverableUntilMs = 0;
  private discoverableTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly discovered = new Map<string, NearbyDiscoveredPeer>();
  private readonly pairings = new Map<string, PendingPairing>();
  private readonly replayIds = new Map<string, number>();
  private readonly pairAttempts = new Map<string, number[]>();

  async initialize(): Promise<void> {
    if (getNearbySettings().enabled) await this.start();
  }

  async configure(value: unknown): Promise<NearbySettings> {
    const previous = getNearbySettings();
    const next = setNearbySettings(value);
    if (!next.enabled) {
      this.stop();
      return next;
    }
    if (!previous.enabled || previous.port !== next.port) {
      this.stop();
      await this.start();
    }
    return next;
  }

  async start(): Promise<void> {
    if (this.server || !getNearbySettings().enabled) return;
    const settings = getNearbySettings();
    this.server = Bun.serve({
      hostname: "0.0.0.0",
      port: settings.port,
      fetch: (req, server) => this.handlePeerRequest(req, server),
    });
    this.bonjour = new Bonjour({}, (error: Error) => {
      log.warn("Nearby discovery error", { error: error.message });
    });
    this.browser = this.bonjour.find({ type: NEARBY_SERVICE_TYPE, protocol: "tcp" });
    this.browser.on("up", (service) => this.onServiceUp(service));
    this.browser.on("down", (service) => this.onServiceDown(service));
    log.info("Nearby listener started", { port: settings.port });
  }

  stop(): void {
    if (this.discoverableTimer) clearTimeout(this.discoverableTimer);
    this.discoverableTimer = null;
    this.discoverableUntilMs = 0;
    this.publishedService?.stop();
    this.publishedService = null;
    this.browser?.stop();
    this.browser = null;
    this.bonjour?.destroy();
    this.bonjour = null;
    this.server?.stop(true);
    this.server = null;
    this.discovered.clear();
  }

  async makeDiscoverable(): Promise<string> {
    if (!getNearbySettings().enabled) throw new Error("Nearby Cybara is disabled");
    await this.start();
    const settings = getNearbySettings();
    const identity = getNearbyIdentity();
    this.publishedService?.stop();
    this.publishedService =
      this.bonjour?.publish({
        name: settings.displayName,
        type: NEARBY_SERVICE_TYPE,
        protocol: "tcp",
        port: settings.port,
        txt: {
          protocol: NEARBY_PROTOCOL,
          id: identity.id,
          fingerprint: identity.fingerprint,
        },
      }) ?? null;
    this.discoverableUntilMs = Date.now() + settings.discoveryMinutes * 60 * 1000;
    if (this.discoverableTimer) clearTimeout(this.discoverableTimer);
    this.discoverableTimer = setTimeout(
      () => this.stopAdvertising(),
      settings.discoveryMinutes * 60 * 1000
    );
    return new Date(this.discoverableUntilMs).toISOString();
  }

  stopAdvertising(): void {
    this.publishedService?.stop();
    this.publishedService = null;
    this.discoverableUntilMs = 0;
    if (this.discoverableTimer) clearTimeout(this.discoverableTimer);
    this.discoverableTimer = null;
  }

  async beginPairing(peerId: string, explicitBaseUrl?: string): Promise<NearbyPairingView> {
    if (!getNearbySettings().enabled) throw new Error("Nearby Cybara is disabled");
    await this.start();
    const discovered = this.discovered.get(peerId);
    const baseUrl = parseNearbyBaseUrl(explicitBaseUrl || discovered?.baseUrl || "");
    const identity = getNearbyIdentity();
    const settings = getNearbySettings();
    const response = await fetch(`${baseUrl}/v1/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocol: NEARBY_PROTOCOL,
        peerId: identity.id,
        peerName: settings.displayName,
        publicKey: identity.publicKey,
        callbackPort: settings.port,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = asRecord(await response.json());
    if (!response.ok)
      throw new Error(typeof result?.error === "string" ? result.error : "Pairing failed");
    if (
      typeof result?.pairingId !== "string" ||
      typeof result.peerId !== "string" ||
      typeof result.peerName !== "string" ||
      typeof result.publicKey !== "string" ||
      !verifyNearbyPeerIdentity(result.peerId, result.publicKey) ||
      result.peerId !== peerId ||
      (discovered?.fingerprint && discovered.fingerprint !== getNearbyFingerprint(result.publicKey))
    ) {
      throw new Error("Peer returned an invalid identity");
    }
    const sharedKey = deriveNearbySharedKey(identity.privateKey, result.publicKey);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    const pairing: PendingPairing = {
      id: result.pairingId,
      direction: "outgoing",
      peerId: result.peerId,
      peerName: result.peerName,
      peerBaseUrl: baseUrl,
      peerPublicKey: result.publicKey,
      sharedKey,
      verificationCode: deriveNearbyVerificationCode(
        result.pairingId,
        identity.id,
        result.peerId,
        sharedKey
      ),
      localConfirmed: false,
      remoteConfirmed: false,
      expiresAt,
    };
    this.pairings.set(pairing.id, pairing);
    return this.pairingView(pairing);
  }

  async confirmPairing(pairingId: string): Promise<NearbyPairingView> {
    const pairing = this.requirePairing(pairingId);
    pairing.localConfirmed = true;
    if (pairing.direction === "outgoing") {
      await this.sendPairingConfirmation(pairing);
    }
    this.persistPairIfComplete(pairing);
    return this.pairingView(pairing);
  }

  rejectPairing(pairingId: string): boolean {
    return this.pairings.delete(pairingId);
  }

  removePeer(peerId: string): boolean {
    const peers = getNearbyPeers();
    const next = peers.filter((peer) => peer.id !== peerId);
    if (next.length === peers.length) return false;
    setNearbyPeers(next);
    return true;
  }

  updatePeer(peerId: string, syncEnabled: boolean): NearbyPeer {
    const peers = getNearbyPeers();
    const peer = peers.find((value) => value.id === peerId);
    if (!peer) throw new Error("Paired Cybara not found");
    peer.syncEnabled = syncEnabled;
    setNearbyPeers(peers);
    return peer;
  }

  async sendSession(peerId: string, sessionId: string): Promise<{ transferId: string }> {
    const peer = this.requirePeer(peerId);
    const bundle = await createNearbySessionBundle(sessionId);
    const envelope = encryptNearbyEnvelope(getNearbyIdentity().id, peer.sharedKey, bundle);
    const response = await fetch(`${peer.baseUrl}/v1/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(30_000),
    });
    const result = asRecord(await response.json());
    if (!response.ok)
      throw new Error(typeof result?.error === "string" ? result.error : "Transfer failed");
    return { transferId: bundle.transferId };
  }

  async acceptTransfer(
    transferId: string,
    workspaceDir?: string | null
  ): Promise<{ sessionId: string; duplicate: boolean }> {
    const transfers = getNearbyIncomingTransfers();
    const transfer = transfers.find((value) => value.id === transferId);
    if (!transfer) throw new Error("Incoming chat transfer not found");
    const result = await importNearbySessionBundle(transfer.bundle, workspaceDir);
    setNearbyIncomingTransfers(transfers.filter((value) => value.id !== transferId));
    return result;
  }

  dismissTransfer(transferId: string): boolean {
    const transfers = getNearbyIncomingTransfers();
    const next = transfers.filter((value) => value.id !== transferId);
    if (next.length === transfers.length) return false;
    setNearbyIncomingTransfers(next);
    return true;
  }

  async status(): Promise<NearbyStatus> {
    await this.refreshOutgoingPairings();
    this.pruneState();
    const identity = getNearbyIdentity();
    const incoming = getNearbyIncomingTransfers();
    const peers = getNearbyPeers();
    return {
      settings: getNearbySettings(),
      identity: { id: identity.id, fingerprint: identity.fingerprint },
      running: this.server !== null,
      discoverableUntil:
        this.discoverableUntilMs > Date.now()
          ? new Date(this.discoverableUntilMs).toISOString()
          : null,
      discoveredPeers: [...this.discovered.values()].sort((a, b) => a.name.localeCompare(b.name)),
      pairedPeers: peers.map(({ sharedKey, publicKey, ...peer }) => peer),
      pairings: [...this.pairings.values()]
        .filter((pairing) => !peers.some((peer) => peer.id === pairing.peerId))
        .map((pairing) => this.pairingView(pairing)),
      incomingTransfers: incoming.map((transfer) => ({
        id: transfer.id,
        peerId: transfer.peerId,
        peerName: transfer.peerName,
        receivedAt: transfer.receivedAt,
        title: transfer.bundle.title,
        messageCount: transfer.bundle.messages.length,
        workspace: transfer.bundle.workspace,
      })),
    };
  }

  private async handlePeerRequest(req: Request, server: Bun.Server<unknown>): Promise<Response> {
    const sourceAddress = normalizeNearbyAddress(server.requestIP(req)?.address || "");
    if (!isNearbyPrivateAddress(sourceAddress))
      return jsonResponse({ error: "Private network required" }, 403);
    try {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/v1/pair/request") {
        return jsonResponse(await this.handlePairRequest(await readJson(req), sourceAddress));
      }
      if (req.method === "POST" && url.pathname === "/v1/pair/confirm") {
        return jsonResponse(this.handlePairConfirm(await readJson(req)));
      }
      if (req.method === "POST" && url.pathname === "/v1/pair/status") {
        return jsonResponse(this.handlePairStatus(await readJson(req)));
      }
      if (req.method === "POST" && url.pathname === "/v1/transfer") {
        return jsonResponse(this.handleTransfer(await readJson(req)));
      }
      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      log.warn("Nearby request rejected", { error: safeError(error), sourceAddress });
      return jsonResponse({ error: safeError(error) }, 400);
    }
  }

  private async handlePairRequest(
    value: unknown,
    sourceAddress: string
  ): Promise<Record<string, unknown>> {
    if (this.discoverableUntilMs <= Date.now()) throw new Error("This Cybara is not discoverable");
    const now = Date.now();
    const recentAttempts = (this.pairAttempts.get(sourceAddress) || []).filter(
      (timestamp) => timestamp + 60_000 > now
    );
    if (recentAttempts.length >= 10 || this.pairings.size >= MAX_PAIRINGS) {
      throw new Error("Too many pairing requests");
    }
    this.pairAttempts.set(sourceAddress, [...recentAttempts, now]);
    const body = asRecord(value) as Partial<PairRequestBody> | null;
    if (
      body?.protocol !== NEARBY_PROTOCOL ||
      typeof body.peerId !== "string" ||
      typeof body.peerName !== "string" ||
      typeof body.publicKey !== "string" ||
      !verifyNearbyPeerIdentity(body.peerId, body.publicKey)
    ) {
      throw new Error("Invalid pairing request");
    }
    const callbackPort = Number(body.callbackPort);
    if (!Number.isInteger(callbackPort) || callbackPort < 1024 || callbackPort > 65_535) {
      throw new Error("Invalid peer port");
    }
    const identity = getNearbyIdentity();
    if (body.peerId === identity.id) throw new Error("Cannot pair this Cybara with itself");
    const pairingId = randomUUID();
    const sharedKey = deriveNearbySharedKey(identity.privateKey, body.publicKey);
    const baseUrl = addressUrl(sourceAddress, callbackPort);
    if (!baseUrl) throw new Error("Unable to determine the peer address");
    const pairing: PendingPairing = {
      id: pairingId,
      direction: "incoming",
      peerId: body.peerId,
      peerName: body.peerName.trim().slice(0, 64) || "Cybara",
      peerBaseUrl: baseUrl,
      peerPublicKey: body.publicKey,
      sharedKey,
      verificationCode: deriveNearbyVerificationCode(
        pairingId,
        identity.id,
        body.peerId,
        sharedKey
      ),
      localConfirmed: false,
      remoteConfirmed: false,
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
    };
    this.pairings.set(pairing.id, pairing);
    return {
      protocol: NEARBY_PROTOCOL,
      pairingId,
      peerId: identity.id,
      peerName: getNearbySettings().displayName,
      publicKey: identity.publicKey,
      fingerprint: identity.fingerprint,
    };
  }

  private handlePairConfirm(value: unknown): Record<string, unknown> {
    const body = asRecord(value) as Partial<PairConfirmBody> | null;
    const pairing = this.requirePairing(body?.pairingId || "");
    if (
      body?.protocol !== NEARBY_PROTOCOL ||
      body.peerId !== pairing.peerId ||
      typeof body.proof !== "string" ||
      !verifyNearbyPairingProof(pairing.id, pairing.sharedKey, body.proof)
    ) {
      throw new Error("Pairing confirmation failed");
    }
    pairing.remoteConfirmed = true;
    this.persistPairIfComplete(pairing);
    return {
      protocol: NEARBY_PROTOCOL,
      localConfirmed: pairing.localConfirmed,
      remoteConfirmed: pairing.remoteConfirmed,
    };
  }

  private handlePairStatus(value: unknown): Record<string, unknown> {
    const body = asRecord(value) as Partial<PairConfirmBody> | null;
    const pairing = this.requirePairing(body?.pairingId || "");
    if (
      body?.protocol !== NEARBY_PROTOCOL ||
      body.peerId !== pairing.peerId ||
      typeof body.proof !== "string" ||
      !verifyNearbyPairingProof(pairing.id, pairing.sharedKey, body.proof)
    ) {
      throw new Error("Pairing status request failed");
    }
    return {
      protocol: NEARBY_PROTOCOL,
      localConfirmed: pairing.localConfirmed,
      remoteConfirmed: pairing.remoteConfirmed,
    };
  }

  private handleTransfer(value: unknown): Record<string, unknown> {
    if (!isNearbyEncryptedEnvelope(value)) throw new Error("Invalid nearby message");
    const envelope = value;
    const peer = getNearbyPeers().find((candidate) => candidate.id === envelope.senderId);
    if (!peer) throw new Error("Unknown nearby peer");
    if (this.replayIds.has(envelope.requestId))
      throw new Error("Nearby message was already received");
    const payload = decryptNearbyEnvelope(envelope, peer.sharedKey);
    if (!isNearbySessionBundle(payload)) throw new Error("Unsupported nearby payload");
    const transfers = getNearbyIncomingTransfers();
    if (!transfers.some((transfer) => transfer.bundle.transferId === payload.transferId)) {
      const incoming: NearbyIncomingTransfer = {
        id: payload.transferId,
        peerId: peer.id,
        peerName: peer.name,
        receivedAt: new Date().toISOString(),
        bundle: payload,
      };
      setNearbyIncomingTransfers([...transfers, incoming]);
    }
    this.replayIds.set(envelope.requestId, Date.now());
    return { accepted: true, transferId: payload.transferId };
  }

  private onServiceUp(service: Service): void {
    const txt = serviceTxt(service);
    if (
      txt.protocol !== NEARBY_PROTOCOL ||
      typeof txt.id !== "string" ||
      typeof txt.fingerprint !== "string" ||
      txt.id === getNearbyIdentity().id
    ) {
      return;
    }
    const baseUrl = [...(service.addresses || [])]
      .sort((left, right) => Number(left.includes(":")) - Number(right.includes(":")))
      .map((address) => addressUrl(address, service.port))
      .find((value): value is string => typeof value === "string");
    if (!baseUrl) return;
    this.discovered.set(txt.id, {
      id: txt.id,
      name: service.name.trim().slice(0, 64) || "Cybara",
      baseUrl,
      fingerprint: txt.fingerprint,
      lastSeenAt: new Date().toISOString(),
    });
    const peers = getNearbyPeers();
    const paired = peers.find((peer) => peer.id === txt.id && peer.fingerprint === txt.fingerprint);
    if (paired && paired.baseUrl !== baseUrl) {
      paired.baseUrl = baseUrl;
      paired.lastSeenAt = new Date().toISOString();
      setNearbyPeers(peers);
    }
  }

  private onServiceDown(service: Service): void {
    const id = serviceTxt(service).id;
    if (id) this.discovered.delete(id);
  }

  private pairingView(pairing: PendingPairing): NearbyPairingView {
    return {
      id: pairing.id,
      direction: pairing.direction,
      peerId: pairing.peerId,
      peerName: pairing.peerName,
      peerBaseUrl: pairing.peerBaseUrl,
      verificationCode: pairing.verificationCode,
      localConfirmed: pairing.localConfirmed,
      remoteConfirmed: pairing.remoteConfirmed,
      expiresAt: pairing.expiresAt,
    };
  }

  private requirePairing(pairingId: string): PendingPairing {
    const pairing = this.pairings.get(pairingId);
    if (!pairing || Date.parse(pairing.expiresAt) <= Date.now()) {
      if (pairing) this.pairings.delete(pairingId);
      throw new Error("Pairing request expired or was not found");
    }
    return pairing;
  }

  private requirePeer(peerId: string): NearbyPeer {
    const peer = getNearbyPeers().find((value) => value.id === peerId);
    if (!peer) throw new Error("Paired Cybara not found");
    return peer;
  }

  private persistPairIfComplete(pairing: PendingPairing): void {
    if (!pairing.localConfirmed || !pairing.remoteConfirmed) return;
    const peers = getNearbyPeers();
    const next: NearbyPeer = {
      id: pairing.peerId,
      name: pairing.peerName,
      baseUrl: pairing.peerBaseUrl,
      publicKey: pairing.peerPublicKey,
      fingerprint: getNearbyFingerprint(pairing.peerPublicKey),
      sharedKey: pairing.sharedKey,
      pairedAt: new Date().toISOString(),
      syncEnabled: false,
    };
    setNearbyPeers([...peers.filter((peer) => peer.id !== next.id), next]);
  }

  private async sendPairingConfirmation(pairing: PendingPairing): Promise<void> {
    const identity = getNearbyIdentity();
    const response = await fetch(`${pairing.peerBaseUrl}/v1/pair/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocol: NEARBY_PROTOCOL,
        pairingId: pairing.id,
        peerId: identity.id,
        proof: createNearbyPairingProof(pairing.id, pairing.sharedKey),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = asRecord(await response.json());
    if (!response.ok)
      throw new Error(typeof result?.error === "string" ? result.error : "Pairing failed");
    pairing.remoteConfirmed = result?.localConfirmed === true;
  }

  private async refreshOutgoingPairings(): Promise<void> {
    const identity = getNearbyIdentity();
    await Promise.all(
      [...this.pairings.values()]
        .filter((pairing) => pairing.direction === "outgoing" && pairing.localConfirmed)
        .map(async (pairing) => {
          try {
            const response = await fetch(`${pairing.peerBaseUrl}/v1/pair/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                protocol: NEARBY_PROTOCOL,
                pairingId: pairing.id,
                peerId: identity.id,
                proof: createNearbyPairingProof(pairing.id, pairing.sharedKey),
              }),
              signal: AbortSignal.timeout(3000),
            });
            const result = asRecord(await response.json());
            if (response.ok) pairing.remoteConfirmed = result?.localConfirmed === true;
            this.persistPairIfComplete(pairing);
          } catch {
            void 0;
          }
        })
    );
  }

  private pruneState(): void {
    const now = Date.now();
    for (const [id, pairing] of this.pairings) {
      if (Date.parse(pairing.expiresAt) <= now) this.pairings.delete(id);
    }
    for (const [id, peer] of this.discovered) {
      if (Date.parse(peer.lastSeenAt) + DISCOVERY_STALE_MS <= now) this.discovered.delete(id);
    }
    for (const [id, timestamp] of this.replayIds) {
      if (timestamp + 10 * 60 * 1000 <= now) this.replayIds.delete(id);
    }
    for (const [address, attempts] of this.pairAttempts) {
      const active = attempts.filter((timestamp) => timestamp + 60_000 > now);
      if (active.length) this.pairAttempts.set(address, active);
      else this.pairAttempts.delete(address);
    }
  }
}

export const nearbyService = new NearbyService();
