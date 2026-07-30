import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API_KEY = "nearby-transfer-e2e-key";

interface GatewayFixture {
  homeDir: string;
  gatewayPort: number;
  nearbyPort: number;
  baseUrl: string;
  stdoutPath: string;
  stderrPath: string;
  process: ReturnType<typeof Bun.spawn> | null;
}

interface ApiResult {
  status: number;
  data: unknown;
}

const gateways: GatewayFixture[] = [];
const GATEWAY_START_TIMEOUT_MS = process.env.CI ? 60_000 : 30_000;
const NEARBY_ENABLE_ATTEMPTS = 5;
const allocatedPorts = new Set<number>();
let discoveryPort = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  while (true) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Failed to allocate a free port"));
          return;
        }
        server.close((error) => {
          if (error) reject(error);
          else resolve(address.port);
        });
      });
    });
    if (allocatedPorts.has(port)) continue;
    allocatedPorts.add(port);
    return port;
  }
}

async function createGateway(name: string): Promise<GatewayFixture> {
  const gatewayPort = await getFreePort();
  const nearbyPort = await getFreePort();
  const homeDir = mkdtempSync(join(tmpdir(), `cybara-nearby-${name}-`));
  const fixture: GatewayFixture = {
    homeDir,
    gatewayPort,
    nearbyPort,
    baseUrl: `http://127.0.0.1:${gatewayPort}`,
    stdoutPath: join(homeDir, "gateway.stdout.log"),
    stderrPath: join(homeDir, "gateway.stderr.log"),
    process: null,
  };
  gateways.push(fixture);
  return fixture;
}

function startGateway(fixture: GatewayFixture): void {
  fixture.process = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      CYBARA_HOME: join(fixture.homeDir, ".cybara"),
      CYBARA_API_KEY: API_KEY,
      CYBARA_HOST: "127.0.0.1",
      CYBARA_PORT_FALLBACK_COUNT: "0",
      CYBARA_NEARBY_DISCOVERY_PORT: String(discoveryPort),
      PORT: String(fixture.gatewayPort),
      NODE_ENV: "production",
    },
    stdout: Bun.file(fixture.stdoutPath),
    stderr: Bun.file(fixture.stderrPath),
  });
}

async function stopGateway(fixture: GatewayFixture): Promise<void> {
  const gatewayProcess = fixture.process;
  if (!gatewayProcess) return;
  try {
    gatewayProcess.kill("SIGTERM");
  } catch (error) {
    void error;
  }
  const exitedGracefully = await Promise.race([
    gatewayProcess.exited.then(() => true),
    sleep(5000).then(() => false),
  ]);
  if (!exitedGracefully) {
    try {
      gatewayProcess.kill("SIGKILL");
    } catch (error) {
      void error;
    }
    const exitedForcibly = await Promise.race([
      gatewayProcess.exited.then(() => true),
      sleep(5000).then(() => false),
    ]);
    if (!exitedForcibly) {
      throw await gatewayFailure(fixture, `Gateway did not exit for ${fixture.baseUrl}`);
    }
  }
  fixture.process = null;
}

async function readLogTail(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) return "<not created>";
  const content = (await file.text()).trim();
  return content.length > 0 ? content.slice(-4000) : "<empty>";
}

async function gatewayFailure(fixture: GatewayFixture, reason: string): Promise<Error> {
  const stdout = await readLogTail(fixture.stdoutPath);
  const stderr = await readLogTail(fixture.stderrPath);
  return new Error(`${reason}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function waitForGateway(
  fixture: GatewayFixture,
  timeoutMs = GATEWAY_START_TIMEOUT_MS
): Promise<void> {
  const startedAt = Date.now();
  let healthyChecks = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const process = fixture.process;
    if (!process)
      throw await gatewayFailure(fixture, `Gateway process missing for ${fixture.baseUrl}`);
    if (process.exitCode !== null) {
      throw await gatewayFailure(
        fixture,
        `Gateway exited with code ${process.exitCode} before ${fixture.baseUrl} became ready`
      );
    }
    try {
      const response = await fetch(`${fixture.baseUrl}/api/health`);
      if (response.ok) {
        healthyChecks += 1;
        if (healthyChecks >= 2) return;
      } else {
        healthyChecks = 0;
      }
    } catch (error) {
      void error;
      healthyChecks = 0;
    }
    await sleep(200);
  }
  throw await gatewayFailure(
    fixture,
    `Timed out after ${timeoutMs}ms waiting for ${fixture.baseUrl}`
  );
}

async function api(
  fixture: GatewayFixture,
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${fixture.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  return {
    status: response.status,
    data: contentType.includes("application/json")
      ? ((await response.json()) as unknown)
      : await response.text(),
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
  intervalMs = 150
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition");
}

function insertSourceSession(fixture: GatewayFixture, marker: string): string {
  const sessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const messages = [
    {
      role: "user",
      content: `Share ${marker} api_key=sk-nearby-secret-value`,
      timestamp,
    },
    { role: "assistant", content: `Completed ${marker}`, timestamp },
  ];
  const database = new Database(join(fixture.homeDir, ".cybara", "data", "platform.db"));
  try {
    database
      .query(
        "INSERT INTO chat_sessions (id, agent_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        sessionId,
        "source-agent",
        `Nearby ${marker}`,
        JSON.stringify(messages),
        timestamp,
        timestamp
      );
    const insertMessage = database.query(
      "INSERT INTO session_messages (id, session_id, agent_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    insertMessage.run(
      randomUUID(),
      sessionId,
      "source-agent",
      "user",
      messages[0]?.content || "",
      null,
      timestamp
    );
    insertMessage.run(
      randomUUID(),
      sessionId,
      "source-agent",
      "assistant",
      messages[1]?.content || "",
      JSON.stringify({
        process_activities: [
          {
            id: "nearby-work",
            text: "Ran transfer verification",
            kind: "command",
            phase: "complete",
          },
        ],
      }),
      timestamp
    );
  } finally {
    database.close();
  }
  return sessionId;
}

async function enableNearby(fixture: GatewayFixture, displayName: string): Promise<void> {
  let lastResult: ApiResult | null = null;
  for (let attempt = 0; attempt < NEARBY_ENABLE_ATTEMPTS; attempt += 1) {
    const result = await api(fixture, "PUT", "/api/nearby/settings", {
      enabled: true,
      displayName,
      port: fixture.nearbyPort,
      discoveryMinutes: 1,
    });
    if (result.status === 200 && asRecord(result.data).success === true) return;
    lastResult = result;
    if (result.status !== 500) break;
    fixture.nearbyPort = await getFreePort();
  }
  throw await gatewayFailure(
    fixture,
    `Failed to enable Nearby at ${fixture.baseUrl}: ${JSON.stringify(lastResult)}`
  );
}

beforeAll(async () => {
  discoveryPort = await getFreePort();
  const first = await createGateway("first");
  const second = await createGateway("second");
  startGateway(first);
  startGateway(second);
  await Promise.all([waitForGateway(first), waitForGateway(second)]);
});

afterAll(async () => {
  await Promise.all(gateways.map(stopGateway));
  for (const gateway of gateways) {
    rmSync(gateway.homeDir, { recursive: true, force: true });
  }
});

describe("Nearby two-gateway e2e", () => {
  test("pairs, transfers, imports, and persists a redacted chat", async () => {
    const first = gateways[0];
    const second = gateways[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error("Gateway fixtures were not created");

    const initiallySelectedPort = first.nearbyPort;
    const portBlocker = Bun.serve({
      hostname: "0.0.0.0",
      port: initiallySelectedPort,
      fetch: () => new Response("occupied"),
    });
    try {
      await enableNearby(first, "Nearby First");
    } finally {
      portBlocker.stop(true);
    }
    expect(first.nearbyPort).not.toBe(initiallySelectedPort);
    await enableNearby(second, "Nearby Second");

    await waitFor(async () => {
      const firstStatus = asRecord((await api(first, "GET", "/api/nearby")).data);
      const secondStatus = asRecord((await api(second, "GET", "/api/nearby")).data);
      return (
        asRecords(firstStatus.discoveredPeers).some((peer) => peer.name === "Nearby Second") &&
        asRecords(secondStatus.discoveredPeers).some((peer) => peer.name === "Nearby First")
      );
    });

    const discoverable = await api(second, "POST", "/api/nearby/discoverable");
    expect(discoverable.status).toBe(200);
    expect(typeof asRecord(discoverable.data).discoverableUntil).toBe("string");

    const pairingResult = await api(first, "POST", "/api/nearby/pair-address", {
      baseUrl: `http://127.0.0.1:${second.nearbyPort}`,
    });
    expect(pairingResult.status).toBe(200);
    const outgoingPairing = asRecord(pairingResult.data);
    const pairingId = String(outgoingPairing.id || "");
    expect(pairingId).not.toBe("");

    const firstStatusBefore = asRecord((await api(first, "GET", "/api/nearby")).data);
    const secondStatusBefore = asRecord((await api(second, "GET", "/api/nearby")).data);
    const firstIdentity = asRecord(firstStatusBefore.identity);
    const secondIdentity = asRecord(secondStatusBefore.identity);
    const incomingPairing = asRecords(secondStatusBefore.pairings).find(
      (value) => value.id === pairingId
    );
    expect(incomingPairing?.verificationCode).toBe(outgoingPairing.verificationCode);

    const firstConfirm = await api(
      first,
      "POST",
      `/api/nearby/pairings/${encodeURIComponent(pairingId)}/confirm`
    );
    expect(firstConfirm.status).toBe(200);
    const secondConfirm = await api(
      second,
      "POST",
      `/api/nearby/pairings/${encodeURIComponent(pairingId)}/confirm`
    );
    expect(secondConfirm.status).toBe(200);

    await waitFor(async () => {
      const firstStatus = asRecord((await api(first, "GET", "/api/nearby")).data);
      const secondStatus = asRecord((await api(second, "GET", "/api/nearby")).data);
      return (
        asRecords(firstStatus.pairedPeers).some((peer) => peer.id === secondIdentity.id) &&
        asRecords(secondStatus.pairedPeers).some((peer) => peer.id === firstIdentity.id)
      );
    });

    const marker = `nearby-marker-${Date.now()}`;
    const sourceSessionId = insertSourceSession(first, marker);
    const sendResult = await api(
      first,
      "POST",
      `/api/nearby/peers/${encodeURIComponent(String(secondIdentity.id))}/sessions`,
      { sessionId: sourceSessionId }
    );
    expect(sendResult.status).toBe(200);
    const transferId = String(asRecord(sendResult.data).transferId || "");
    expect(transferId).not.toBe("");

    let importedTransfer: Record<string, unknown> | undefined;
    await waitFor(async () => {
      const status = asRecord((await api(second, "GET", "/api/nearby")).data);
      importedTransfer = asRecords(status.incomingTransfers).find(
        (transfer) => transfer.id === transferId
      );
      return importedTransfer !== undefined;
    });
    expect(importedTransfer?.messageCount).toBe(2);

    const accepted = await api(
      second,
      "POST",
      `/api/nearby/transfers/${encodeURIComponent(transferId)}/accept`,
      { workspaceDir: null }
    );
    expect(accepted.status).toBe(200);
    const importedSessionId = String(asRecord(accepted.data).sessionId || "");
    expect(importedSessionId).not.toBe("");

    const importedBeforeRestart = asRecord(
      (await api(second, "GET", `/api/sessions/${encodeURIComponent(importedSessionId)}`)).data
    );
    const importedMessages = asRecords(importedBeforeRestart.messagesList);
    expect(importedMessages.some((message) => String(message.content).includes(marker))).toBe(true);
    expect(JSON.stringify(importedMessages)).not.toContain("sk-nearby-secret-value");
    expect(JSON.stringify(importedMessages)).toContain("Ran transfer verification");

    const trustResult = await api(
      second,
      "PUT",
      `/api/nearby/peers/${encodeURIComponent(String(firstIdentity.id))}`,
      { syncEnabled: true }
    );
    expect(trustResult.status).toBe(200);
    expect(asRecord(trustResult.data).syncEnabled).toBe(true);

    const automaticMarker = `nearby-auto-${Date.now()}`;
    const automaticSourceSessionId = insertSourceSession(first, automaticMarker);
    const automaticSend = await api(
      first,
      "POST",
      `/api/nearby/peers/${encodeURIComponent(String(secondIdentity.id))}/sessions`,
      { sessionId: automaticSourceSessionId }
    );
    expect(automaticSend.status).toBe(200);
    const automaticTransferId = String(asRecord(automaticSend.data).transferId || "");

    await waitFor(async () => {
      const list = (await api(second, "GET", "/api/sessions")).data;
      const sessions = Array.isArray(list) ? asRecords(list) : asRecords(asRecord(list).sessions);
      return sessions.some((session) => session.title === `Nearby ${automaticMarker}`);
    });
    const statusAfterAutomaticImport = asRecord((await api(second, "GET", "/api/nearby")).data);
    expect(
      asRecords(statusAfterAutomaticImport.incomingTransfers).some(
        (transfer) => transfer.id === automaticTransferId
      )
    ).toBe(false);

    await stopGateway(second);
    startGateway(second);
    await waitForGateway(second);

    const importedAfterRestart = await api(
      second,
      "GET",
      `/api/sessions/${encodeURIComponent(importedSessionId)}`
    );
    expect(importedAfterRestart.status).toBe(200);
    expect(asRecord(importedAfterRestart.data).id).toBe(importedSessionId);
    const nearbyAfterRestart = asRecord((await api(second, "GET", "/api/nearby")).data);
    expect(nearbyAfterRestart.running).toBe(true);
    expect(
      asRecords(nearbyAfterRestart.pairedPeers).some((peer) => peer.id === firstIdentity.id)
    ).toBe(true);
  }, 90_000);
});
