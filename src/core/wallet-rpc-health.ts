import type { WalletRpcServiceStatus, WalletRpcStatus } from "./wallet-types";

export type WalletRpcFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

interface WalletRpcEndpoints {
  btcApi: string;
  ethRpc: string;
  solRpc: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkEthRpc(
  endpoint: string,
  fetcher: WalletRpcFetch
): Promise<WalletRpcServiceStatus> {
  const startedAt = Date.now();
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "cybara-wallet/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (payload.error) throw new Error(payload.error.message || "RPC error");
    const blockNumber = Number.parseInt(String(payload.result || "0x0"), 16);
    return {
      chain: "eth",
      endpoint,
      healthy: true,
      latencyMs: Date.now() - startedAt,
      latestHeight: Number.isFinite(blockNumber) ? String(blockNumber) : undefined,
    };
  } catch (error) {
    return {
      chain: "eth",
      endpoint,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

async function checkSolRpc(
  endpoint: string,
  fetcher: WalletRpcFetch
): Promise<WalletRpcServiceStatus> {
  const startedAt = Date.now();
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "cybara-wallet/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSlot",
        params: [{ commitment: "processed" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      result?: number;
      error?: { message?: string };
    };
    if (payload.error) throw new Error(payload.error.message || "RPC error");
    return {
      chain: "sol",
      endpoint,
      healthy: true,
      latencyMs: Date.now() - startedAt,
      latestHeight:
        typeof payload.result === "number" && Number.isFinite(payload.result)
          ? String(payload.result)
          : undefined,
    };
  } catch (error) {
    return {
      chain: "sol",
      endpoint,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

async function checkBtcApi(
  endpoint: string,
  fetcher: WalletRpcFetch
): Promise<WalletRpcServiceStatus> {
  const startedAt = Date.now();
  try {
    const response = await fetcher(`${endpoint.replace(/\/+$/, "")}/blocks/tip/height`, {
      headers: { "user-agent": "cybara-wallet/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const height = (await response.text()).trim();
    if (!height) throw new Error("Empty height response");
    return {
      chain: "btc",
      endpoint,
      healthy: true,
      latencyMs: Date.now() - startedAt,
      latestHeight: height,
    };
  } catch (error) {
    return {
      chain: "btc",
      endpoint,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

export async function checkWalletRpcStatus(
  endpoints: WalletRpcEndpoints,
  fetcher: WalletRpcFetch = fetch
): Promise<WalletRpcStatus> {
  const checkedAt = new Date().toISOString();
  const services = await Promise.all([
    checkEthRpc(endpoints.ethRpc, fetcher),
    checkSolRpc(endpoints.solRpc, fetcher),
    checkBtcApi(endpoints.btcApi, fetcher),
  ]);
  return { checkedAt, services };
}
