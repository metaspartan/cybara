export type WalletChain = "eth" | "btc" | "sol";
export const SUPPORTED_CHAINS: WalletChain[] = ["eth", "btc", "sol"];
export type WalletTokenChain = "eth" | "sol";
export const SUPPORTED_TOKEN_CHAINS: WalletTokenChain[] = ["eth", "sol"];

export interface WalletVault {
  version: 1;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
  };
  ciphertext: string;
  address?: string;
  primaryAddresses: Record<WalletChain, string>;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UnlockedWalletState {
  mnemonic: string;
  primaryAddresses: Record<WalletChain, string>;
  expiresAtMs: number;
}

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

export interface WalletSendInput {
  chain: WalletChain;
  to: string;
  amount: string;
  index?: number;
  memo?: string;
  rpcUrl?: string;
  feeRate?: number;
}

export interface WalletSendResult {
  chain: WalletChain;
  txid: string;
  explorerUrl: string;
}

export interface AccountsQuery {
  chains?: WalletChain[];
  count?: number;
  startIndex?: number;
}

export interface TransactionsQuery {
  chain: WalletChain;
  index?: number;
  limit?: number;
  rpcUrl?: string;
}

export interface TokenBalancesQuery {
  chain: WalletTokenChain;
  index?: number;
  includeZero?: boolean;
}

export interface TokenTransactionsQuery {
  chain: WalletTokenChain;
  index?: number;
  limit?: number;
  tokenAddress?: string;
  rpcUrl?: string;
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

export type WalletDappAdapter =
  "rpc_call" | "eth_contract_call" | "sol_program_instruction" | "swap" | "price" | "x402_http";

export interface WalletRpcCallInput {
  chain: "eth" | "sol";
  method: string;
  params?: unknown[];
  rpcUrl?: string;
  id?: string | number;
}

export interface WalletRpcCallResult {
  chain: "eth" | "sol";
  rpcUrl: string;
  method: string;
  id?: string | number;
  result?: unknown;
  error?: unknown;
}

export interface WalletDappCallInput {
  adapter: WalletDappAdapter | string;
  payload?: Record<string, unknown>;
}

export interface WalletDappAdapterCapability {
  adapter: WalletDappAdapter;
  chain: "eth" | "sol" | "multi";
  write: boolean;
  description: string;
}

export interface WalletDappDirectory {
  adapters: WalletDappAdapterCapability[];
  notes: string[];
}

export interface WalletX402RequestInput {
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
}

export interface WalletX402RequirementV2 {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface WalletX402PaymentRequiredV2 {
  x402Version: 2;
  error?: string;
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
  };
  accepts: WalletX402RequirementV2[];
  extensions?: Record<string, unknown>;
}

export interface WalletX402RequirementV1 {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface WalletX402PaymentRequiredV1 {
  x402Version: 1;
  error?: string;
  accepts: WalletX402RequirementV1[];
}

export interface WalletX402SettlementResponse {
  success?: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction?: string;
  network?: string;
}

export interface WalletX402RequestResult {
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
  settlement?: WalletX402SettlementResponse;
  responseHeaders: Record<string, string>;
  body?: unknown;
}

export interface WalletX402SelectedRequirement {
  x402Version: 1 | 2;
  scheme: string;
  network: string;
  networkFamily: "evm" | "solana";
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
  };
  extensions?: Record<string, unknown>;
}

export interface WalletSwapEthUniswapInput {
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

export type WalletPriceSource = "auto" | "chainlink" | "pyth" | "jupiter";

export interface WalletPriceQuoteInput {
  source?: WalletPriceSource;
  symbol?: string;
  pair?: string;
  feedAddress?: string;
  pythFeedId?: string;
  mint?: string;
  quoteCurrency?: string;
  rpcUrl?: string;
}

export interface WalletPriceQuoteResult {
  source: "chainlink" | "pyth" | "jupiter";
  base: string;
  quote: string;
  price: string;
  confidence?: string;
  publishTime?: string;
  feedAddress?: string;
  feedId?: string;
  mint?: string;
}

export type WalletSwapVenue = "uniswap_v2" | "uniswap_v3" | "jupiter";

export interface WalletSwapInput {
  venue: WalletSwapVenue | string;
  tokenOut?: string;
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
  dryRun?: boolean;
  wrapUnwrapSol?: boolean;
  computeUnitPriceMicroLamports?: number;
  skipPreflight?: boolean;
}

export interface WalletSwapResult {
  venue: WalletSwapVenue;
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
}

export interface WalletEndpointDirectory {
  ethereum: {
    wrappedNative: string;
    dex: {
      uniswapV2Router: string;
      uniswapV3Router02: string;
      uniswapV3QuoterV2: string;
      uniswapV3QuoterLegacy: string;
      uniswapUniversalRouter: string;
      permit2: string;
    };
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
    programs: {
      systemProgram: string;
      tokenProgram: string;
      token2022Program: string;
      associatedTokenProgram: string;
      memoProgram: string;
    };
  };
  services: {
    pythHermes: string;
    jupiterPriceApi: string;
    jupiterSwapApi: string;
    jupiterProgramLabelsApi: string;
  };
}

export interface WalletSendTokenInput {
  chain: WalletTokenChain;
  tokenAddress: string;
  to: string;
  amount: string;
  index?: number;
  decimals?: number;
  rpcUrl?: string;
  memo?: string;
}

export interface EthContractCallInput {
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
}

export interface SolInstructionAccountMeta {
  pubkey: string;
  isSigner?: boolean;
  isWritable?: boolean;
}

export interface SolProgramInstructionInput {
  programId: string;
  keys?: SolInstructionAccountMeta[];
  accounts?: SolInstructionAccountMeta[];
  dataBase64?: string;
  dataHex?: string;
  dataUtf8?: string;
  index?: number;
  rpcUrl?: string;
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: number;
  skipPreflight?: boolean;
}

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
  chains: WalletChain[];
  primaryAddresses?: Record<WalletChain, string>;
}

export interface BtcUtxo {
  txid: string;
  vout: number;
  value: number;
}

export type AesKeyUsage = "encrypt" | "decrypt";
