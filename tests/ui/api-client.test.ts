import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  agentsApi,
  chatApi,
  channelsApi,
  logsApi,
  mcpApi,
  memoryApi,
  migrationApi,
  mobileApi,
  providerPlansApi,
  providersApi,
  settingsApi,
  setupApi,
  skillsApi,
  sessionsApi,
  subagentApi,
  tasksApi,
  walletApi,
} from "../../ui/src/lib/api";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: Window }).window;

type StorageMap = Map<string, string>;

function createWindow(search: string, initialStorage: Record<string, string> = {}) {
  const store: StorageMap = new Map(Object.entries(initialStorage));
  return {
    location: { search },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  };
}

describe("UI API client wiring", () => {
  let calls: FetchCall[] = [];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = originalWindow;
    }
  });

  test("injects Authorization header from UI token", async () => {
    (globalThis as unknown as { window: Window }).window = createWindow("", {
      cybara_api_key: "ui-token",
    }) as unknown as Window;

    await agentsApi.list();

    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer ui-token");
  });

  test("agentsApi.chat uses POST /api/agents/:id/chat", async () => {
    const res = await agentsApi.chat("agent-1", "hello", "session-1");

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/agents/agent-1/chat");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      message: "hello",
      sessionId: "session-1",
    });
  });

  test("channelsApi.setupTelegram uses botToken payload", async () => {
    await channelsApi.setupTelegram("123:abc", "https://example.com/webhook");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/channels/telegram/setup");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      botToken: "123:abc",
      webhookUrl: "https://example.com/webhook",
    });
  });

  test("channelsApi pairing and test helpers use security endpoints", async () => {
    await channelsApi.getPairings("chan-1");
    await channelsApi.verifyPairing("chan-1", "PAIR42");
    await channelsApi.rejectPairing("chan-1", "pair-1");
    await channelsApi.test("chan-1");

    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe("/api/channels/chan-1/pairings");
    expect(calls[0].init?.method).toBeUndefined();

    expect(calls[1].url).toBe("/api/channels/chan-1/pairings/verify");
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ code: "PAIR42" });

    expect(calls[2].url).toBe("/api/channels/chan-1/pairings/pair-1/reject");
    expect(calls[2].init?.method).toBe("POST");

    expect(calls[3].url).toBe("/api/channels/chan-1/test");
    expect(calls[3].init?.method).toBe("POST");
  });

  test("mobileApi uses managed device lifecycle endpoints", async () => {
    await mobileApi.connectInfo();
    await mobileApi.listDevices();
    await mobileApi.createDevice({
      deviceName: "QA Phone",
      gatewayName: "Studio Gateway",
      baseUrl: "http://192.168.1.20:4269",
    });
    await mobileApi.revokeDevice("mobile-1");
    await mobileApi.deleteDevice("mobile-1");

    expect(calls).toHaveLength(5);
    expect(calls[0].url).toBe("/api/mobile/connect-info");
    expect(calls[0].init?.method).toBeUndefined();

    expect(calls[1].url).toBe("/api/mobile/devices");
    expect(calls[1].init?.method).toBeUndefined();

    expect(calls[2].url).toBe("/api/mobile/devices");
    expect(calls[2].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      deviceName: "QA Phone",
      gatewayName: "Studio Gateway",
      baseUrl: "http://192.168.1.20:4269",
    });

    expect(calls[3].url).toBe("/api/mobile/devices/mobile-1/revoke");
    expect(calls[3].init?.method).toBe("POST");

    expect(calls[4].url).toBe("/api/mobile/devices/mobile-1");
    expect(calls[4].init?.method).toBe("DELETE");
  });

  test("providerPlansApi uses provider plan endpoints", async () => {
    const config = await providerPlansApi.config();
    const status = await providerPlansApi.status();
    await providerPlansApi.updateConfig({
      enabled: true,
      routerEnforcement: true,
      warningThresholdPct: 80,
      staleAfterMinutes: 120,
      providers: {
        "openai-codex": {
          planName: "Codex Plus",
          monthly: { tokenLimit: 20_000_000, spendLimit: 20 },
        },
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("/api/provider-plans/config");
    expect(calls[0].init?.method).toBeUndefined();
    expect(config.data?.providers).toEqual({});
    expect(calls[1].url).toBe("/api/provider-plans/status");
    expect(calls[1].init?.method).toBeUndefined();
    expect(status.data?.summary.configured).toBe(0);
    expect(status.data?.providers).toEqual([]);
    expect(calls[2].url).toBe("/api/provider-plans/config");
    expect(calls[2].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      enabled: true,
      routerEnforcement: true,
      warningThresholdPct: 80,
      staleAfterMinutes: 120,
      providers: {
        "openai-codex": {
          planName: "Codex Plus",
          monthly: { tokenLimit: 20_000_000, spendLimit: 20 },
        },
      },
    });
  });

  test("migrationApi uses managed preview and run endpoints", async () => {
    await migrationApi.sources();
    await migrationApi.preview({
      sourceKind: "openclaw",
      sourcePath: "/tmp/.openclaw",
      preset: "user-data",
    });
    await migrationApi.run({
      sourceKind: "hermes",
      sourcePath: "/tmp/.hermes",
      preset: "full",
      migrateSecrets: true,
      overwrite: true,
      skillConflict: "rename",
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("/api/migrations/sources");
    expect(calls[1].url).toBe("/api/migrations/preview");
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      sourceKind: "openclaw",
      sourcePath: "/tmp/.openclaw",
      preset: "user-data",
      dryRun: true,
    });
    expect(calls[2].url).toBe("/api/migrations/run");
    expect(calls[2].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      sourceKind: "hermes",
      sourcePath: "/tmp/.hermes",
      preset: "full",
      migrateSecrets: true,
      overwrite: true,
      skillConflict: "rename",
      dryRun: false,
    });
  });

  test("memoryApi.list encodes query params", async () => {
    await memoryApi.list({
      agentId: "agent 1",
      userId: "user@example.com",
      search: "error + logs",
      limit: 25,
    });

    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0].url, "http://localhost");
    expect(parsed.pathname).toBe("/api/memory");
    expect(parsed.searchParams.get("agentId")).toBe("agent 1");
    expect(parsed.searchParams.get("userId")).toBe("user@example.com");
    expect(parsed.searchParams.get("search")).toBe("error + logs");
    expect(parsed.searchParams.get("limit")).toBe("25");
  });

  test("memoryApi.search uses GET query params", async () => {
    await memoryApi.search("needles + haystack", 10);

    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0].url, "http://localhost");
    expect(parsed.pathname).toBe("/api/memory/search");
    expect(parsed.searchParams.get("query")).toBe("needles + haystack");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(calls[0].init?.method).toBeUndefined();
  });

  test("memoryApi.createFile posts file + content payload", async () => {
    await memoryApi.createFile("notes", "remember this");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/memory");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      file: "notes",
      content: "remember this",
    });
  });

  test("memoryApi item helpers encode filename path segments", async () => {
    await memoryApi.get("project notes.md");
    await memoryApi.update("folder/nested.md", { content: "updated" });
    await memoryApi.delete("../workspace.md");

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("/api/memory/project%20notes.md");
    expect(calls[1].url).toBe("/api/memory/folder%2Fnested.md");
    expect(calls[1].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ content: "updated" });
    expect(calls[2].url).toBe("/api/memory/..%2Fworkspace.md");
    expect(calls[2].init?.method).toBe("DELETE");
  });

  test("logsApi.search encodes query", async () => {
    await logsApi.search("agent failed? channel=discord");

    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0].url, "http://localhost");
    expect(parsed.pathname).toBe("/api/logs/search");
    expect(parsed.searchParams.get("q")).toBe("agent failed? channel=discord");
  });

  test("chatApi uses expected chat/session endpoints", async () => {
    await chatApi.send("hi", "agent-1", "session-1");
    await chatApi.getSessions();
    await chatApi.getSession("session-1");
    await chatApi.updateSessionWorkspace("session-1", "/tmp/workspace");
    await chatApi.revertSession("session-1", {
      messageIndex: 2,
      messageRole: "user",
      messageContent: "hi",
      messageTimestamp: "2026-02-21T00:00:00.000Z",
    });
    await chatApi.deleteSession("session-1");

    expect(calls).toHaveLength(6);
    expect(calls[0].url).toBe("/api/chat");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      message: "hi",
      agentId: "agent-1",
      sessionId: "session-1",
    });

    expect(calls[1].url).toBe("/api/sessions");
    expect(calls[1].init?.method).toBeUndefined();

    expect(calls[2].url).toBe("/api/sessions/session-1");
    expect(calls[2].init?.method).toBeUndefined();

    expect(calls[3].url).toBe("/api/sessions/session-1/workspace");
    expect(calls[3].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({
      workspaceDir: "/tmp/workspace",
    });

    expect(calls[4].url).toBe("/api/sessions/session-1/revert");
    expect(calls[4].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[4].init?.body))).toEqual({
      messageIndex: 2,
      messageRole: "user",
      messageContent: "hi",
      messageTimestamp: "2026-02-21T00:00:00.000Z",
    });

    expect(calls[5].url).toBe("/api/sessions/session-1");
    expect(calls[5].init?.method).toBe("DELETE");
  });

  test("logsApi activity/stats attach query params", async () => {
    await logsApi.getActivity(30);
    await logsApi.getStats(12);

    expect(calls).toHaveLength(2);

    const activity = new URL(calls[0].url, "http://localhost");
    expect(activity.pathname).toBe("/api/logs/activity");
    expect(activity.searchParams.get("minutes")).toBe("30");

    const stats = new URL(calls[1].url, "http://localhost");
    expect(stats.pathname).toBe("/api/logs/stats");
    expect(stats.searchParams.get("hours")).toBe("12");
  });

  test("skillsApi.test uses execute endpoint", async () => {
    await skillsApi.test("skill-1", { input: "hello" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/skills/skill-1/execute");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ input: "hello" });
  });

  test("providers/tasks/sessions/subagents hit expected endpoints", async () => {
    await providersApi.test("prov-1");
    await tasksApi.run("task-1");
    await sessionsApi.delete("session-1");
    await subagentApi.kill("sub-1");

    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe("/api/providers/prov-1/test");
    expect(calls[0].init?.method).toBe("POST");

    expect(calls[1].url).toBe("/api/tasks/task-1/run");
    expect(calls[1].init?.method).toBe("POST");

    expect(calls[2].url).toBe("/api/sessions/session-1");
    expect(calls[2].init?.method).toBe("DELETE");

    expect(calls[3].url).toBe("/api/subagents/sub-1/kill");
    expect(calls[3].init?.method).toBe("POST");
  });

  test("tasksApi.getRuns hits /api/tasks/:id/runs", async () => {
    await tasksApi.getRuns("task-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/tasks/task-1/runs");
    expect(calls[0].init?.method).toBeUndefined();
  });

  test("mcpApi uses expected list/registry/lifecycle endpoints", async () => {
    await mcpApi.list();
    await mcpApi.popular();
    await mcpApi.search("filesystem tools");
    await mcpApi.install({ id: "filesystem", trustedAction: true });
    await mcpApi.create({
      name: "Filesystem MCP",
      command: "bunx",
      args: "@modelcontextprotocol/server-filesystem",
      enabled: true,
    });
    await mcpApi.start("mcp-1");
    await mcpApi.stop("mcp-1");
    await mcpApi.delete("mcp-1");

    expect(calls).toHaveLength(8);

    expect(calls[0].url).toBe("/api/mcp");
    expect(calls[0].init?.method).toBeUndefined();

    expect(calls[1].url).toBe("/api/mcp/registry/popular");
    expect(calls[1].init?.method).toBeUndefined();

    const searchUrl = new URL(calls[2].url, "http://localhost");
    expect(searchUrl.pathname).toBe("/api/mcp/registry/search");
    expect(searchUrl.searchParams.get("q")).toBe("filesystem tools");

    expect(calls[3].url).toBe("/api/mcp/registry/install");
    expect(calls[3].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({
      id: "filesystem",
      trustedAction: true,
    });

    expect(calls[4].url).toBe("/api/mcp");
    expect(calls[4].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[4].init?.body))).toEqual({
      name: "Filesystem MCP",
      command: "bunx",
      args: "@modelcontextprotocol/server-filesystem",
      enabled: true,
    });

    expect(calls[5].url).toBe("/api/mcp/mcp-1/start");
    expect(calls[5].init?.method).toBe("POST");

    expect(calls[6].url).toBe("/api/mcp/mcp-1/stop");
    expect(calls[6].init?.method).toBe("POST");

    expect(calls[7].url).toBe("/api/mcp/mcp-1");
    expect(calls[7].init?.method).toBe("DELETE");
  });

  test("settingsApi get/update config uses /api/config", async () => {
    await settingsApi.getConfig();
    await settingsApi.updateConfig({ terminal_enabled: true });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("/api/config");
    expect(calls[0].init?.method).toBeUndefined();

    expect(calls[1].url).toBe("/api/config");
    expect(calls[1].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      terminal_enabled: true,
    });
  });

  test("setupApi status/complete uses setup endpoints", async () => {
    await setupApi.status();
    await setupApi.complete();

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("/api/setup/status");
    expect(calls[0].init?.method).toBeUndefined();

    expect(calls[1].url).toBe("/api/setup/complete");
    expect(calls[1].init?.method).toBe("POST");
  });

  test("walletApi uses expected wallet endpoints", async () => {
    await walletApi.status();
    await walletApi.rpc();
    await walletApi.rpcStatus();
    await walletApi.updateRpc({
      ethRpc: "https://ethereum-rpc.publicnode.com",
      solRpc: "https://api.mainnet-beta.solana.com",
      btcApi: "https://mempool.space/api",
    });
    await walletApi.accounts({ chains: ["eth", "btc"], count: 2, startIndex: 1 });
    await walletApi.receive("sol", 3);
    await walletApi.balances({ chains: ["eth", "sol"], count: 3, startIndex: 0 });
    await walletApi.tokenBalances({ chain: "eth", index: 1, includeZero: true });
    await walletApi.tokenTransactions({
      chain: "sol",
      index: 2,
      limit: 15,
      tokenAddress: "So11111111111111111111111111111111111111112",
      rpcUrl: "https://sol-rpc.example",
    });
    await walletApi.transactions({
      chain: "btc",
      index: 4,
      limit: 12,
      rpcUrl: "https://rpc.example",
    });
    await walletApi.send({ chain: "eth", to: "0xabc", amount: "0.1", index: 1, memo: "test memo" });
    await walletApi.sendToken({
      chain: "sol",
      tokenAddress: "So11111111111111111111111111111111111111112",
      to: "SoReceiver111111111111111111111111111111111111",
      amount: "1.5",
      index: 2,
      decimals: 9,
    });
    await walletApi.ethContractCall({
      contractAddress: "0x0000000000000000000000000000000000000001",
      method: "balanceOf(address)",
      methodSignature: "balanceOf(address)",
      args: ["0x0000000000000000000000000000000000000002"],
      gasLimit: "210000",
      maxFeePerGasGwei: "25",
      nonce: 4,
      readOnly: true,
    });
    await walletApi.solProgramInstruction({
      programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      accounts: [
        { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
      ],
      dataHex: "0x0102",
      computeUnitLimit: 180000,
      computeUnitPriceMicroLamports: 2000,
      skipPreflight: true,
      index: 0,
    });
    await walletApi.swapEthUniswap({
      tokenOut: "LINK",
      percent: 50,
      slippageBps: 120,
      dryRun: true,
      index: 1,
    });
    await walletApi.priceQuote({
      source: "chainlink",
      symbol: "BTC",
    });
    await walletApi.swap({
      venue: "jupiter",
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1.5",
      dryRun: true,
    });
    await walletApi.endpoints();
    await walletApi.dapps();
    await walletApi.rpcCall({ chain: "eth", method: "eth_blockNumber", params: [], id: 7 });
    await walletApi.dapp({
      adapter: "uniswap_v3",
      payload: { action: "quote", pair: "ETH/USDC" },
    });
    await walletApi.x402({
      url: "https://merchant.example/x402",
      method: "POST",
      network: "eip155:1",
      maxAmountAtomic: "250000",
      dryRun: true,
    });
    await walletApi.signMessage("hello", "eth", 5);
    await walletApi.getAgentPolicy();
    await walletApi.updateAgentPolicy({
      allowNativeSend: true,
      allowTokenSend: true,
      allowEthSwaps: true,
      allowDappInteraction: true,
      allowX402Payments: true,
      allowedEthContracts: ["0x0000000000000000000000000000000000000001"],
      allowedSolPrograms: ["11111111111111111111111111111111"],
      allowedDappHosts: ["merchant.example"],
      allowedX402Networks: ["eip155:1"],
      x402MaxAmountAtomic: "250000",
    });
    await walletApi.setAgentAccess(true);
    await walletApi.deleteWallet("secretpass");

    expect(calls).toHaveLength(27);
    expect(calls[0].url).toBe("/api/wallet/status");
    expect(calls[1].url).toBe("/api/wallet/rpc");
    expect(calls[2].url).toBe("/api/wallet/rpc/status");
    expect(calls[3].url).toBe("/api/wallet/rpc");
    expect(calls[3].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({
      ethRpc: "https://ethereum-rpc.publicnode.com",
      solRpc: "https://api.mainnet-beta.solana.com",
      btcApi: "https://mempool.space/api",
    });
    expect(calls[4].url).toBe("/api/wallet/accounts?chains=eth%2Cbtc&count=2&startIndex=1");
    expect(calls[5].url).toBe("/api/wallet/receive?chain=sol&index=3");
    expect(calls[6].url).toBe("/api/wallet/balances?chains=eth%2Csol&count=3&startIndex=0");
    expect(calls[7].url).toBe("/api/wallet/tokens?chain=eth&index=1&includeZero=true");
    expect(calls[8].url).toBe(
      "/api/wallet/token-transactions?chain=sol&index=2&limit=15&tokenAddress=So11111111111111111111111111111111111111112&rpcUrl=https%3A%2F%2Fsol-rpc.example"
    );
    expect(calls[9].url).toBe(
      "/api/wallet/transactions?chain=btc&index=4&limit=12&rpcUrl=https%3A%2F%2Frpc.example"
    );
    expect(calls[10].url).toBe("/api/wallet/send");
    expect(calls[10].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[10].init?.body))).toEqual({
      chain: "eth",
      to: "0xabc",
      amount: "0.1",
      index: 1,
      memo: "test memo",
    });
    expect(calls[11].url).toBe("/api/wallet/send-token");
    expect(calls[11].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[11].init?.body))).toEqual({
      chain: "sol",
      tokenAddress: "So11111111111111111111111111111111111111112",
      to: "SoReceiver111111111111111111111111111111111111",
      amount: "1.5",
      index: 2,
      decimals: 9,
    });
    expect(calls[12].url).toBe("/api/wallet/eth-contract");
    expect(calls[12].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[12].init?.body))).toEqual({
      contractAddress: "0x0000000000000000000000000000000000000001",
      method: "balanceOf(address)",
      methodSignature: "balanceOf(address)",
      args: ["0x0000000000000000000000000000000000000002"],
      gasLimit: "210000",
      maxFeePerGasGwei: "25",
      nonce: 4,
      readOnly: true,
    });
    expect(calls[13].url).toBe("/api/wallet/sol-instruction");
    expect(calls[13].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[13].init?.body))).toEqual({
      programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      accounts: [
        { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
      ],
      dataHex: "0x0102",
      computeUnitLimit: 180000,
      computeUnitPriceMicroLamports: 2000,
      skipPreflight: true,
      index: 0,
    });
    expect(calls[14].url).toBe("/api/wallet/swap-eth-uniswap");
    expect(calls[14].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[14].init?.body))).toEqual({
      tokenOut: "LINK",
      percent: 50,
      slippageBps: 120,
      dryRun: true,
      index: 1,
    });
    expect(calls[15].url).toBe("/api/wallet/price");
    expect(calls[15].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[15].init?.body))).toEqual({
      source: "chainlink",
      symbol: "BTC",
    });
    expect(calls[16].url).toBe("/api/wallet/swap");
    expect(calls[16].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[16].init?.body))).toEqual({
      venue: "jupiter",
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1.5",
      dryRun: true,
    });
    expect(calls[17].url).toBe("/api/wallet/endpoints");
    expect(calls[18].url).toBe("/api/wallet/dapps");
    expect(calls[19].url).toBe("/api/wallet/rpc-call");
    expect(calls[19].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[19].init?.body))).toEqual({
      chain: "eth",
      method: "eth_blockNumber",
      params: [],
      id: 7,
    });
    expect(calls[20].url).toBe("/api/wallet/dapp");
    expect(calls[20].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[20].init?.body))).toEqual({
      adapter: "uniswap_v3",
      payload: { action: "quote", pair: "ETH/USDC" },
    });
    expect(calls[21].url).toBe("/api/wallet/x402");
    expect(calls[21].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[21].init?.body))).toEqual({
      url: "https://merchant.example/x402",
      method: "POST",
      network: "eip155:1",
      maxAmountAtomic: "250000",
      dryRun: true,
    });
    expect(calls[22].url).toBe("/api/wallet/sign");
    expect(calls[22].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[22].init?.body))).toEqual({
      message: "hello",
      chain: "eth",
      index: 5,
    });
    expect(calls[23].url).toBe("/api/wallet/agent-policy");
    expect(calls[24].url).toBe("/api/wallet/agent-policy");
    expect(calls[24].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[24].init?.body))).toEqual({
      allowNativeSend: true,
      allowTokenSend: true,
      allowEthSwaps: true,
      allowDappInteraction: true,
      allowX402Payments: true,
      allowedEthContracts: ["0x0000000000000000000000000000000000000001"],
      allowedSolPrograms: ["11111111111111111111111111111111"],
      allowedDappHosts: ["merchant.example"],
      allowedX402Networks: ["eip155:1"],
      x402MaxAmountAtomic: "250000",
    });
    expect(calls[25].url).toBe("/api/wallet/agent-access");
    expect(calls[25].init?.method).toBe("PUT");
    expect(calls[26].url).toBe("/api/wallet");
    expect(calls[26].init?.method).toBe("DELETE");
    expect(JSON.parse(String(calls[26].init?.body))).toEqual({
      password: "secretpass",
    });
  });

  test("returns success=false with text error body on non-OK response", async () => {
    globalThis.fetch = (async () => {
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;

    const res = await providersApi.test("prov-1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("bad request");
  });
});
