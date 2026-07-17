import { fetchApi } from "@/lib/api-client";

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
  allowedSendRecipients: string[];
  maxSendAmount: string;
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
    }>("/wallet/unlock", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  revealSeed: (password: string, acknowledgement: string) =>
    fetchApi<{ mnemonic: string; wordCount: number }>("/wallet/seed", {
      method: "POST",
      body: JSON.stringify({ password, acknowledgement }),
    }),
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
    fetchApi<{
      chain: WalletTokenChain;
      txid: string;
      explorerUrl: string;
      tokenAddress: string;
    }>("/wallet/send-token", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
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
      adapters: Array<{
        adapter: string;
        chain: string;
        write: boolean;
        description: string;
      }>;
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
