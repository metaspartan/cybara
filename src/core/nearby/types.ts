import type { ChatMessage } from "../../api/chat";

export const NEARBY_PROTOCOL = "cybara-nearby-v1";
export const NEARBY_SERVICE_TYPE = "cybara-nearby";

export interface NearbySettings {
  enabled: boolean;
  displayName: string;
  port: number;
  discoveryMinutes: number;
  autoAdvertise: boolean;
}

export interface NearbyIdentity {
  id: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface NearbyDiscoveredPeer {
  id: string;
  name: string;
  baseUrl: string;
  fingerprint: string;
  lastSeenAt: string;
}

export interface NearbyPeer {
  id: string;
  name: string;
  baseUrl: string;
  publicKey: string;
  fingerprint: string;
  sharedKey: string;
  pairedAt: string;
  lastSeenAt?: string;
  syncEnabled: boolean;
}

export interface NearbyPairingView {
  id: string;
  direction: "incoming" | "outgoing";
  peerId: string;
  peerName: string;
  peerBaseUrl: string;
  verificationCode: string;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
  expiresAt: string;
}

export interface NearbyWorkspaceDescriptor {
  name: string;
  gitRemoteHash?: string;
  branch?: string;
  commit?: string;
  dirty?: boolean;
}

export interface NearbyTransferMessage extends ChatMessage {
  images?: Array<{
    data?: string;
    url?: string;
    mimeType?: string;
  }>;
}

export interface NearbySessionBundle {
  protocol: typeof NEARBY_PROTOCOL;
  kind: "session";
  transferId: string;
  sourceSessionId: string;
  title: string | null;
  sourceAgentId: string;
  createdAt: string;
  updatedAt: string;
  workspace: NearbyWorkspaceDescriptor | null;
  messages: NearbyTransferMessage[];
}

export interface NearbyIncomingTransfer {
  id: string;
  peerId: string;
  peerName: string;
  receivedAt: string;
  bundle: NearbySessionBundle;
}

export interface NearbyEncryptedEnvelope {
  protocol: typeof NEARBY_PROTOCOL;
  senderId: string;
  requestId: string;
  timestamp: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export interface NearbyStatus {
  settings: NearbySettings;
  identity: { id: string; fingerprint: string };
  running: boolean;
  advertising: boolean;
  discoverableUntil: string | null;
  localAddresses: string[];
  discoveredPeers: NearbyDiscoveredPeer[];
  pairedPeers: Array<Omit<NearbyPeer, "sharedKey" | "publicKey">>;
  pairings: NearbyPairingView[];
  incomingTransfers: Array<{
    id: string;
    peerId: string;
    peerName: string;
    receivedAt: string;
    title: string | null;
    messageCount: number;
    workspace: NearbyWorkspaceDescriptor | null;
  }>;
}
