import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { NEARBY_PROTOCOL, type NearbyEncryptedEnvelope, type NearbyIdentity } from "./types";

const ENVELOPE_KEY_INFO = Buffer.from("cybara-nearby-envelope-v1", "utf8");

function publicKeyFingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 24);
}

export function createNearbyIdentity(): NearbyIdentity {
  const pair = generateKeyPairSync("x25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const fingerprint = publicKeyFingerprint(publicKey);
  return {
    id: `peer_${createHash("sha256").update(publicKey).digest("hex").slice(0, 32)}`,
    publicKey,
    privateKey,
    fingerprint,
  };
}

export function verifyNearbyPeerIdentity(id: string, publicKey: string): boolean {
  try {
    createPublicKey(publicKey);
  } catch {
    return false;
  }
  const expected = `peer_${createHash("sha256").update(publicKey).digest("hex").slice(0, 32)}`;
  return expected === id;
}

export function getNearbyFingerprint(publicKey: string): string {
  return publicKeyFingerprint(publicKey);
}

export function deriveNearbySharedKey(privateKey: string, publicKey: string): string {
  const secret = diffieHellman({
    privateKey: createPrivateKey(privateKey),
    publicKey: createPublicKey(publicKey),
  });
  return Buffer.from(
    hkdfSync("sha256", secret, Buffer.from(NEARBY_PROTOCOL, "utf8"), ENVELOPE_KEY_INFO, 32)
  ).toString("base64url");
}

export function deriveNearbyVerificationCode(
  pairingId: string,
  localId: string,
  remoteId: string,
  sharedKey: string
): string {
  const ids = [localId, remoteId].sort().join(":");
  const digest = createHmac("sha256", Buffer.from(sharedKey, "base64url"))
    .update(`${pairingId}:${ids}`)
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function createNearbyPairingProof(pairingId: string, sharedKey: string): string {
  return createHmac("sha256", Buffer.from(sharedKey, "base64url"))
    .update(`confirm:${pairingId}`)
    .digest("base64url");
}

export function verifyNearbyPairingProof(
  pairingId: string,
  sharedKey: string,
  proof: string
): boolean {
  const expected = Buffer.from(createNearbyPairingProof(pairingId, sharedKey));
  const received = Buffer.from(proof);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function envelopeAad(senderId: string, requestId: string, timestamp: string): Buffer {
  return Buffer.from(`${NEARBY_PROTOCOL}:${senderId}:${requestId}:${timestamp}`, "utf8");
}

export function encryptNearbyEnvelope(
  senderId: string,
  sharedKey: string,
  payload: unknown,
  now = new Date()
): NearbyEncryptedEnvelope {
  const requestId = randomUUID();
  const timestamp = now.toISOString();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(sharedKey, "base64url"), nonce);
  cipher.setAAD(envelopeAad(senderId, requestId, timestamp));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    protocol: NEARBY_PROTOCOL,
    senderId,
    requestId,
    timestamp,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptNearbyEnvelope(
  envelope: NearbyEncryptedEnvelope,
  sharedKey: string,
  now = Date.now(),
  maxAgeMs = 5 * 60 * 1000
): unknown {
  if (envelope.protocol !== NEARBY_PROTOCOL) throw new Error("Unsupported nearby protocol");
  const timestampMs = Date.parse(envelope.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maxAgeMs) {
    throw new Error("Nearby message expired");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(sharedKey, "base64url"),
    Buffer.from(envelope.nonce, "base64url")
  );
  decipher.setAAD(envelopeAad(envelope.senderId, envelope.requestId, envelope.timestamp));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as unknown;
}
