import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createRoutesFixture } from "./routes.fixture";

const fixture = createRoutesFixture();

describe("API Health & Status", () => {
  test("GET /api/health should return measured gateway status", async () => {
    const { status, data } = await fixture.api("GET", "/api/health");
    expect(status).toBe(200);
    expect(["healthy", "warning", "critical"]).toContain(data.status);
    expect(data.checks.database.status).toBe("healthy");
    expect(data.timestamp).toBeDefined();
    expect(data.uptime).toBeDefined();
    expect(data.version).toBe(fixture.PACKAGE_VERSION);
  });

  test("GET /api/health should include system checks", async () => {
    const { data } = await fixture.api("GET", "/api/health");
    expect(data.checks.database).toBeDefined();
    expect(data.checks.agents).toBeDefined();
    expect(data.checks.providers).toBeDefined();
    expect(data.checks.memory).toBeDefined();
  });

  test("GET /api/health/ready and /api/health/live should return readiness/liveness", async () => {
    const ready = await fixture.api("GET", "/api/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.data.ready).toBe(true);
    expect(ready.data.checks.database.status).toBe("healthy");

    const live = await fixture.api("GET", "/api/health/live");
    expect(live.status).toBe(200);
    expect(live.data.live).toBe(true);
  });
});

describe("Setup & Info API", () => {
  test("GET /api/info should return platform summary", async () => {
    const { status, data } = await fixture.api("GET", "/api/info");
    expect(status).toBe(200);
    expect(data.name).toBe("Cybara");
    expect(typeof data.version).toBe("string");
    expect(typeof data.homeDir).toBe("string");
    expect(typeof data.cybaraDataDir).toBe("string");
    expect(typeof data.configuredCybaraDataDir).toBe("string");
    expect(typeof data.cybaraDataDirSource).toBe("string");
    expect(typeof data.cybaraDataDirForced).toBe("boolean");
    expect(typeof data.cybaraDataDirRestartRequired).toBe("boolean");
    expect(typeof data.defaultCybaraDataDir).toBe("string");
    expect(typeof data.defaultWorkspaceDir).toBe("string");
    expect(data.stats).toBeDefined();
  });

  test("default workspace setting is normalized and reflected in info", async () => {
    const workspaceDir = join(fixture.testHome, "workspaces", "primary");
    const update = await fixture.api("PUT", "/api/config", {
      default_workspace_dir: workspaceDir,
    });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);

    const configRes = await fixture.api("GET", "/api/config");
    expect(configRes.status).toBe(200);
    expect(configRes.data.default_workspace_dir).toBe(workspaceDir);

    const info = await fixture.api("GET", "/api/info");
    expect(info.status).toBe(200);
    expect(info.data.defaultWorkspaceDir).toBe(workspaceDir);

    await fixture.api("PUT", "/api/config", {
      default_workspace_dir: fixture.testHome,
    });
  });

  test("cybara data directory setting records configured path until restart", async () => {
    const activeDir = join(fixture.testHome, ".cybara");
    const nextDir = join(fixture.testHome, "cybara-data-alt");
    const update = await fixture.api("PUT", "/api/config", {
      cybara_data_dir: nextDir,
    });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);
    expect(update.data.restartRequired).toBe(true);
    expect(update.data.cybara_data_dir).toBe(activeDir);
    expect(update.data.configured_cybara_data_dir).toBe(nextDir);
    expect(update.data.cybara_data_dir_restart_required).toBe(true);

    const configRes = await fixture.api("GET", "/api/config");
    expect(configRes.status).toBe(200);
    expect(configRes.data.cybara_data_dir).toBe(activeDir);
    expect(configRes.data.configured_cybara_data_dir).toBe(nextDir);
    expect(configRes.data.cybara_data_dir_source).toBe("override");
    expect(configRes.data.cybara_data_dir_restart_required).toBe(true);

    const info = await fixture.api("GET", "/api/info");
    expect(info.status).toBe(200);
    expect(info.data.cybaraDataDir).toBe(activeDir);
    expect(info.data.configuredCybaraDataDir).toBe(nextDir);
    expect(info.data.cybaraDataDirRestartRequired).toBe(true);

    const reset = await fixture.api("PUT", "/api/config", {
      cybara_data_dir: activeDir,
    });
    expect(reset.status).toBe(200);
    expect(reset.data.success).toBe(true);
    expect(reset.data.configured_cybara_data_dir).toBe(activeDir);
    expect(reset.data.cybara_data_dir_restart_required).toBe(false);
  });

  test("setup status and complete flow should return success", async () => {
    const beforeStatus = await fixture.api("GET", "/api/setup/status");
    expect(beforeStatus.status).toBe(200);
    expect(typeof beforeStatus.data.complete).toBe("boolean");

    const beforeAgents = await fixture.api("GET", "/api/agents");
    expect(beforeAgents.status).toBe(200);
    const beforeCount = Array.isArray(beforeAgents.data) ? beforeAgents.data.length : 0;

    const completeRes = await fixture.api("POST", "/api/setup/complete");
    expect(completeRes.status).toBe(200);
    expect(completeRes.data.success).toBe(true);

    const afterStatus = await fixture.api("GET", "/api/setup/status");
    expect(afterStatus.status).toBe(200);
    expect(afterStatus.data.complete).toBe(true);

    const afterFirstCompleteAgents = await fixture.api("GET", "/api/agents");
    expect(afterFirstCompleteAgents.status).toBe(200);
    const afterFirstCount = Array.isArray(afterFirstCompleteAgents.data)
      ? afterFirstCompleteAgents.data.length
      : 0;
    expect(afterFirstCount).toBe(beforeCount);

    const secondCompleteRes = await fixture.api("POST", "/api/setup/complete");
    expect(secondCompleteRes.status).toBe(200);
    expect(secondCompleteRes.data.success).toBe(true);

    const afterSecondCompleteAgents = await fixture.api("GET", "/api/agents");
    expect(afterSecondCompleteAgents.status).toBe(200);
    const afterSecondCount = Array.isArray(afterSecondCompleteAgents.data)
      ? afterSecondCompleteAgents.data.length
      : 0;
    expect(afterSecondCount).toBe(afterFirstCount);
  });
});

describe("Mobile API", () => {
  test("reports mobile connection URLs and localhost pairing warnings", async () => {
    const info = await fixture.api("GET", "/api/mobile/connect-info");

    expect(info.status).toBe(200);
    expect(info.data.baseUrl).toBe(fixture.BASE_URL);
    expect(info.data.currentBaseUrl).toBe(fixture.BASE_URL);
    expect(info.data.candidates).toContain(fixture.BASE_URL);
    expect(info.data.isCurrentLoopback).toBe(true);
    expect(info.data.lanAccessEnabled).toBe(false);
    expect(String(info.data.warnings.join(" "))).toContain("127.0.0.1");
    expect(String(info.data.warnings.join(" "))).toContain("LAN address");
    expect(String(info.data.troubleshooting.join(" "))).toContain("/api/health");
    expect(String(info.data.exposeCommand)).toContain("cybara start");
  });

  test("blocks mobile pairing codes until the gateway listens on the local network", async () => {
    const blocked = await fixture.api("POST", "/api/mobile/devices/pair-code", {
      baseUrl: "http://192.168.1.20:4269",
      role: "standard",
      deviceName: "Routes Phone",
    });

    expect(blocked.status).toBe(400);
    expect(String(blocked.data.error)).toContain("Listen on local network");
  });

  test("allows mobile pairing through a ready password-protected remote URL", async () => {
    const pending = await fixture.api("PUT", "/api/auth/settings", {
      remoteAccess: {
        enabled: true,
        mode: "public_tunnel",
        provider: "cloudflare",
        baseUrl: "https://cybara.example.com",
      },
    });
    expect(pending.status).toBe(200);
    expect(pending.data.remoteAccess.ready).toBe(false);
    expect(pending.data.remoteAccess.status).toBe("needs_password");

    const blocked = await fixture.api("POST", "/api/mobile/devices/pair-code", {
      baseUrl: "https://cybara.example.com",
      role: "standard",
      deviceName: "Routes Phone",
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.data.error)).toContain("ready remote access");

    const password = await fixture.api("PUT", "/api/auth/settings", {
      gatewayPassword: "correct horse battery staple",
    });
    expect(password.status).toBe(200);
    expect(password.data.remoteAccess.ready).toBe(true);

    const created = await fixture.api("POST", "/api/mobile/devices/pair-code", {
      baseUrl: "https://cybara.example.com",
      role: "standard",
      deviceName: "Routes Phone",
    });
    expect(created.status).toBe(200);
    expect(created.data.payload.baseUrl).toBe("https://cybara.example.com");

    await fixture.api("PUT", "/api/auth/settings", {
      remoteAccess: {
        enabled: false,
        mode: "private_overlay",
        provider: "tailscale",
        baseUrl: "",
      },
    });
  });

  test("auth settings persist a restart-bound gateway host", async () => {
    const before = await fixture.api("GET", "/api/auth/settings");
    expect(before.status).toBe(200);
    expect(before.data.host).toBe("127.0.0.1");
    expect(before.data.configuredHost).toBe("127.0.0.1");
    expect(before.data.hostForced).toBe(false);

    const updated = await fixture.api("PUT", "/api/auth/settings", {
      host: "0.0.0.0",
    });
    expect(updated.status).toBe(200);
    expect(updated.data.success).toBe(true);
    expect(updated.data.host).toBe("127.0.0.1");
    expect(updated.data.configuredHost).toBe("0.0.0.0");

    const reset = await fixture.api("PUT", "/api/auth/settings", {
      host: "127.0.0.1",
    });
    expect(reset.status).toBe(200);
    expect(reset.data.configuredHost).toBe("127.0.0.1");
  });

  test("creates revocable mobile device tokens without exposing the root key", async () => {
    const created = await fixture.api("POST", "/api/mobile/devices", {
      baseUrl: fixture.BASE_URL,
      gatewayName: "Routes Gateway",
      deviceName: "Routes Phone",
    });

    expect(created.status).toBe(200);
    expect(created.data.success).toBe(true);
    expect(created.data.device.id).toMatch(/^mobile_/);
    expect(created.data.device.name).toBe("Routes Phone");
    expect(created.data.payload.protocol).toBe("cybara-mobile-connect-v1");
    expect(created.data.payload.deviceId).toBe(created.data.device.id);
    expect(created.data.payload.name).toBe("Routes Gateway");
    expect(created.data.payload.baseUrl).toBe(fixture.BASE_URL);
    expect(created.data.payload.apiKey).toMatch(/^cybara_mobile_/);
    expect(String(created.data.qrDataUrl).startsWith("data:image/png;base64,")).toBe(true);

    const rootApiKey = readFileSync(join(fixture.testHome, ".cybara", "api_key"), "utf8").trim();
    expect(created.data.payload.apiKey).not.toBe(rootApiKey);

    const encoded = JSON.parse(created.data.encoded) as {
      apiKey?: string;
      deviceId?: string;
    };
    expect(encoded.apiKey).toBe(created.data.payload.apiKey);
    expect(encoded.deviceId).toBe(created.data.device.id);

    const list = await fixture.api("GET", "/api/mobile/devices");
    expect(list.status).toBe(200);
    expect(
      list.data.devices.some((device: { id: string }) => device.id === created.data.device.id)
    ).toBe(true);

    const mobileInfo = await fixture.apiWithBearer("GET", "/api/info", created.data.payload.apiKey);
    expect(mobileInfo.status).toBe(200);
    expect(mobileInfo.data.name).toBe("Cybara");

    const forbiddenManage = await fixture.apiWithBearer(
      "GET",
      "/api/mobile/devices",
      created.data.payload.apiKey
    );
    expect(forbiddenManage.status).toBe(403);
    expect(forbiddenManage.data.error).toContain("Root API key required");

    const revoked = await fixture.api(
      "POST",
      `/api/mobile/devices/${created.data.device.id}/revoke`
    );
    expect(revoked.status).toBe(200);
    expect(revoked.data.device.status).toBe("revoked");

    const afterRevoke = await fixture.apiWithBearer(
      "GET",
      "/api/info",
      created.data.payload.apiKey
    );
    expect(afterRevoke.status).toBe(401);

    const removed = await fixture.api("DELETE", `/api/mobile/devices/${created.data.device.id}`);
    expect(removed.status).toBe(200);
    expect(removed.data.success).toBe(true);
  });
});

describe("Logs API", () => {
  test("GET /api/logs/system honors bounded mobile and CLI reads", async () => {
    const stamp = Date.now();
    fixture.insertRawSystemLog(
      `bounded-log-old-${stamp}`,
      "older bounded log",
      "2026-06-30T08:00:00.000Z"
    );
    fixture.insertRawSystemLog(
      `bounded-log-new-${stamp}`,
      "newer bounded log",
      "2026-06-30T09:00:00.000Z"
    );

    const limited = await fixture.api("GET", "/api/logs/system?limit=1");

    expect(limited.status).toBe(200);
    expect(Array.isArray(limited.data)).toBe(true);
    expect(limited.data).toHaveLength(1);

    const paged = await fixture.api("GET", "/api/logs/system?limit=1&offset=0&includeTotal=1");

    expect(paged.status).toBe(200);
    expect(Array.isArray(paged.data.logs)).toBe(true);
    expect(paged.data.logs).toHaveLength(1);
    expect(paged.data.total).toBeGreaterThanOrEqual(2);
    expect(paged.data.limit).toBe(1);
    expect(paged.data.offset).toBe(0);
    expect(paged.data.hasMore).toBe(true);
  });
});

describe("Wallet API", () => {
  test("wallet create/unlock/derive/sign/delete flow works", async () => {
    const statusBefore = await fixture.api("GET", "/api/wallet/status");
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.data.exists).toBe(false);

    const create = await fixture.api("POST", "/api/wallet/create", {
      password: "integration-pass-123",
    });
    expect(create.status).toBe(200);
    expect(create.data.success).toBe(true);
    expect(typeof create.data.mnemonic).toBe("string");
    expect(create.data.mnemonic.split(" ").length).toBe(24);
    expect(typeof create.data.address).toBe("string");
    expect(typeof create.data.primaryAddresses.eth).toBe("string");
    expect(typeof create.data.primaryAddresses.btc).toBe("string");
    expect(typeof create.data.primaryAddresses.sol).toBe("string");

    const statusAfterCreate = await fixture.api("GET", "/api/wallet/status");
    expect(statusAfterCreate.status).toBe(200);
    expect(statusAfterCreate.data.exists).toBe(true);
    expect(statusAfterCreate.data.unlocked).toBe(true);
    expect(statusAfterCreate.data.primaryAddresses.eth).toBe(create.data.primaryAddresses.eth);

    const revealWithoutAcknowledgement = await fixture.api("POST", "/api/wallet/seed", {
      password: "integration-pass-123",
    });
    expect(revealWithoutAcknowledgement.status).toBe(400);

    const revealWrongPassword = await fixture.api("POST", "/api/wallet/seed", {
      password: "incorrect-password",
      acknowledgement: "REVEAL",
    });
    expect(revealWrongPassword.status).toBe(400);

    const reveal = await fixture.api("POST", "/api/wallet/seed", {
      password: "integration-pass-123",
      acknowledgement: "REVEAL",
    });
    expect(reveal.status).toBe(200);
    expect(reveal.data.mnemonic).toBe(create.data.mnemonic);
    expect(reveal.data.wordCount).toBe(24);

    const accounts = await fixture.api(
      "GET",
      "/api/wallet/accounts?chains=eth,btc,sol&count=1&startIndex=0"
    );
    expect(accounts.status).toBe(200);
    expect(Array.isArray(accounts.data)).toBe(true);
    expect(accounts.data).toHaveLength(3);
    expect(accounts.data[0].index).toBe(0);
    expect(typeof accounts.data[0].address).toBe("string");

    const receive = await fixture.api("GET", "/api/wallet/receive?chain=eth&index=0");
    expect(receive.status).toBe(200);
    expect(receive.data.chain).toBe("eth");
    expect(receive.data.index).toBe(0);
    expect(typeof receive.data.address).toBe("string");

    const invalidTokenChain = await fixture.api("GET", "/api/wallet/tokens?chain=btc&index=0");
    expect(invalidTokenChain.status).toBe(400);
    expect(invalidTokenChain.data.code).toBe("VALIDATION_ERROR");

    const invalidTokenTxChain = await fixture.api(
      "GET",
      "/api/wallet/token-transactions?chain=btc&index=0"
    );
    expect(invalidTokenTxChain.status).toBe(400);
    expect(invalidTokenTxChain.data.code).toBe("VALIDATION_ERROR");

    const sign = await fixture.api("POST", "/api/wallet/sign", {
      message: "integration-wallet-sign",
      chain: "eth",
      index: 0,
    });
    expect(sign.status).toBe(200);
    expect(typeof sign.data.signature).toBe("string");
    expect(sign.data.signature.startsWith("0x")).toBe(true);

    const lock = await fixture.api("POST", "/api/wallet/lock");
    expect(lock.status).toBe(200);
    expect(lock.data.success).toBe(true);

    const lockedStatus = await fixture.api("GET", "/api/wallet/status");
    expect(lockedStatus.status).toBe(200);
    expect(lockedStatus.data.unlocked).toBe(false);

    const unlock = await fixture.api("POST", "/api/wallet/unlock", {
      password: "integration-pass-123",
    });
    expect(unlock.status).toBe(200);
    expect(unlock.data.success).toBe(true);
    expect(unlock.data.address).toBe(create.data.address);

    const deleteRes = await fixture.api("DELETE", "/api/wallet", {
      password: "integration-pass-123",
    });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);

    const statusAfterDelete = await fixture.api("GET", "/api/wallet/status");
    expect(statusAfterDelete.status).toBe(200);
    expect(statusAfterDelete.data.exists).toBe(false);
  });
});

describe("Agents API", () => {
  test("GET /api/agents should return array", async () => {
    const { status, data } = await fixture.api("GET", "/api/agents");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/agents/summary should return lightweight selector fields", async () => {
    const { status, data } = await fixture.api("GET", "/api/agents/summary");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    const first = data[0];
    if (first) {
      expect(typeof first.id).toBe("string");
      expect(typeof first.name).toBe("string");
      expect(first.system_prompt).toBeUndefined();
      expect(first.config).toBeUndefined();
      expect(first.tools).toBeUndefined();
      expect(typeof first.tool_profile).toBe("string");
      expect(["adaptive", "binary", "effort"]).toContain(first.reasoning_mode);
      expect(Array.isArray(first.reasoning_efforts)).toBe(true);
    }
  });

  test("POST /api/agents should create a new agent", async () => {
    const newAgent = {
      name: `test-agent-${Date.now()}`,
      type: "basic",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    };
    const { status, data } = await fixture.api("POST", "/api/agents", newAgent);
    expect(status).toBe(200);
    expect(data.name).toBe(newAgent.name);
    expect(data.id).toBeDefined();
  });

  test("agent create/update resolve legacy provider field and auto-heal missing provider_id", async () => {
    const providerRes = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `agent-provider-${Date.now()}`,
      api_key: `sk-test-${Date.now()}`,
      is_default: true,
    });
    expect(providerRes.status).toBe(200);
    const providerId = providerRes.data.id as string;

    const created = await fixture.api("POST", "/api/agents", {
      name: `legacy-provider-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
      provider: providerId,
    });
    expect(created.status).toBe(200);
    expect(created.data.provider_id).toBe(providerId);

    const fetched = await fixture.api("GET", `/api/agents/${created.data.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.provider).toBe(providerId);
    expect(fetched.data.provider_type).toBe("openai");

    const summary = await fixture.api("GET", "/api/agents/summary");
    const summarized = summary.data.find((agent: { id: string }) => agent.id === created.data.id);
    expect(summarized?.provider_id).toBe(providerId);
    expect(summarized?.provider_type).toBe("openai");

    const missingProviderAgent = await fixture.api("POST", "/api/agents", {
      name: `missing-provider-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
    });
    expect(missingProviderAgent.status).toBe(200);
    expect(missingProviderAgent.data.provider_id).toBeUndefined();

    const chatRes = await fixture.api("POST", "/api/chat", {
      message: "provider auto-heal check",
      agentId: missingProviderAgent.data.id,
    });
    expect(chatRes.status).toBe(200);
    expect(String(chatRes.data.message?.content || "")).not.toContain("No AI provider configured");

    const healed = await fixture.api("GET", `/api/agents/${missingProviderAgent.data.id}`);
    expect(healed.status).toBe(200);
    expect(typeof healed.data.provider).toBe("string");
    expect(healed.data.provider.length).toBeGreaterThan(0);

    await fixture.api("DELETE", `/api/agents/${created.data.id}`);
    await fixture.api("DELETE", `/api/agents/${missingProviderAgent.data.id}`);
    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/agents/:id tolerates malformed persisted config JSON", async () => {
    const agentId = `bad-agent-config-${Date.now()}`;
    fixture.insertRawAgent(agentId, `bad-agent-${Date.now()}`, "{bad-json");

    const updateRes = await fixture.api("PUT", `/api/agents/${agentId}`, {
      name: `recovered-agent-${Date.now()}`,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.id).toBe(agentId);
    expect(typeof updateRes.data.name).toBe("string");
    expect(updateRes.data.name).toContain("recovered-agent-");

    const getRes = await fixture.api("GET", `/api/agents/${agentId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(agentId);
    expect(getRes.data.name).toBe(updateRes.data.name);

    await fixture.api("DELETE", `/api/agents/${agentId}`);
  });

  test("PUT /api/agents/:id/reasoning preserves unrelated config and supports default", async () => {
    const created = await fixture.api("POST", "/api/agents", {
      name: `reasoning-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
      config: { autostart: true, model_params: { temperature: 0.3 } },
    });
    const agentId = created.data.id as string;

    const update = await fixture.api("PUT", `/api/agents/${agentId}/reasoning`, {
      reasoning_effort: "high",
    });
    expect(update.data).toEqual({
      success: true,
      reasoning_effort: "high",
      reasoning_mode: "effort",
      reasoning_efforts: ["low", "medium", "high"],
    });

    const fetched = await fixture.api("GET", `/api/agents/${agentId}`);
    const fetchedConfig =
      typeof fetched.data.config === "string"
        ? (JSON.parse(fetched.data.config) as Record<string, unknown>)
        : fetched.data.config;
    expect(fetchedConfig).toEqual({
      autostart: true,
      model_params: { temperature: 0.3, reasoning_effort: "high" },
    });

    const summary = await fixture.api("GET", "/api/agents/summary");
    expect(
      (summary.data as Array<{ id: string; reasoning_effort?: string }>).find(
        (agent) => agent.id === agentId
      )?.reasoning_effort
    ).toBe("high");

    const reset = await fixture.api("PUT", `/api/agents/${agentId}/reasoning`, {
      reasoning_effort: null,
    });
    expect(reset.data).toEqual({
      success: true,
      reasoning_effort: null,
      reasoning_mode: "effort",
      reasoning_efforts: ["low", "medium", "high"],
    });

    const invalid = await fixture.api("PUT", `/api/agents/${agentId}/reasoning`, {
      reasoning_effort: "extreme",
    });
    expect(invalid.data).toEqual({
      success: false,
      error: "Invalid reasoning effort",
    });

    await fixture.api("DELETE", `/api/agents/${agentId}`);
  });

  test("PUT /api/agents/:id/reasoning stores the provider-supported effective effort", async () => {
    const provider = await fixture.api("POST", "/api/providers", {
      provider: "kimi-code",
      name: `reasoning-kimi-${Date.now()}`,
      api_key: `kimi-test-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const created = await fixture.api("POST", "/api/agents", {
      name: `reasoning-kimi-agent-${Date.now()}`,
      type: "main",
      model: "kimi-code/k3",
      provider_id: provider.data.id,
    });

    const update = await fixture.api("PUT", `/api/agents/${created.data.id}/reasoning`, {
      reasoning_effort: "medium",
    });
    expect(update.data).toEqual({
      success: true,
      reasoning_effort: "high",
      reasoning_mode: "effort",
      reasoning_efforts: ["low", "high", "max"],
    });

    const summary = await fixture.api("GET", "/api/agents/summary");
    const agent = (summary.data as Array<Record<string, unknown>>).find(
      (entry) => entry.id === created.data.id
    );
    expect(agent?.reasoning_effort).toBe("high");
    expect(agent?.reasoning_efforts).toEqual(["low", "high", "max"]);

    await fixture.api("DELETE", `/api/agents/${created.data.id}`);
    await fixture.api("DELETE", `/api/providers/${provider.data.id}`);
  });

  test("POST /api/agents/:id/start tolerates malformed persisted config JSON", async () => {
    const agentId = `bad-agent-start-config-${Date.now()}`;
    fixture.insertRawAgent(agentId, `bad-agent-start-${Date.now()}`, "{bad-json");

    const startRes = await fixture.api("POST", `/api/agents/${agentId}/start`);
    expect(startRes.status).toBe(200);
    expect(startRes.data.success).toBe(true);

    const stateRes = await fixture.api("GET", `/api/agents/${agentId}/state`);
    expect(stateRes.status).toBe(200);
    expect(stateRes.data.running).toBe(true);

    const stopRes = await fixture.api("POST", `/api/agents/${agentId}/stop`);
    expect(stopRes.status).toBe(200);
    expect(stopRes.data.success).toBe(true);

    await fixture.api("DELETE", `/api/agents/${agentId}`);
  });

  test("POST /api/agents/:id/message auto-starts a stopped agent", async () => {
    const created = await fixture.api("POST", "/api/agents", {
      name: `auto-start-message-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
    });
    expect(created.status).toBe(200);

    const agentId = created.data.id as string;
    const beforeState = await fixture.api("GET", `/api/agents/${agentId}/state`);
    expect(beforeState.status).toBe(200);
    expect(beforeState.data.running).toBe(false);

    const messageRes = await fixture.api("POST", `/api/agents/${agentId}/message`, {
      message: "hello",
    });
    expect(messageRes.status).toBe(200);
    expect(typeof messageRes.data.response).toBe("string");
    expect(messageRes.data.response.length).toBeGreaterThan(0);

    const afterState = await fixture.api("GET", `/api/agents/${agentId}/state`);
    expect(afterState.status).toBe(200);
    expect(afterState.data.running).toBe(true);

    await fixture.api("POST", `/api/agents/${agentId}/stop`);
    await fixture.api("DELETE", `/api/agents/${agentId}`);
  });

  test("agent loop endpoints start/list/get/cancel runs", async () => {
    const created = await fixture.api("POST", "/api/agents", {
      name: `loop-agent-${Date.now()}`,
      type: "main",
      model: "gpt-5-mini",
    });
    expect(created.status).toBe(200);
    const agentId = created.data.id as string;

    const start = await fixture.api("POST", `/api/agents/${agentId}/loops`, {
      objective: "Draft a concise status summary",
      maxIterations: 2,
      maxDurationSeconds: 30,
      useTools: false,
    });
    expect(start.status).toBe(200);
    expect(start.data.success).toBe(true);
    expect(typeof start.data.runId).toBe("string");
    const runId = start.data.runId as string;

    const byAgent = await fixture.api("GET", `/api/agents/${agentId}/loops`);
    expect(byAgent.status).toBe(200);
    expect(Array.isArray(byAgent.data.runs)).toBe(true);
    expect(byAgent.data.runs.some((run: { id: string }) => run.id === runId)).toBe(true);

    const listAll = await fixture.api("GET", "/api/loops");
    expect(listAll.status).toBe(200);
    expect(Array.isArray(listAll.data.runs)).toBe(true);
    expect(listAll.data.runs.some((run: { id: string }) => run.id === runId)).toBe(true);

    const getRun = await fixture.api("GET", `/api/loops/${runId}`);
    expect(getRun.status).toBe(200);
    expect(getRun.data.success).toBe(true);
    expect(getRun.data.run.id).toBe(runId);

    const cancel = await fixture.api("POST", `/api/loops/${runId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.data.success).toBe(true);

    const getAfterCancel = await fixture.api("GET", `/api/loops/${runId}`);
    expect(getAfterCancel.status).toBe(200);
    expect(getAfterCancel.data.success).toBe(true);
    expect(typeof getAfterCancel.data.run.status).toBe("string");

    await fixture.api("DELETE", `/api/agents/${agentId}`);
  });
});

describe("Agent Evals API", () => {
  test("exports portable suites and rejects redacted imports", async () => {
    const exported = await fixture.api("GET", "/api/evals/export?format=bundle&sanitize=0");
    expect(exported.status).toBe(200);
    expect(exported.data?.filename).toEndWith(".json");
    const bundle = JSON.parse(exported.data?.content || "null") as {
      format?: string;
      version?: number;
      goldens?: unknown[];
    };
    expect(bundle.format).toBe("cybara-agent-eval-suite");
    expect(bundle.version).toBe(1);
    expect(Array.isArray(bundle.goldens)).toBe(true);

    const imported = await fixture.api("POST", "/api/evals/import", {
      bundle: { ...bundle, goldens: [] },
    });
    expect(imported.status).toBe(200);
    expect(imported.data?.count).toBe(0);

    const rejected = await fixture.api("POST", "/api/evals/import", {
      bundle: { ...bundle, sanitized: true, goldens: [] },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.data?.success).toBe(false);
    expect(rejected.data?.error).toContain("not replayable");
  });

  test("lists persistent dataset generation runs", async () => {
    const response = await fixture.api("GET", "/api/evals/datasets");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.runs)).toBe(true);
  });

  test("rejects dataset runs with unsafe execution limits", async () => {
    const agent = await fixture.api("POST", "/api/agents", {
      name: `dataset-limits-${Date.now()}`,
      type: "basic",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
    expect(agent.status).toBe(200);

    const outputBudget = await fixture.api("POST", "/api/evals/datasets", {
      agentId: agent.data.id,
      prompts: ["Return one sentence."],
      maxOutputTokens: 64,
    });
    expect(outputBudget.status).toBe(200);
    expect(outputBudget.data.success).toBe(false);
    expect(outputBudget.data.error).toContain("Output budget");

    const sampleTimeout = await fixture.api("POST", "/api/evals/datasets", {
      agentId: agent.data.id,
      prompts: ["Return one sentence."],
      sampleTimeoutSeconds: 10,
    });
    expect(sampleTimeout.status).toBe(200);
    expect(sampleTimeout.data.success).toBe(false);
    expect(sampleTimeout.data.error).toContain("Sample timeout");

    for (const [field, error] of [
      ["samplesPerPrompt", "Samples per prompt"],
      ["concurrency", "Concurrency"],
      ["maxOutputTokens", "Output budget"],
      ["sampleTimeoutSeconds", "Sample timeout"],
    ] as const) {
      const malformed = await fixture.api("POST", "/api/evals/datasets", {
        agentId: agent.data.id,
        prompts: ["Return one sentence."],
        [field]: "invalid",
      });
      expect(malformed.status).toBe(200);
      expect(malformed.data.success).toBe(false);
      expect(malformed.data.error).toContain(error);
    }

    await fixture.api("DELETE", `/api/agents/${agent.data.id}`);
  });

  test("rejects prompt drafting without configured author and teacher agents", async () => {
    const response = await fixture.api("POST", "/api/evals/dataset-prompts", {
      agentId: "missing-author",
      targetAgentId: "missing-teacher",
      count: 12,
    });
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(false);
    expect(response.data.error).toContain("prompt author");
  });
});

describe("Provider Plan API", () => {
  test("GET /api/provider-plans/availability returns cheap usage-nav metadata", async () => {
    const { status, data } = await fixture.api("GET", "/api/provider-plans/availability");
    expect(status).toBe(200);
    expect(typeof data.available).toBe("boolean");
    expect(typeof data.summary.total).toBe("number");
    expect(typeof data.summary.configured).toBe("number");
    expect(typeof data.summary.monitored).toBe("number");
    expect(typeof data.summary.automatic).toBe("number");
    expect(data.providers).toBeUndefined();
  });
});

describe("Providers API", () => {
  test("GET /api/providers should return array", async () => {
    const { status, data } = await fixture.api("GET", "/api/providers");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("provider account pool CRUD keeps named same-provider membership", async () => {
    const suffix = Date.now();
    const first = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `pool-primary-${suffix}`,
      api_key: `sk-pool-primary-${suffix}`,
    });
    const second = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `pool-backup-${suffix}`,
      api_key: `sk-pool-backup-${suffix}`,
    });
    const pool = await fixture.api("POST", "/api/provider-account-pools", {
      name: "Work plans",
      provider: "openai",
      accounts: [
        { provider_id: first.data.id, priority: 20 },
        { provider_id: second.data.id, priority: 10 },
      ],
    });

    expect(pool.status).toBe(200);
    expect(pool.data.name).toBe("Work plans");
    expect(pool.data.routing_mode).toBe("priority_then_usage");
    expect(
      pool.data.accounts.map((account: { provider_id: string }) => account.provider_id)
    ).toEqual([second.data.id, first.data.id]);
    expect(
      pool.data.accounts.map((account: { provider_name: string }) => account.provider_name)
    ).toEqual([`pool-backup-${suffix}`, `pool-primary-${suffix}`]);

    const listed = await fixture.api("GET", "/api/provider-account-pools");
    expect(listed.status).toBe(200);
    expect(listed.data.some((entry: { id: string }) => entry.id === pool.data.id)).toBe(true);

    const agent = await fixture.api("POST", "/api/agents", {
      name: `pool-agent-${suffix}`,
      type: "main",
      model: "gpt-5.2",
      provider_pool_id: pool.data.id,
    });
    expect(agent.status).toBe(200);
    expect(agent.data.provider_id).toBe(second.data.id);
    expect(agent.data.config.provider_account_pool_id).toBe(pool.data.id);
    const summary = await fixture.api("GET", "/api/agents/summary");
    const poolAgent = summary.data.find((entry: { id: string }) => entry.id === agent.data.id);
    expect(poolAgent?.provider_pool_id).toBe(pool.data.id);
    expect(poolAgent?.provider_pool_name).toBe("Work plans");

    const updated = await fixture.api("PUT", `/api/provider-account-pools/${pool.data.id}`, {
      name: "Work plans",
      provider: "openai",
      enabled: false,
      accounts: [{ provider_id: first.data.id }],
    });
    expect(updated.status).toBe(200);
    expect(updated.data.enabled).toBe(false);
    expect(updated.data.routing_mode).toBe("usage");
    expect(updated.data.accounts[0]?.priority).toBeNull();

    const renamed = await fixture.api("PUT", `/api/provider-account-pools/${pool.data.id}`, {
      name: "Renamed work plans",
    });
    expect(renamed.status).toBe(200);
    expect(renamed.data.name).toBe("Renamed work plans");
    expect(renamed.data.provider).toBe("openai");
    expect(renamed.data.enabled).toBe(false);
    expect(
      renamed.data.accounts.map((account: { provider_id: string }) => account.provider_id)
    ).toEqual([first.data.id]);

    await fixture.api("DELETE", `/api/agents/${agent.data.id}`);
    expect(
      (await fixture.api("DELETE", `/api/provider-account-pools/${pool.data.id}`)).status
    ).toBe(200);
    await fixture.api("DELETE", `/api/providers/${first.data.id}`);
    await fixture.api("DELETE", `/api/providers/${second.data.id}`);
  });

  test("POST /api/providers rejects invalid OpenAI key shapes", async () => {
    const bad = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `bad-openai-key-${Date.now()}`,
      api_key: "bc1qnotanopenaikey",
    });

    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("VALIDATION_ERROR");
    expect(String(bad.data.error)).toContain("OpenAI API key must start with 'sk-'");
  });

  test("POST /api/providers rejects invalid Google key shapes", async () => {
    const badUrl = await fixture.api("POST", "/api/providers", {
      provider: "google",
      name: `bad-google-key-url-${Date.now()}`,
      api_key: "https://aistudio.google.com/apikey",
    });

    expect(badUrl.status).toBe(400);
    expect(badUrl.data.code).toBe("VALIDATION_ERROR");
    expect(String(badUrl.data.error)).toContain("Google API key looks like a URL");

    const badFormat = await fixture.api("POST", "/api/providers", {
      provider: "google",
      name: `bad-google-key-format-${Date.now()}`,
      api_key: "not-a-google-key",
    });

    expect(badFormat.status).toBe(400);
    expect(badFormat.data.code).toBe("VALIDATION_ERROR");
    expect(String(badFormat.data.error)).toContain("Google API key format is invalid");
  });

  test("POST /api/providers accepts aliased provider ids", async () => {
    const created = await fixture.api("POST", "/api/providers", {
      provider: "opencode",
      name: `alias-opencode-${Date.now()}`,
      api_key: `sk-alias-${Date.now()}`,
    });
    expect(created.status).toBe(200);
    const providerId = created.data.id as string;

    const row = fixture.getRawProviderRecord(providerId);
    expect(row?.provider).toBe("opencode_zen");

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("POST /api/providers persists validated base URLs", async () => {
    const created = await fixture.api("POST", "/api/providers", {
      provider: "ollama",
      name: `create-base-url-${Date.now()}`,
      base_url: "http://127.0.0.1:11434/v1",
    });
    expect(created.status).toBe(200);
    const providerId = created.data.id as string;

    const row = fixture.getRawProviderRecord(providerId);
    expect(row?.base_url).toBe("http://127.0.0.1:11434/v1");

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("POST /api/providers validates and persists custom providers", async () => {
    const missingUrl = await fixture.api("POST", "/api/providers", {
      provider: "custom",
      name: `custom-missing-url-${Date.now()}`,
      api_key: "custom-secret",
    });
    expect(missingUrl.status).toBe(400);
    expect(String(missingUrl.data.error)).toContain("API base URL is required");

    const missingKey = await fixture.api("POST", "/api/providers", {
      provider: "custom",
      name: `custom-missing-key-${Date.now()}`,
      base_url: "http://127.0.0.1:8765/api/",
    });
    expect(missingKey.status).toBe(400);
    expect(String(missingKey.data.error)).toContain("API key is required");

    const created = await fixture.api("POST", "/api/providers", {
      provider: "custom",
      name: `custom-provider-${Date.now()}`,
      api_key: "custom-secret",
      base_url: "http://127.0.0.1:8765/api/",
    });
    expect(created.status).toBe(200);
    const providerId = created.data.id as string;
    const row = fixture.getRawProviderRecord(providerId);
    expect(row?.provider).toBe("custom");
    expect(row?.base_url).toBe("http://127.0.0.1:8765/api");
    expect(fixture.openRawProviderApiKey(providerId, row?.api_key || "")).toBe("custom-secret");

    const updated = await fixture.api("PUT", `/api/providers/${providerId}`, {
      base_url: "http://127.0.0.1:8766/openai/",
      api_key: "custom-secret",
    });
    expect(updated.status).toBe(200);
    expect(fixture.getRawProviderRecord(providerId)?.base_url).toBe("http://127.0.0.1:8766/openai");

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id preserves existing credentials when api_key is blank", async () => {
    const provider = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `preserve-openai-key-${Date.now()}`,
      api_key: `sk-preserve-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const before = fixture.getRawProviderRecord(providerId);
    expect(before).not.toBeNull();
    expect(before?.api_key).toStartWith("cybara-secret:v1:");
    const originalKey = fixture.openRawProviderApiKey(providerId, before?.api_key || "");
    expect(originalKey).toStartWith("sk-preserve-");

    const update = await fixture.api("PUT", `/api/providers/${providerId}`, {
      name: `preserve-openai-key-updated-${Date.now()}`,
      api_key: "",
    });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);

    const after = fixture.getRawProviderRecord(providerId);
    expect(after).not.toBeNull();
    expect(after?.name).toContain("preserve-openai-key-updated-");
    expect(after?.api_key).toStartWith("cybara-secret:v1:");
    expect(fixture.openRawProviderApiKey(providerId, after?.api_key || "")).toBe(originalKey);

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id rejects embedded-credential base URLs", async () => {
    const provider = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `bad-base-url-${Date.now()}`,
      api_key: `sk-base-url-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const update = await fixture.api("PUT", `/api/providers/${providerId}`, {
      base_url: "https://user:pass@example.com/v1",
    });
    expect(update.status).toBe(400);
    expect(update.data.code).toBe("VALIDATION_ERROR");
    expect(String(update.data.error)).toContain("cannot include embedded credentials");

    const after = fixture.getRawProviderRecord(providerId);
    expect(after?.base_url).not.toBe("https://user:pass@example.com/v1");

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id requires credentials when changing destination", async () => {
    const provider = await fixture.api("POST", "/api/providers", {
      provider: "openai",
      name: `destination-bound-key-${Date.now()}`,
      api_key: `sk-destination-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const rejected = await fixture.api("PUT", `/api/providers/${providerId}`, {
      base_url: "https://replacement.invalid/v1",
    });
    expect(rejected.status).toBe(400);
    expect(rejected.data.code).toBe("VALIDATION_ERROR");
    expect(String(rejected.data.error)).toContain("credentials must be re-entered");

    const accepted = await fixture.api("PUT", `/api/providers/${providerId}`, {
      base_url: "https://replacement.invalid/v1",
      api_key: `sk-replacement-${Date.now()}`,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.data.success).toBe(true);

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("PUT /api/providers/:id accepts localhost base URLs for local model providers", async () => {
    const provider = await fixture.api("POST", "/api/providers", {
      provider: "ollama",
      name: `local-base-url-${Date.now()}`,
    });
    expect(provider.status).toBe(200);
    const providerId = provider.data.id as string;

    const update = await fixture.api("PUT", `/api/providers/${providerId}`, {
      base_url: "http://127.0.0.1:11434/v1",
    });
    expect(update.status).toBe(200);
    expect(update.data.success).toBe(true);

    const after = fixture.getRawProviderRecord(providerId);
    expect(after?.base_url).toBe("http://127.0.0.1:11434/v1");

    await fixture.api("DELETE", `/api/providers/${providerId}`);
  });

  test("GET /api/providers/available should return provider catalog metadata", async () => {
    const { status, data } = await fixture.api("GET", "/api/providers/available");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].id).toBe("string");
    expect(typeof data[0].name).toBe("string");
    expect(Array.isArray(data[0].models)).toBe(true);

    const custom = (
      data as Array<{ id: string; authType: string; baseUrl: string; models: unknown[] }>
    ).find((provider) => provider.id === "custom");
    expect(custom).toEqual({
      id: "custom",
      authType: "api_key",
      baseUrl: "",
      models: [],
      name: "Custom Provider",
      description: "Use Custom Provider models",
      oauthFlow: null,
      hasOAuthConfig: false,
      oauthLoginUrl: null,
      apiConsoleUrl: null,
    });

    const openai = (
      data as Array<{
        id: string;
        authType: string;
        apiConsoleUrl: string | null;
      }>
    ).find((provider) => provider.id === "openai");

    const geminiCli = (
      data as Array<{
        id: string;
        authType: string;
        oauthFlow: string | null;
        hasOAuthConfig: boolean;
        apiConsoleUrl: string | null;
      }>
    ).find((provider) => provider.id === "google-gemini-cli");
    const openaiCodex = (
      data as Array<{
        id: string;
        authType: string;
        oauthFlow: string | null;
        hasOAuthConfig: boolean;
        apiConsoleUrl: string | null;
      }>
    ).find((provider) => provider.id === "openai-codex");
    expect(geminiCli).toBeDefined();
    expect(openai?.authType).toBe("api_key");
    expect(openai?.apiConsoleUrl).toBe("https://platform.openai.com/api-keys");
    expect(geminiCli?.authType).toBe("oauth");
    expect(geminiCli?.oauthFlow).toBe("redirect");
    expect(geminiCli?.hasOAuthConfig).toBe(true);
    expect(openaiCodex).toBeDefined();
    expect(openaiCodex?.authType).toBe("oauth");
    expect(openaiCodex?.oauthFlow).toBe("redirect");
    expect(openaiCodex?.hasOAuthConfig).toBe(true);
    expect(openaiCodex?.apiConsoleUrl).toBeNull();
  });

  test("GET /api/providers/health should return provider configuration", async () => {
    const { status, data } = await fixture.api("GET", "/api/providers/health");
    expect(status).toBe(200);
    expect(data.kind).toBe("configuration");
    expect(["empty", "configured", "incomplete"]).toContain(data.status);
    expect(data.summary).toBeDefined();
    expect(Array.isArray(data.providers)).toBe(true);
  });

  test("POST /api/providers/:id/test should return not found for unknown provider", async () => {
    const { status, data } = await fixture.api(
      "POST",
      `/api/providers/nonexistent-${Date.now()}/test`
    );
    expect(status).toBe(404);
    expect(data.code).toBe("NOT_FOUND");
  });
});

describe("Providers OAuth API", () => {
  test("OAuth endpoints should reject unknown provider types as validation errors", async () => {
    const suffix = `missing-provider-${Date.now()}`;

    const deviceCode = await fixture.api("POST", "/api/providers/oauth/device-code", {
      providerType: suffix,
    });
    expect(deviceCode.status).toBe(400);
    expect(deviceCode.data.code).toBe("VALIDATION_ERROR");

    const poll = await fixture.api("POST", "/api/providers/oauth/poll", {
      providerType: suffix,
      deviceCode: "device-code",
    });
    expect(poll.status).toBe(400);
    expect(poll.data.code).toBe("VALIDATION_ERROR");

    const start = await fixture.api("POST", "/api/providers/oauth/start", {
      providerType: suffix,
    });
    expect(start.status).toBe(400);
    expect(start.data.code).toBe("VALIDATION_ERROR");
  });

  test("callback status should return not_found for unknown state", async () => {
    const { status, data } = await fixture.api("POST", "/api/providers/oauth/callback-status", {
      state: `missing-state-${Date.now()}`,
      poll_token: "missing-poll-token",
    });
    expect(status).toBe(200);
    expect(data.status).toBe("not_found");
  });
});

describe("Speech API", () => {
  test("GET /api/providers/available should include ElevenLabs speech provider", async () => {
    const { status, data } = await fixture.api("GET", "/api/providers/available");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    const elevenlabs = data.find((provider: { id?: string }) => provider.id === "elevenlabs");
    expect(elevenlabs).toBeDefined();
    expect(elevenlabs.authType).toBe("api_key");
    expect(elevenlabs.models.map((model: { id: string }) => model.id)).toContain(
      "eleven_multilingual_v2"
    );
  });

  test("GET and PUT /api/speech/settings should normalize shared speech config", async () => {
    const put = await fixture.api("PUT", "/api/speech/settings", {
      tts: {
        provider: "Eleven Labs",
        providerId: "  provider-1  ",
        model: " eleven_flash_v2_5 ",
        voice: " voice-abc ",
        outputFormat: "wav",
        speed: 9,
        maxTextLength: 100000,
        fallbackToSystem: false,
      },
      stt: {
        provider: "openai-codex",
        providerId: " provider-2 ",
        model: " whisper-1 ",
        language: " EN ",
      },
    });
    expect(put.status).toBe(200);
    expect(put.data.success).toBe(true);
    expect(put.data.speech.tts.provider).toBe("elevenlabs");
    expect(put.data.speech.tts.providerId).toBe("provider-1");
    expect(put.data.speech.tts.outputFormat).toBe("wav");
    expect(put.data.speech.tts.speed).toBe(2);
    expect(put.data.speech.tts.maxTextLength).toBe(50000);
    expect(put.data.speech.stt.provider).toBe("openai");
    expect(put.data.speech.stt.language).toBe("en");

    const get = await fixture.api("GET", "/api/speech/settings");
    expect(get.status).toBe(200);
    expect(get.data.tts.provider).toBe("elevenlabs");
    expect(get.data.tts.providerId).toBe("provider-1");
    expect(get.data.stt.providerId).toBe("provider-2");

    const configResponse = await fixture.api("GET", "/api/config");
    expect(configResponse.status).toBe(200);
    expect(configResponse.data.speech.tts.model).toBe("eleven_flash_v2_5");
  });

  test("native and local speech-to-text modes are normalized", async () => {
    const put = await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "native", language: "en-US" },
    });
    expect(put.status).toBe(200);
    expect(put.data.speech.stt.provider).toBe("native");

    const local = await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "local", model: "onnx-community/whisper-tiny" },
    });
    expect(local.status).toBe(200);
    expect(local.data.speech.stt.provider).toBe("local");

    const invalidLocalAudio = await fixture.api("POST", "/api/speech/dictate", {
      provider: "local",
      audioBase64: "Zm9v",
      mimeType: "audio/webm",
      fileName: "dictation.webm",
    });
    expect(invalidLocalAudio.status).toBe(400);
    expect(String(invalidLocalAudio.data.error)).toContain("WAV or 16 kHz Float32 PCM");

    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "auto" },
    });
  });

  test("GET /api/speech/status reports voice readiness for setup guidance", async () => {
    const { status, data } = await fixture.api("GET", "/api/speech/status");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.tts.ready).toBe("boolean");
    expect(typeof data.tts.systemFallback).toBe("boolean");
    expect(typeof data.stt.ready).toBe("boolean");
    expect(typeof data.stt.native).toBe("boolean");
    expect(typeof data.settings.ttsProvider).toBe("string");
    expect(typeof data.settings.sttProvider).toBe("string");
    if (!data.tts.ready) expect(String(data.tts.error ?? "")).not.toBe(undefined);
  });

  test("GET /api/speech/local/models lists Kokoro model, voices, and status", async () => {
    const { status, data } = await fixture.api("GET", "/api/speech/local/models");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.tts.models)).toBe(true);
    expect(data.tts.models.length).toBeGreaterThan(0);
    expect(data.tts.voices.length).toBeGreaterThan(0);
    expect(data.tts.status[0].state).toBeDefined();
    expect(data.stt.models.length).toBeGreaterThan(0);
    expect(data.stt.status[0].state).toBeDefined();
  });

  test("POST /api/speech/local/unload reports success without a loaded model", async () => {
    const { status, data } = await fixture.api("POST", "/api/speech/local/unload", {});
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.status)).toBe(true);
  });

  test("GET /api/speech/status reports the system voice (not a cloud provider) when system is selected", async () => {
    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "system" },
      stt: {},
    });
    const { status, data } = await fixture.api("GET", "/api/speech/status");
    expect(status).toBe(200);
    expect(data.tts.type).toBe("system");
    expect(String(data.tts.provider ?? "")).not.toContain("OpenAI");
    expect(String(data.tts.provider ?? "")).not.toContain("ElevenLabs");
    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: {},
    });
  });

  test("GET /api/speech/status reports local Kokoro as ready when selected", async () => {
    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "local" },
      stt: {},
    });
    const { status, data } = await fixture.api("GET", "/api/speech/status");
    expect(status).toBe(200);
    expect(data.tts.type).toBe("local");
    expect(data.tts.ready).toBe(true);
    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: {},
    });
  });

  test("GET /api/speech/status reflects native transcription mode", async () => {
    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "native" },
    });
    const { status, data } = await fixture.api("GET", "/api/speech/status");
    expect(status).toBe(200);
    expect(data.stt.native).toBe(true);
    expect(data.stt.ready).toBe(true);
    await fixture.api("PUT", "/api/speech/settings", {
      tts: { provider: "auto" },
      stt: { provider: "auto" },
    });
  });

  test("POST /api/speech/dictate should reject missing audio payload", async () => {
    const { status, data } = await fixture.api("POST", "/api/speech/dictate", {});
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("audioBase64 is required");
  });

  test("POST /api/speech/dictate should reject unknown requested provider", async () => {
    const { status, data } = await fixture.api("POST", "/api/speech/dictate", {
      providerId: `missing-provider-${Date.now()}`,
      audioBase64: "Zm9v",
      mimeType: "audio/webm",
      fileName: "dictation.webm",
    });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("Requested dictation provider ID is invalid");
  });

  test("POST /api/speech/synthesize should reject empty text", async () => {
    const { status, data } = await fixture.api("POST", "/api/speech/synthesize", {
      text: "",
    });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
    expect(String(data.error)).toContain("text is required");
  });
});

describe("Channels API", () => {
  test("GET /api/channels should return array", async () => {
    const { status, data } = await fixture.api("GET", "/api/channels");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/channels/available should return channel type metadata", async () => {
    const { status, data } = await fixture.api("GET", "/api/channels/available");
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].id).toBe("string");
    expect(Array.isArray(data[0].fields)).toBe(true);
  });

  test("POST /api/channels should reject missing required config", async () => {
    const { status, data } = await fixture.api("POST", "/api/channels", {
      name: `invalid-discord-${Date.now()}`,
      type: "discord",
      config: {},
    });
    expect(status).toBe(400);
    expect(typeof data.error).toBe("string");
  });

  test("PUT /api/channels/:id ignores masked secret values echoed back by clients", async () => {
    const created = await fixture.api("POST", "/api/channels", {
      name: `webhook-mask-${Date.now()}`,
      type: "webhook",
      config: { secret: "real-hmac-secret" },
    });
    expect(created.status).toBe(200);
    expect(created.data.config.secret).toBe("••••••••");
    expect(JSON.stringify(created.data)).not.toContain("real-hmac-secret");
    const channelId = created.data.id as string;

    const fetched = await fixture.api("GET", `/api/channels/${channelId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.config.secret).toBe("••••••••");

    const roundTrip = await fixture.api("PUT", `/api/channels/${channelId}`, {
      config: fetched.data.config,
    });
    expect(roundTrip.status).toBe(200);
    expect(roundTrip.data.success).toBe(true);

    const storedAfterEcho = JSON.parse(
      fixture.openSealedValue(
        `channel:${channelId}:config`,
        fixture.readRawChannelConfig(channelId) ?? ""
      )
    ) as Record<string, unknown>;
    expect(storedAfterEcho.secret).toBe("real-hmac-secret");

    const rotate = await fixture.api("PUT", `/api/channels/${channelId}`, {
      config: { secret: "rotated-hmac-secret" },
    });
    expect(rotate.status).toBe(200);
    const storedAfterRotate = JSON.parse(
      fixture.openSealedValue(
        `channel:${channelId}:config`,
        fixture.readRawChannelConfig(channelId) ?? ""
      )
    ) as Record<string, unknown>;
    expect(storedAfterRotate.secret).toBe("rotated-hmac-secret");

    await fixture.api("DELETE", `/api/channels/${channelId}`);
  });

  test("POST /api/channels/telegram/setup should validate bot token", async () => {
    const { status, data } = await fixture.api("POST", "/api/channels/telegram/setup", {});
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("GET /api/channels/:id and POST /api/channels/:id/test should work for web channel", async () => {
    const channelName = `web-test-${Date.now()}`;
    const created = await fixture.api("POST", "/api/channels", {
      name: channelName,
      type: "web",
      config: {},
    });

    expect(created.status).toBe(200);
    const channelId = created.data.id as string;
    expect(channelId).toBeDefined();

    const fetched = await fixture.api("GET", `/api/channels/${channelId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.data.id).toBe(channelId);
    expect(fetched.data.type).toBe("web");

    const tested = await fixture.api("POST", `/api/channels/${channelId}/test`);
    expect(tested.status).toBe(200);
    expect(tested.data.success).toBe(true);
    expect(tested.data.running).toBe(true);

    await fixture.api("DELETE", `/api/channels/${channelId}`);
  });

  test("channel routes tolerate malformed persisted config JSON", async () => {
    const suffix = Date.now().toString();
    const channelId = `discord-bad-config-${suffix}`;
    fixture.insertRawChannel(channelId, "discord", `discord-bad-${suffix}`, "{bad-json", false);

    const listRes = await fixture.api("GET", "/api/channels");
    expect(listRes.status).toBe(200);
    const listed = (listRes.data as Array<{ id: string; config: Record<string, unknown> }>).find(
      (entry) => entry.id === channelId
    );
    expect(listed).toBeDefined();
    expect(listed?.config).toEqual({});

    const malformedTestRes = await fixture.api("POST", `/api/channels/${channelId}/test`);
    expect(malformedTestRes.status).toBe(200);
    expect(malformedTestRes.data.success).toBe(false);
    expect(typeof malformedTestRes.data.error).toBe("string");
    expect(malformedTestRes.data.error).toContain("Missing required config fields");
    expect(malformedTestRes.data.error).toContain("bot_token");

    const updateRes = await fixture.api("PUT", `/api/channels/${channelId}`, {
      config: { bot_token: "recovered-token" },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.data.success).toBe(true);

    const recoveredRes = await fixture.api("POST", `/api/channels/${channelId}/test`);
    expect(recoveredRes.status).toBe(200);
    expect(recoveredRes.data.success).toBe(false);
    expect(recoveredRes.data.error).toBeUndefined();

    const getRes = await fixture.api("GET", `/api/channels/${channelId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.data.config.bot_token).toBe("••••••••");

    await fixture.api("DELETE", `/api/channels/${channelId}`);
  });
});

describe("Webhooks API", () => {
  test("POST /api/webhooks/telegram/:channelId returns a failing HTTP status for unknown channels", async () => {
    const { status, data } = await fixture.api(
      "POST",
      `/api/webhooks/telegram/missing-${Date.now()}`,
      {}
    );
    expect(status).toBe(404);
    expect(data.ok).toBe(false);
  });

  test("POST /api/channels/:channelId/webhook preserves route failures", async () => {
    const { status, data } = await fixture.api(
      "POST",
      `/api/channels/missing-${Date.now()}/webhook`,
      { message: "hello" }
    );
    expect(status).toBe(404);
    expect(data.error).toBe("channel not found");
  });
});
