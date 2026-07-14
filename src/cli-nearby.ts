type NearbyFetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

interface NearbySettings {
  enabled: boolean;
  displayName: string;
  port: number;
  discoveryMinutes: number;
}

interface NearbyPeerSummary {
  id: string;
  name: string;
  baseUrl: string;
  fingerprint: string;
}

interface NearbyPairingSummary {
  id: string;
  peerName: string;
  verificationCode: string;
  localConfirmed: boolean;
}

interface NearbyTransferSummary {
  id: string;
  peerName: string;
  title: string | null;
  messageCount: number;
}

interface NearbyStatus {
  settings: NearbySettings;
  running: boolean;
  discoverableUntil: string | null;
  discoveredPeers: NearbyPeerSummary[];
  pairedPeers: NearbyPeerSummary[];
  pairings: NearbyPairingSummary[];
  incomingTransfers: NearbyTransferSummary[];
}

function nearbyHelp(): void {
  console.log("Nearby Commands:");
  console.log("  cybara nearby status                         Show discovery and trusted devices");
  console.log("  cybara nearby enable|disable                 Change the off-by-default setting");
  console.log("  cybara nearby discover|stop                  Start or stop temporary discovery");
  console.log("  cybara nearby pair <peer-id> [--url URL]     Begin verified pairing");
  console.log("  cybara nearby confirm <pairing-id>           Confirm the matching code");
  console.log("  cybara nearby remove <peer-id>               Remove a trusted device");
  console.log("  cybara nearby send <peer-id> <session-id>    Send a chat for approval");
  console.log("  cybara nearby accept <transfer-id>           Import a received chat");
  console.log("  cybara nearby dismiss <transfer-id>          Dismiss a received chat");
}

function printNearbyStatus(status: NearbyStatus): void {
  console.log(`Nearby Cybara: ${status.settings.enabled ? "enabled" : "disabled"}`);
  console.log(`Listener: ${status.running ? `port ${status.settings.port}` : "stopped"}`);
  console.log(`Discovery: ${status.discoverableUntil || "off"}`);
  console.log("");
  console.log(`Trusted devices (${status.pairedPeers.length})`);
  for (const peer of status.pairedPeers) {
    console.log(`  ${peer.name}  ${peer.id}  ${peer.fingerprint.slice(0, 12)}`);
  }
  console.log(`Available devices (${status.discoveredPeers.length})`);
  for (const peer of status.discoveredPeers) console.log(`  ${peer.name}  ${peer.id}`);
  console.log(`Pending pairings (${status.pairings.length})`);
  for (const pairing of status.pairings) {
    console.log(`  ${pairing.peerName}  ${pairing.verificationCode}  ${pairing.id}`);
  }
  console.log(`Received chats (${status.incomingTransfers.length})`);
  for (const transfer of status.incomingTransfers) {
    console.log(
      `  ${transfer.title || "Shared chat"}  from ${transfer.peerName}  ${transfer.messageCount} messages  ${transfer.id}`
    );
  }
}

async function updateEnabled(enabled: boolean, fetchAPI: NearbyFetchAPI): Promise<void> {
  const current = await fetchAPI<NearbyStatus>("/api/nearby");
  if (!current) return;
  const result = await fetchAPI<{ status: NearbyStatus }>("/api/nearby/settings", {
    method: "PUT",
    body: JSON.stringify({ ...current.settings, enabled }),
  });
  if (result) console.log(`Nearby Cybara ${enabled ? "enabled" : "disabled"}.`);
}

async function post(
  endpoint: string,
  fetchAPI: NearbyFetchAPI,
  body?: Record<string, unknown>
): Promise<boolean> {
  const result = await fetchAPI<unknown>(endpoint, {
    method: "POST",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return result !== null;
}

async function remove(endpoint: string, fetchAPI: NearbyFetchAPI): Promise<boolean> {
  return (await fetchAPI<unknown>(endpoint, { method: "DELETE" })) !== null;
}

export async function runNearbyCommand(args: string[], fetchAPI: NearbyFetchAPI): Promise<void> {
  const command = args[0] || "status";
  if (command === "status" || command === "list") {
    const status = await fetchAPI<NearbyStatus>("/api/nearby");
    if (status) printNearbyStatus(status);
    return;
  }
  if (command === "enable" || command === "disable") {
    await updateEnabled(command === "enable", fetchAPI);
    return;
  }
  if (command === "discover" || command === "stop") {
    const ok =
      command === "discover"
        ? await post("/api/nearby/discoverable", fetchAPI)
        : await remove("/api/nearby/discoverable", fetchAPI);
    if (ok)
      console.log(command === "discover" ? "Temporary discovery started." : "Discovery stopped.");
    return;
  }
  if (command === "pair") {
    const peerId = args[1];
    if (!peerId) return nearbyHelp();
    const urlIndex = args.indexOf("--url");
    const baseUrl = urlIndex >= 0 ? args[urlIndex + 1] : undefined;
    const ok = await post("/api/nearby/pair", fetchAPI, {
      peerId,
      ...(baseUrl ? { baseUrl } : {}),
    });
    if (ok) console.log("Pairing started. Compare the six-digit code on both devices.");
    return;
  }
  if (
    command === "confirm" ||
    command === "remove" ||
    command === "accept" ||
    command === "dismiss"
  ) {
    const id = args[1];
    if (!id) return nearbyHelp();
    const encoded = encodeURIComponent(id);
    const endpoint =
      command === "confirm"
        ? `/api/nearby/pairings/${encoded}/confirm`
        : command === "remove"
          ? `/api/nearby/peers/${encoded}`
          : `/api/nearby/transfers/${encoded}${command === "accept" ? "/accept" : ""}`;
    const ok =
      command === "confirm" || command === "accept"
        ? await post(endpoint, fetchAPI, command === "accept" ? { workspaceDir: null } : undefined)
        : await remove(endpoint, fetchAPI);
    if (ok) console.log(`Nearby ${command} completed.`);
    return;
  }
  if (command === "send") {
    const peerId = args[1];
    const sessionId = args[2];
    if (!peerId || !sessionId) return nearbyHelp();
    const ok = await post(`/api/nearby/peers/${encodeURIComponent(peerId)}/sessions`, fetchAPI, {
      sessionId,
    });
    if (ok) console.log("Chat sent for approval on the other device.");
    return;
  }
  nearbyHelp();
}
