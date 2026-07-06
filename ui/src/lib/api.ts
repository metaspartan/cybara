import type {
  Agent,
  Provider,
  Channel,
  Memory,
  Task,
  Skill,
  ChatMessage,
  ChatSession,
  ApiResponse,
  DashboardStats,
  MobileDevice,
  MobilePairing,
  ProviderPlanMonitoringConfig,
  ProviderPlanStatusResponse,
} from "@/types";
import { apiFetch } from "@/lib/auth";
import type { PendingChatMessage } from "@/lib/status-stream";

const API_BASE = "/api";

type ChatProcessActivityPayload = Array<{
  id?: string;
  phase?: "start" | "result" | "error";
  text?: string;
  timestamp?: number | string;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}>;

/**
 * Resolve a human-readable error from an ApiResponse: prefer a nested
 * `data.error` (envelope returned with HTTP 200), then the transport `error`,
 * then the caller's fallback. Centralizes the chain repeated across hooks.
 */
export function extractApiError<T>(response: ApiResponse<T>, fallback: string): string {
  const data = response.data as { error?: unknown } | undefined;
  const dataError =
    data && typeof data === "object" && typeof data.error === "string" ? data.error : null;
  return dataError || response.error || fallback;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;
  const response = await apiFetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error };
  }

  const data = await response.json();
  return { success: true, data };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeProviderPlanStatusResponse(value: unknown): ProviderPlanStatusResponse {
  const record = asRecord(value);
  const summary = asRecord(record.summary);
  return {
    enabled: record.enabled !== false,
    routerEnforcement: record.routerEnforcement !== false && record.router_enforcement !== false,
    warningThresholdPct: readNumber(record, "warningThresholdPct", 80),
    providers: Array.isArray(record.providers)
      ? (record.providers as ProviderPlanStatusResponse["providers"])
      : [],
    summary: {
      total: readNumber(summary, "total"),
      monitored: readNumber(summary, "monitored"),
      configured: readNumber(summary, "configured"),
      warnings: readNumber(summary, "warnings"),
      exhausted: readNumber(summary, "exhausted"),
    },
  };
}

export const agentsApi = {
  list: () => fetchApi<Agent[]>("/agents"),
  get: (id: string) => fetchApi<Agent>(`/agents/${id}`),
  create: (agent: Omit<Agent, "id" | "createdAt" | "updatedAt">) =>
    fetchApi<Agent>("/agents", { method: "POST", body: JSON.stringify(agent) }),
  update: (id: string, agent: Partial<Agent>) =>
    fetchApi<Agent>(`/agents/${id}`, { method: "PUT", body: JSON.stringify(agent) }),
  delete: (id: string) => fetchApi<void>(`/agents/${id}`, { method: "DELETE" }),
  chat: (
    id: string,
    message: string,
    sessionId?: string,
    workspaceDir?: string | null,
    signal?: AbortSignal,
    queueMode?: "queue" | "steer",
    clientPendingId?: string
  ) =>
    fetchApi<{
      message: ChatMessage;
      sessionId: string;
      workspaceDir?: string | null;
      queued?: boolean;
      interrupted?: boolean;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
    }>(`/agents/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, sessionId, workspaceDir, queueMode, clientPendingId }),
      signal,
    }),
};

export const providersApi = {
  list: () => fetchApi<Provider[]>("/providers"),
  get: (id: string) => fetchApi<Provider>(`/providers/${id}`),
  create: (provider: Omit<Provider, "id" | "createdAt">) =>
    fetchApi<Provider>("/providers", { method: "POST", body: JSON.stringify(provider) }),
  update: (id: string, provider: Partial<Provider>) =>
    fetchApi<Provider>(`/providers/${id}`, { method: "PUT", body: JSON.stringify(provider) }),
  delete: (id: string) => fetchApi<void>(`/providers/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    fetchApi<{ success: boolean; latency: number }>(`/providers/${id}/test`, { method: "POST" }),
};

export const providerPlansApi = {
  config: () => fetchApi<ProviderPlanMonitoringConfig>("/provider-plans/config"),
  status: async (): Promise<ApiResponse<ProviderPlanStatusResponse>> => {
    const response = await fetchApi<unknown>("/provider-plans/status");
    if (!response.success) return { success: false, error: response.error };
    return {
      ...response,
      data: normalizeProviderPlanStatusResponse(response.data),
    };
  },
  updateConfig: (payload: ProviderPlanMonitoringConfig) =>
    fetchApi<ProviderPlanMonitoringConfig>("/provider-plans/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
};

export const channelsApi = {
  list: () => fetchApi<Channel[]>("/channels"),
  get: (id: string) => fetchApi<Channel>(`/channels/${id}`),
  create: (channel: Omit<Channel, "id" | "createdAt">) =>
    fetchApi<Channel>("/channels", { method: "POST", body: JSON.stringify(channel) }),
  update: (id: string, channel: Partial<Channel>) =>
    fetchApi<Channel>(`/channels/${id}`, { method: "PUT", body: JSON.stringify(channel) }),
  delete: (id: string) => fetchApi<void>(`/channels/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    fetchApi<{ success: boolean; running?: boolean; error?: string; message?: string }>(
      `/channels/${id}/test`,
      {
        method: "POST",
      }
    ),
  getWhatsAppState: (id: string) =>
    fetchApi<{
      success: boolean;
      channelId: string;
      enabled: boolean;
      running: boolean;
      ready: boolean;
      authenticated: boolean;
      awaitingQr: boolean;
      qr: string | null;
      qrDataUrl: string | null;
      lastEventAt: string;
      lastError: string | null;
    }>(`/channels/${id}/whatsapp/state`),
  getPairings: (id: string) =>
    fetchApi<{
      pairings: Array<{
        id: string;
        senderId: string;
        code: string;
        platform: string;
        displayName?: string;
        status: string;
        createdAt: string;
        expiresAt: string;
      }>;
      pendingCount: number;
      config?: Record<string, unknown>;
    }>(`/channels/${id}/pairings`),
  verifyPairing: (id: string, code: string) =>
    fetchApi<{ success: boolean; senderId?: string; error?: string }>(
      `/channels/${id}/pairings/verify`,
      {
        method: "POST",
        body: JSON.stringify({ code }),
      }
    ),
  rejectPairing: (id: string, pairingId: string) =>
    fetchApi<{ success: boolean }>(`/channels/${id}/pairings/${pairingId}/reject`, {
      method: "POST",
    }),
  setupTelegram: (botToken: string, webhookUrl: string) =>
    fetchApi<Channel>("/channels/telegram/setup", {
      method: "POST",
      body: JSON.stringify({ botToken, webhookUrl }),
    }),
};

export const mobileApi = {
  listDevices: () => fetchApi<{ devices: MobileDevice[] }>("/mobile/devices"),
  createDevice: (payload: { deviceName?: string; gatewayName?: string; baseUrl: string }) =>
    fetchApi<MobilePairing>("/mobile/devices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  revokeDevice: (id: string) =>
    fetchApi<{ success: boolean; device: MobileDevice }>(`/mobile/devices/${id}/revoke`, {
      method: "POST",
    }),
  deleteDevice: (id: string) =>
    fetchApi<{ success: boolean }>(`/mobile/devices/${id}`, { method: "DELETE" }),
};

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args?: string;
  env?: string;
  enabled: boolean;
  status: string;
  toolCount: number;
}

export interface MCPRegistryServer {
  id: string;
  name: string;
  description: string;
  registry: string;
  package: string;
  command: string;
  args?: string;
  envVars?: string[];
  categories?: string[];
  installType?: string;
}

export const mcpApi = {
  list: () => fetchApi<MCPServer[]>("/mcp"),
  popular: () => fetchApi<MCPRegistryServer[]>("/mcp/registry/popular"),
  search: (query: string) =>
    fetchApi<MCPRegistryServer[]>(`/mcp/registry/search?q=${encodeURIComponent(query)}`),
  install: (payload: { id?: string; package?: string }) =>
    fetchApi<{ success: boolean; id?: string; error?: string }>("/mcp/registry/install", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  create: (server: {
    name: string;
    command: string;
    args?: string;
    env?: string;
    enabled?: boolean;
  }) =>
    fetchApi<{
      id: string;
      name: string;
      command: string;
      args?: string;
      env?: string;
      enabled: boolean;
    }>("/mcp", {
      method: "POST",
      body: JSON.stringify(server),
    }),
  start: (id: string) =>
    fetchApi<{ success: boolean; error?: string }>(`/mcp/${id}/start`, { method: "POST" }),
  stop: (id: string) =>
    fetchApi<{ success: boolean; error?: string }>(`/mcp/${id}/stop`, { method: "POST" }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/mcp/${id}`, { method: "DELETE" }),
};

export interface GatewayAuthSettings {
  success: boolean;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  apiKeySource: "env" | "file" | "none";
  apiKeyPath: string;
  requireAuthForLocalhost: boolean;
  requireAuthForLocalhostForced: boolean;
  localhostBypassActive: boolean;
  rateLimits: Record<string, { windowMs: number; maxRequests: number }>;
}

export const systemApi = {
  restart: () =>
    fetchApi<{ success: boolean; supervised: boolean; message: string }>("/system/restart", {
      method: "POST",
    }),
  health: () => fetchApi<{ status?: string; uptime?: number }>("/health"),
};

export const authApi = {
  settings: () => fetchApi<GatewayAuthSettings>("/auth/settings"),
  updateSettings: (payload: { requireAuthForLocalhost: boolean }) =>
    fetchApi<GatewayAuthSettings>("/auth/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  revealKey: () =>
    fetchApi<{ success: boolean; apiKey: string | null; source: "env" | "file" | "none" }>(
      "/auth/key"
    ),
  rotateKey: () =>
    fetchApi<{ success: boolean; apiKey: string }>("/auth/rotate-key", { method: "POST" }),
};

export const settingsApi = {
  getConfig: () => fetchApi<Record<string, unknown>>("/config"),
  getSandboxStatus: () =>
    fetchApi<{
      enabled: boolean;
      configuredProvider: "auto" | "apple_sandbox" | "podman" | "docker";
      network: "allow" | "deny";
      resolvedProvider: "apple_sandbox" | "podman" | "docker" | null;
      available: boolean;
      reason?: string;
      providers: Array<{
        provider: "apple_sandbox" | "podman" | "docker";
        supported: boolean;
        installed: boolean;
        available: boolean;
        reason?: string;
      }>;
      checkedAt: string;
      lastEvent: {
        phase: "prepared" | "disabled" | "error";
        provider: "apple_sandbox" | "podman" | "docker" | "host" | null;
        commandPreview?: string;
        cwd?: string;
        network?: "allow" | "deny";
        reason?: string;
        timestamp: string;
      } | null;
    }>("/sandbox/status"),
  updateConfig: (data: Record<string, unknown>) =>
    fetchApi<{ success: boolean }>("/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

export const setupApi = {
  status: () => fetchApi<{ complete: boolean }>("/setup/status"),
  complete: () => fetchApi<{ success: boolean }>("/setup/complete", { method: "POST" }),
};

export interface WalletStatus {
  exists: boolean;
  unlocked: boolean;
  address?: string;
  createdAt?: string;
  updatedAt?: string;
  unlockExpiresAt?: string;
  wordCount?: number;
  kdf?: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
  };
  agentAccessEnabled: boolean;
  chains: Array<WalletChain>;
  primaryAddresses?: Record<WalletChain, string>;
}

export type WalletChain = "eth" | "btc" | "sol";
export type WalletTokenChain = "eth" | "sol";

export interface WalletAccount {
  chain: WalletChain;
  index: number;
  path: string;
  address: string;
}

export interface WalletBalance extends WalletAccount {
  symbol: "ETH" | "BTC" | "SOL";
  decimals: number;
  amount: string;
  raw: string;
}

export interface WalletTransaction {
  chain: WalletChain;
  txid: string;
  status: "confirmed" | "pending" | "failed";
  from?: string;
  to?: string;
  amount?: string;
  fee?: string;
  confirmations?: number;
  timestamp?: string;
  explorerUrl: string;
}

export interface WalletTokenBalance {
  chain: WalletTokenChain;
  index: number;
  address: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals: number;
  amount: string;
  raw: string;
  tokenAccount?: string;
}

export interface WalletInstructionAccount {
  pubkey: string;
  isSigner?: boolean;
  isWritable?: boolean;
}

export interface WalletRpcConfig {
  ethRpc: string;
  solRpc: string;
  btcApi: string;
}

export interface WalletRpcServiceStatus {
  chain: WalletChain;
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  latestHeight?: string;
  error?: string;
}

export interface WalletRpcStatus {
  checkedAt: string;
  services: WalletRpcServiceStatus[];
}

export interface WalletTokenTransaction {
  chain: WalletTokenChain;
  index: number;
  address: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals: number;
  txid: string;
  status: "confirmed" | "pending" | "failed";
  direction: "in" | "out" | "self" | "unknown";
  from?: string;
  to?: string;
  amount: string;
  raw: string;
  fee?: string;
  timestamp?: string;
  explorerUrl: string;
}

export interface WalletAgentPolicy {
  allowNativeSend: boolean;
  allowTokenSend: boolean;
  allowEthContractWrite: boolean;
  allowSolProgramInstruction: boolean;
  allowEthSwaps: boolean;
  allowDappInteraction: boolean;
  allowX402Payments: boolean;
  allowedEthContracts: string[];
  allowedSolPrograms: string[];
  allowedDappHosts: string[];
  allowedX402Networks: string[];
  x402MaxAmountAtomic: string;
}

export interface WalletSwapEthUniswapResult {
  chain: "eth";
  dex: "uniswap_v2";
  from: string;
  toTokenAddress: string;
  toTokenSymbol: string;
  amountInEth: string;
  amountInWei: string;
  quotedAmountOut: string;
  quotedAmountOutRaw: string;
  minAmountOut: string;
  minAmountOutRaw: string;
  slippageBps: number;
  recipient: string;
  deadline: string;
  txid?: string;
  explorerUrl?: string;
  dryRun: boolean;
}

export const walletApi = {
  status: () => fetchApi<WalletStatus>("/wallet/status"),
  rpc: () => fetchApi<WalletRpcConfig>("/wallet/rpc"),
  rpcStatus: () => fetchApi<WalletRpcStatus>("/wallet/rpc/status"),
  updateRpc: (payload: { ethRpc?: string; solRpc?: string; btcApi?: string }) =>
    fetchApi<{ success: boolean; config: WalletRpcConfig }>("/wallet/rpc", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  create: (password: string) =>
    fetchApi<{
      success: boolean;
      mnemonic: string;
      address: string;
      primaryAddresses: Record<WalletChain, string>;
    }>("/wallet/create", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  importWallet: (mnemonic: string, password: string) =>
    fetchApi<{
      success: boolean;
      mnemonic: string;
      address: string;
      primaryAddresses: Record<WalletChain, string>;
    }>("/wallet/import", {
      method: "POST",
      body: JSON.stringify({ mnemonic, password }),
    }),
  unlock: (password: string) =>
    fetchApi<{
      success: boolean;
      address: string;
      primaryAddresses: Record<WalletChain, string>;
      unlockExpiresAt: string;
    }>("/wallet/unlock", { method: "POST", body: JSON.stringify({ password }) }),
  lock: () => fetchApi<{ success: boolean }>("/wallet/lock", { method: "POST" }),
  accounts: (params?: { chains?: WalletChain[]; count?: number; startIndex?: number }) => {
    const query = new URLSearchParams();
    if (params?.chains?.length) query.set("chains", params.chains.join(","));
    if (typeof params?.count === "number") query.set("count", String(params.count));
    if (typeof params?.startIndex === "number") query.set("startIndex", String(params.startIndex));
    return fetchApi<WalletAccount[]>(`/wallet/accounts${query.size ? `?${query.toString()}` : ""}`);
  },
  receive: (chain: WalletChain, index = 0) =>
    fetchApi<WalletAccount>(
      `/wallet/receive?chain=${encodeURIComponent(chain)}&index=${encodeURIComponent(index)}`
    ),
  balances: (params?: { chains?: WalletChain[]; count?: number; startIndex?: number }) => {
    const query = new URLSearchParams();
    if (params?.chains?.length) query.set("chains", params.chains.join(","));
    if (typeof params?.count === "number") query.set("count", String(params.count));
    if (typeof params?.startIndex === "number") query.set("startIndex", String(params.startIndex));
    return fetchApi<WalletBalance[]>(`/wallet/balances${query.size ? `?${query.toString()}` : ""}`);
  },
  tokenBalances: (params: { chain: WalletTokenChain; index?: number; includeZero?: boolean }) => {
    const query = new URLSearchParams();
    query.set("chain", params.chain);
    if (typeof params.index === "number") query.set("index", String(params.index));
    if (params.includeZero) query.set("includeZero", "true");
    return fetchApi<WalletTokenBalance[]>(`/wallet/tokens?${query.toString()}`);
  },
  tokenTransactions: (params: {
    chain: WalletTokenChain;
    index?: number;
    limit?: number;
    tokenAddress?: string;
    rpcUrl?: string;
  }) => {
    const query = new URLSearchParams();
    query.set("chain", params.chain);
    if (typeof params.index === "number") query.set("index", String(params.index));
    if (typeof params.limit === "number") query.set("limit", String(params.limit));
    if (params.tokenAddress) query.set("tokenAddress", params.tokenAddress);
    if (params.rpcUrl) query.set("rpcUrl", params.rpcUrl);
    return fetchApi<WalletTokenTransaction[]>(`/wallet/token-transactions?${query.toString()}`);
  },
  transactions: (params: {
    chain: WalletChain;
    index?: number;
    limit?: number;
    rpcUrl?: string;
  }) => {
    const query = new URLSearchParams();
    query.set("chain", params.chain);
    if (typeof params.index === "number") query.set("index", String(params.index));
    if (typeof params.limit === "number") query.set("limit", String(params.limit));
    if (params.rpcUrl) query.set("rpcUrl", params.rpcUrl);
    return fetchApi<WalletTransaction[]>(`/wallet/transactions?${query.toString()}`);
  },
  send: (payload: {
    chain: WalletChain;
    to: string;
    amount: string;
    index?: number;
    memo?: string;
    rpcUrl?: string;
    feeRate?: number;
  }) =>
    fetchApi<{ chain: WalletChain; txid: string; explorerUrl: string }>("/wallet/send", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendToken: (payload: {
    chain: WalletTokenChain;
    tokenAddress: string;
    to: string;
    amount: string;
    index?: number;
    decimals?: number;
    memo?: string;
    rpcUrl?: string;
  }) =>
    fetchApi<{ chain: WalletTokenChain; txid: string; explorerUrl: string; tokenAddress: string }>(
      "/wallet/send-token",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  ethContractCall: (payload: {
    contractAddress: string;
    abi?: string;
    method: string;
    methodSignature?: string;
    args?: unknown[];
    index?: number;
    value?: string;
    gasLimit?: number | string;
    gasPriceGwei?: string;
    maxFeePerGasGwei?: string;
    maxPriorityFeePerGasGwei?: string;
    nonce?: number;
    readOnly?: boolean;
    rpcUrl?: string;
  }) =>
    fetchApi<Record<string, unknown>>("/wallet/eth-contract", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  solProgramInstruction: (payload: {
    programId: string;
    keys?: WalletInstructionAccount[];
    accounts?: WalletInstructionAccount[];
    dataBase64?: string;
    dataHex?: string;
    dataUtf8?: string;
    index?: number;
    rpcUrl?: string;
    computeUnitLimit?: number;
    computeUnitPriceMicroLamports?: number;
    skipPreflight?: boolean;
  }) =>
    fetchApi<{ chain: "sol"; txid: string; explorerUrl: string }>("/wallet/sol-instruction", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  swapEthUniswap: (payload: {
    tokenOut: string;
    amountEth?: string;
    percent?: number;
    minAmountOut?: string;
    slippageBps?: number;
    deadlineSeconds?: number;
    index?: number;
    recipient?: string;
    rpcUrl?: string;
    dryRun?: boolean;
  }) =>
    fetchApi<WalletSwapEthUniswapResult>("/wallet/swap-eth-uniswap", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  priceQuote: (payload: {
    source?: "auto" | "chainlink" | "pyth" | "jupiter";
    symbol?: string;
    pair?: string;
    feedAddress?: string;
    feedId?: string;
    pythFeedId?: string;
    mint?: string;
    quoteCurrency?: string;
    rpcUrl?: string;
  }) =>
    fetchApi<{
      source: "chainlink" | "pyth" | "jupiter";
      base: string;
      quote: string;
      price: string;
      confidence?: string;
      publishTime?: string;
      feedAddress?: string;
      feedId?: string;
      mint?: string;
    }>("/wallet/price", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  swap: (payload: {
    venue: "uniswap_v2" | "uniswap_v3" | "jupiter" | "uniswap" | "jup" | string;
    tokenOut?: string;
    tokenAddress?: string;
    amountEth?: string;
    percent?: number;
    minAmountOut?: string;
    recipient?: string;
    feeTier?: number;
    inputMint?: string;
    outputMint?: string;
    amount?: string;
    amountRaw?: string;
    index?: number;
    slippageBps?: number;
    deadlineSeconds?: number;
    rpcUrl?: string;
    wrapUnwrapSol?: boolean;
    computeUnitPriceMicroLamports?: number;
    skipPreflight?: boolean;
    dryRun?: boolean;
    execute?: boolean;
    broadcast?: boolean;
  }) =>
    fetchApi<{
      venue: "uniswap_v2" | "uniswap_v3" | "jupiter";
      chain: "eth" | "sol";
      from: string;
      inputToken: string;
      outputToken: string;
      amountIn: string;
      amountInRaw: string;
      quotedAmountOut: string;
      quotedAmountOutRaw: string;
      minAmountOut: string;
      minAmountOutRaw: string;
      slippageBps: number;
      dryRun: boolean;
      route?: string;
      routePlan?: Array<{
        label?: string;
        ammKey?: string;
        inputMint?: string;
        outputMint?: string;
        inAmount?: string;
        outAmount?: string;
      }>;
      txid?: string;
      explorerUrl?: string;
    }>("/wallet/swap", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  endpoints: () =>
    fetchApi<{
      ethereum: {
        wrappedNative: string;
        dex: Record<string, string>;
        oracles: {
          chainlinkFeedRegistry: string;
          usdDenomination: string;
          chainlinkUsdFeeds: Record<string, string>;
          chainlinkBaseAssets: Record<string, string>;
        };
      };
      solana: {
        nativeMint: string;
        commonMints: Record<string, string>;
        programs: Record<string, string>;
      };
      services: Record<string, string>;
    }>("/wallet/endpoints"),
  dapps: () =>
    fetchApi<{
      adapters: Array<{ adapter: string; chain: string; write: boolean; description: string }>;
      notes: string[];
    }>("/wallet/dapps"),
  rpcCall: (payload: {
    chain: "eth" | "sol";
    method: string;
    params?: unknown[];
    rpcUrl?: string;
    id?: string | number;
  }) =>
    fetchApi<{
      chain: "eth" | "sol";
      rpcUrl: string;
      method: string;
      id?: string | number;
      result?: unknown;
      error?: unknown;
    }>("/wallet/rpc-call", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  dapp: (payload: { adapter: string; payload?: Record<string, unknown> }) =>
    fetchApi<unknown>("/wallet/dapp", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  x402: (payload: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    network?: string;
    maxAmountAtomic?: string;
    index?: number;
    timeoutMs?: number;
    dryRun?: boolean;
    parseJsonResponse?: boolean;
  }) =>
    fetchApi<{
      url: string;
      method: string;
      status: number;
      paid: boolean;
      attemptedPayment: boolean;
      paymentHeaderUsed?: string;
      paymentRequirement?: {
        x402Version: number;
        scheme: string;
        network: string;
        amount: string;
        asset: string;
        payTo: string;
        maxTimeoutSeconds: number;
        extra?: Record<string, unknown>;
      };
      settlement?: {
        success?: boolean;
        errorReason?: string;
        errorMessage?: string;
        payer?: string;
        transaction?: string;
        network?: string;
      };
      responseHeaders: Record<string, string>;
      body?: unknown;
    }>("/wallet/x402", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  signMessage: (message: string, chain: WalletChain = "eth", index = 0) =>
    fetchApi<{ address: string; signature: string }>("/wallet/sign", {
      method: "POST",
      body: JSON.stringify({ message, chain, index }),
    }),
  deleteWallet: (password?: string) =>
    fetchApi<{ success: boolean }>("/wallet", {
      method: "DELETE",
      body: password ? JSON.stringify({ password }) : undefined,
    }),
  setAgentAccess: (enabled: boolean) =>
    fetchApi<{ success: boolean; enabled: boolean }>("/wallet/agent-access", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  getAgentPolicy: () => fetchApi<WalletAgentPolicy>("/wallet/agent-policy"),
  updateAgentPolicy: (policy: Partial<WalletAgentPolicy>) =>
    fetchApi<{ success: boolean; policy: WalletAgentPolicy }>("/wallet/agent-policy", {
      method: "PUT",
      body: JSON.stringify(policy),
    }),
};

export const memoryApi = {
  list: (params?: { agentId?: string; userId?: string; search?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.agentId) query.append("agentId", params.agentId);
    if (params?.userId) query.append("userId", params.userId);
    if (params?.search) query.append("search", params.search);
    if (params?.limit) query.append("limit", params.limit.toString());
    return fetchApi<Memory[]>(`/memory?${query.toString()}`);
  },
  createFile: (file: string, content: string) =>
    fetchApi<{ success: boolean; file: string; appended?: boolean }>("/memory", {
      method: "POST",
      body: JSON.stringify({ file, content }),
    }),
  get: (id: string) => fetchApi<Memory>(`/memory/${encodeURIComponent(id)}`),
  status: () =>
    fetchApi<{
      success: boolean;
      chunks?: number;
      files?: number;
      provider?: string;
      model?: string;
      configuredProvider?: string;
      configuredModel?: string;
      fallbackReason?: string | null;
      error?: string;
    }>("/memory/status"),
  create: (memory: Omit<Memory, "id" | "createdAt" | "updatedAt">) =>
    fetchApi<Memory>("/memory", { method: "POST", body: JSON.stringify(memory) }),
  update: (id: string, memory: Partial<Memory>) =>
    fetchApi<Memory>(`/memory/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(memory),
    }),
  delete: (id: string) => fetchApi<void>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" }),
  search: (query: string, limit?: number) =>
    fetchApi<Memory[] | { results: Memory[] }>(
      `/memory/search?query=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ""}`
    ),
  providers: () =>
    fetchApi<{
      success: boolean;
      settings: Record<string, unknown>;
      providers: Array<{
        id: string;
        label: string;
        docsUrl: string;
        configured: boolean;
        active: boolean;
        fields: Array<{
          key: string;
          label: string;
          secret?: boolean;
          required?: boolean;
          placeholder?: string;
        }>;
      }>;
    }>("/memory/providers"),
  testProvider: (provider: string, settings?: Record<string, unknown>) =>
    fetchApi<{ success: boolean; provider: string; ok: boolean; detail: string }>(
      "/memory/providers/test",
      { method: "POST", body: JSON.stringify({ provider, settings }) }
    ),
};

export const tasksApi = {
  list: () => fetchApi<Task[]>("/tasks"),
  get: (id: string) => fetchApi<Task>(`/tasks/${id}`),
  getRuns: (id: string) =>
    fetchApi<
      Array<{
        id: string;
        task_id: string;
        status: "running" | "completed" | "failed";
        started_at: string;
        completed_at?: string;
        session_id?: string;
        result_preview?: string;
        error?: string;
      }>
    >(`/tasks/${id}/runs`),
  create: (task: Omit<Task, "id" | "createdAt">) =>
    fetchApi<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  update: (id: string, task: Partial<Task>) =>
    fetchApi<Task>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(task) }),
  delete: (id: string) => fetchApi<void>(`/tasks/${id}`, { method: "DELETE" }),
  run: (id: string) => fetchApi<void>(`/tasks/${id}/run`, { method: "POST" }),
};

export const skillsApi = {
  list: () => fetchApi<Skill[]>("/skills"),
  get: (id: string) => fetchApi<Skill>(`/skills/${id}`),
  create: (skill: Omit<Skill, "id" | "createdAt">) =>
    fetchApi<Skill>("/skills", { method: "POST", body: JSON.stringify(skill) }),
  update: (id: string, skill: Partial<Skill>) =>
    fetchApi<Skill>(`/skills/${id}`, { method: "PUT", body: JSON.stringify(skill) }),
  delete: (id: string) => fetchApi<void>(`/skills/${id}`, { method: "DELETE" }),
  test: (id: string, params: Record<string, unknown>) =>
    fetchApi<unknown>(`/skills/${id}/execute`, { method: "POST", body: JSON.stringify(params) }),
};

export const chatApi = {
  send: (
    message: string,
    agentId?: string,
    sessionId?: string,
    workspaceDir?: string | null,
    signal?: AbortSignal,
    queueMode?: "queue" | "steer",
    clientPendingId?: string
  ) =>
    fetchApi<{
      message: ChatMessage;
      sessionId: string;
      workspaceDir?: string | null;
      queued?: boolean;
      interrupted?: boolean;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
    }>("/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        agentId,
        sessionId,
        workspaceDir,
        queueMode,
        clientPendingId,
      }),
      signal,
    }),
  steerPendingMessage: (
    sessionId: string,
    pendingMessageId: string,
    options?: { processActivities?: ChatProcessActivityPayload }
  ) =>
    fetchApi<{
      success: boolean;
      message?: ChatMessage;
      interruptedMessage?: ChatMessage;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/${pendingMessageId}/steer`, {
      method: "POST",
      body: JSON.stringify({ processActivities: options?.processActivities || [] }),
    }),
  getPendingMessages: (sessionId: string) =>
    fetchApi<{ sessionId: string; pendingMessages: PendingChatMessage[] }>(
      `/chat/sessions/${sessionId}/pending`
    ),
  reorderPendingMessages: (sessionId: string, pendingMessageIds: string[]) =>
    fetchApi<{
      success: boolean;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/reorder`, {
      method: "POST",
      body: JSON.stringify({ pendingMessageIds }),
    }),
  updatePendingMessage: (sessionId: string, pendingMessageId: string, content: string) =>
    fetchApi<{
      success: boolean;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/${pendingMessageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  deletePendingMessage: (sessionId: string, pendingMessageId: string) =>
    fetchApi<{
      success: boolean;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/${pendingMessageId}`, {
      method: "DELETE",
    }),
  dictate: (payload: {
    audioBase64: string;
    mimeType?: string;
    fileName?: string;
    model?: string;
    providerId?: string;
  }) =>
    fetchApi<{
      success: boolean;
      text: string;
      providerId: string;
      providerType: string;
      model: string;
    }>("/speech/dictate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getSessions: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
      query.set("limit", String(Math.max(1, Math.floor(params.limit))));
    }
    if (typeof params?.offset === "number" && Number.isFinite(params.offset)) {
      query.set("offset", String(Math.max(0, Math.floor(params.offset))));
    }
    const suffix = query.toString();
    return fetchApi<
      {
        id: string;
        agent_id: string;
        title?: string | null;
        created_at: string;
        updated_at: string;
        workspace_dir?: string | null;
        pinned?: boolean;
        message_count?: number;
        last_message?: { role: string; content: string };
      }[]
    >("/sessions" + (suffix ? `?${suffix}` : ""));
  },
  getSession: (id: string, options?: { includeFullToolCalls?: boolean }) =>
    fetchApi<{
      id: string;
      agent_id: string;
      title?: string | null;
      created_at: string;
      updated_at: string;
      workspace_dir?: string | null;
      messagesList: ChatMessage[];
    }>("/sessions/" + id + (options?.includeFullToolCalls ? "?includeFullToolCalls=1" : "")),
  revertSession: (
    id: string,
    payload: {
      messageIndex?: number;
      messageRole?: ChatMessage["role"];
      messageContent?: string;
      messageTimestamp?: string;
    }
  ) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      keptCount: number;
      removedCount: number;
      removedFromIndex: number;
      messagesList: ChatMessage[];
      error?: string;
    }>("/sessions/" + id + "/revert", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSessionTitle: (id: string, title: string) =>
    fetchApi<{ success: boolean; sessionId: string; title: string; error?: string }>(
      "/sessions/" + id + "/title",
      {
        method: "PUT",
        body: JSON.stringify({ title }),
      }
    ),
  pinSession: (id: string, pinned: boolean) =>
    fetchApi<{ success: boolean; sessionId: string; pinned: boolean; error?: string }>(
      "/sessions/" + id + "/pin",
      {
        method: "PUT",
        body: JSON.stringify({ pinned }),
      }
    ),
  updateSessionWorkspace: (id: string, workspaceDir: string | null) =>
    fetchApi<{ success: boolean; sessionId: string; workspaceDir: string | null; error?: string }>(
      "/sessions/" + id + "/workspace",
      {
        method: "PUT",
        body: JSON.stringify({ workspaceDir }),
      }
    ),
  getSessionStatus: (sessionId?: string) =>
    fetchApi<{
      activeSessions?: Array<{
        sessionId: string;
        status: string;
        timestamp: number;
        detail?: string;
        agentId?: string;
        activities: Array<{
          id: string;
          phase: "start" | "result" | "error";
          text: string;
          timestamp: number;
          toolName?: string;
        }>;
      }>;
      activeSessionIds: string[];
      count?: number;
      session?: {
        sessionId: string;
        status: string;
        timestamp: number;
        detail?: string;
        agentId?: string;
        activities: Array<{
          id: string;
          phase: "start" | "result" | "error";
          text: string;
          timestamp: number;
          toolName?: string;
        }>;
      } | null;
      active?: boolean;
      sessionId?: string;
    }>("/status/sessions" + (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "")),
  listArtifacts: (sessionId?: string) =>
    fetchApi<{
      artifacts: Array<{
        sessionId: string;
        name: string;
        fileName: string;
        path: string;
        kind: "task" | "implementation" | "walkthrough" | "notes" | "custom";
        title: string;
        size: number;
        createdAt: string;
        updatedAt: string;
      }>;
      sessionId?: string;
    }>("/artifacts" + (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "")),
  readSessionArtifact: (sessionId: string, artifactName: string) =>
    fetchApi<{
      sessionId: string;
      artifact: {
        sessionId: string;
        name: string;
        fileName: string;
        path: string;
        kind: "task" | "implementation" | "walkthrough" | "notes" | "custom";
        title: string;
        size: number;
        createdAt: string;
        updatedAt: string;
      };
      content: string;
      truncated: boolean;
      totalChars: number;
    }>(`/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactName)}`),
  deleteSession: (id: string) => fetchApi<void>("/sessions/" + id, { method: "DELETE" }),
};

export const dashboardApi = {
  getStats: () => fetchApi<DashboardStats>("/dashboard/stats"),
};

export interface ComputerUseStatus {
  available: boolean;
  command: string;
  driverSource?: "env" | "config" | "path" | "known-install-dir" | "default";
  configuredCommand?: string;
  platform: string;
  version?: string;
  accessibility?: boolean;
  screenRecording?: boolean;
  ready: boolean;
  message: string;
  installHint?: string;
  searchedPaths?: string[];
}

export const computerUseApi = {
  getStatus: () => fetchApi<ComputerUseStatus>("/computer-use/status"),
  grantPermissions: () =>
    fetchApi<{ ok: boolean; message: string }>("/computer-use/permissions/grant", {
      method: "POST",
    }),
};

export interface SandboxBrowserStatus {
  dockerAvailable: boolean;
  imageBuilt: boolean;
  running: boolean;
  cdpPort: number;
  novncPort: number;
  cdpUrl: string;
  novncUrl: string;
  reason?: string;
}

export const sandboxBrowserApi = {
  getStatus: () => fetchApi<SandboxBrowserStatus>("/browser/sandbox/status"),
  start: () =>
    fetchApi<{ success: boolean; status?: SandboxBrowserStatus; error?: string }>(
      "/browser/sandbox/start",
      { method: "POST" }
    ),
  stop: () =>
    fetchApi<{ success: boolean; status?: SandboxBrowserStatus }>("/browser/sandbox/stop", {
      method: "POST",
    }),
};

export interface LogPageEntry {
  id: string;
  level: string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
}

export const logsApi = {
  getSystem: () =>
    fetchApi<{ id: string; level: string; source: string; message: string; created_at: string }[]>(
      "/logs/system"
    ),
  getPage: (limit: number, offset: number) =>
    fetchApi<{
      logs: LogPageEntry[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>(`/logs/system?includeTotal=1&limit=${limit}&offset=${offset}`),
  search: (query: string) =>
    fetchApi<{
      system: { id: string; level: string; source: string; message: string; created_at: string }[];
      sessionMessages: {
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
      }[];
      agent: { id: string; agent_id: string; action: string; created_at: string }[];
      channel: { id: string; channel_type: string; content: string; created_at: string }[];
    }>("/logs/search?q=" + encodeURIComponent(query)),
  getActivity: (minutes?: number) =>
    fetchApi<{
      system: { id: string; level: string; source: string; message: string; created_at: string }[];
      messages: {
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
      }[];
      agent: { id: string; agent_id: string; action: string; created_at: string }[];
      channel: { id: string; channel_type: string; content: string; created_at: string }[];
    }>("/logs/activity?minutes=" + (minutes || 60)),
  getStats: (hours?: number) =>
    fetchApi<{
      counts: {
        system: number;
        messages: number;
        agent: number;
        channel: number;
        cli: number;
      };
      totals: {
        system: number;
        messages: number;
        agent: number;
        channel: number;
        cli: number;
        combined: number;
      };
      hours: number;
    }>("/logs/stats?hours=" + (hours || 24)),
};

export const sessionsApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
      query.set("limit", String(Math.max(1, Math.floor(params.limit))));
    }
    if (typeof params?.offset === "number" && Number.isFinite(params.offset)) {
      query.set("offset", String(Math.max(0, Math.floor(params.offset))));
    }
    const suffix = query.toString();
    return fetchApi<
      {
        id: string;
        agent_id: string;
        created_at: string;
        updated_at: string;
        workspace_dir?: string | null;
        pinned?: boolean;
        message_count?: number;
        last_message?: { role: string; content: string };
      }[]
    >("/sessions" + (suffix ? `?${suffix}` : ""));
  },
  get: (id: string, options?: { includeFullToolCalls?: boolean }) =>
    fetchApi<{
      id: string;
      agent_id: string;
      messages?: string;
      created_at: string;
      updated_at: string;
      workspace_dir?: string | null;
      messagesList: ChatMessage[];
    }>("/sessions/" + id + (options?.includeFullToolCalls ? "?includeFullToolCalls=1" : "")),
  delete: (id: string) => fetchApi<void>("/sessions/" + id, { method: "DELETE" }),
};

export const subagentApi = {
  spawn: (task: string, options?: { model?: string; timeout?: number; label?: string }) =>
    fetchApi<{ subagentId: string; status: string }>("/subagents/spawn", {
      method: "POST",
      body: JSON.stringify({ task, ...options }),
    }),
  list: () =>
    fetchApi<{ id: string; label: string; status: string; createdAt: string }[]>("/subagents"),
  get: (id: string) =>
    fetchApi<{ id: string; label: string; status: string; result?: unknown }>(`/subagents/${id}`),
  kill: (id: string) => fetchApi<void>(`/subagents/${id}/kill`, { method: "POST" }),
};
