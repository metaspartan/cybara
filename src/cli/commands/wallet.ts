import { getFlagValue } from "./args";

export type CliWalletAuthHeaders = (
  headers?: RequestInit["headers"],
  ensureJsonContentType?: boolean
) => Headers;

export interface CliWalletContext {
  apiBase: string;
  withAuthHeaders: CliWalletAuthHeaders;
}

let walletContext: CliWalletContext | null = null;

export function configureWalletCli(context: CliWalletContext): void {
  walletContext = context;
}

function getWalletContext(): CliWalletContext {
  if (!walletContext) {
    throw new Error("Wallet CLI is not configured");
  }
  return walletContext;
}

interface CliWalletStatus {
  exists: boolean;
  unlocked: boolean;
  address?: string;
  unlockExpiresAt?: string;
  agentAccessEnabled: boolean;
  chains: string[];
  primaryAddresses?: Record<string, string>;
}

interface CliWalletAccount {
  chain: string;
  index: number;
  path: string;
  address: string;
}

interface CliWalletBalance extends CliWalletAccount {
  symbol: string;
  amount: string;
}

interface CliWalletTokenBalance {
  chain: "eth" | "sol";
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

interface CliWalletTransaction {
  txid: string;
  status: string;
  amount?: string;
  fee?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  explorerUrl: string;
}

interface CliWalletRpc {
  ethRpc: string;
  solRpc: string;
  btcApi: string;
}

interface CliWalletRpcServiceStatus {
  chain: "eth" | "btc" | "sol";
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  latestHeight?: string;
  error?: string;
}

interface CliWalletRpcStatus {
  checkedAt: string;
  services: CliWalletRpcServiceStatus[];
}

interface CliWalletTokenTransaction {
  chain: "eth" | "sol";
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

interface CliWalletAgentPolicy {
  allowNativeSend: boolean;
  allowTokenSend: boolean;
  allowEthContractWrite: boolean;
  allowSolProgramInstruction: boolean;
  allowEthSwaps: boolean;
  allowSolSwaps: boolean;
  allowDappInteraction: boolean;
  allowX402Payments: boolean;
  allowedEthContracts: string[];
  allowedSolPrograms: string[];
  allowedDappHosts: string[];
  allowedX402Networks: string[];
  x402MaxAmountAtomic: string;
}

function formatWalletTimestamp(value?: string): string {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

async function walletRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const context = getWalletContext();
  const response = await fetch(`${context.apiBase}${path}`, {
    method,
    headers: context.withAuthHeaders(undefined, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: string }).error || response.statusText)
        : response.statusText;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function rawWalletStatus(): Promise<void> {
  const [status, rpc, policy] = await Promise.all([
    walletRequest<CliWalletStatus>("GET", "/api/wallet/status"),
    walletRequest<CliWalletRpc>("GET", "/api/wallet/rpc"),
    walletRequest<CliWalletAgentPolicy>("GET", "/api/wallet/agent-policy"),
  ]);

  console.log("CYBARA WALLET");
  console.log("=============");
  console.log(`exists: ${status.exists ? "yes" : "no"}`);
  console.log(`unlocked: ${status.unlocked ? "yes" : "no"}`);
  console.log(`agent_access: ${status.agentAccessEnabled ? "enabled" : "disabled"}`);
  console.log(`agent_native_send: ${policy.allowNativeSend ? "enabled" : "disabled"}`);
  console.log(`agent_token_send: ${policy.allowTokenSend ? "enabled" : "disabled"}`);
  console.log(`agent_eth_swaps: ${policy.allowEthSwaps ? "enabled" : "disabled"}`);
  console.log(`agent_sol_swaps: ${policy.allowSolSwaps ? "enabled" : "disabled"}`);
  console.log(`agent_dapp: ${policy.allowDappInteraction ? "enabled" : "disabled"}`);
  console.log(`agent_x402: ${policy.allowX402Payments ? "enabled" : "disabled"}`);
  console.log(`unlock_expires: ${formatWalletTimestamp(status.unlockExpiresAt)}`);
  if (status.address) {
    console.log(`primary_eth: ${status.address}`);
  }

  const addresses = status.primaryAddresses || {};
  if (Object.keys(addresses).length > 0) {
    console.log("");
    console.log("PRIMARY ADDRESSES");
    for (const [chain, address] of Object.entries(addresses)) {
      console.log(`  ${chain}: ${address}`);
    }
  }

  console.log("");
  console.log("RPC ENDPOINTS");
  console.log(`  eth: ${rpc.ethRpc}`);
  console.log(`  sol: ${rpc.solRpc}`);
  console.log(`  btc: ${rpc.btcApi}`);
}

export async function rawWalletCreate(password?: string): Promise<void> {
  if (!password) {
    console.error("Usage: cybara wallet create --password <password>");
    process.exit(1);
  }

  const data = await walletRequest<{
    address: string;
    mnemonic: string;
    primaryAddresses: Record<string, string>;
  }>("POST", "/api/wallet/create", { password });

  console.log("Wallet created and unlocked");
  console.log(`eth address: ${data.address}`);
  console.log("seed phrase:");
  console.log(data.mnemonic);
  console.log("");
  console.log("Store this seed phrase offline. It is not recoverable from your password.");
}

export async function rawWalletImport(password?: string, mnemonic?: string): Promise<void> {
  if (!password || !mnemonic) {
    console.error('Usage: cybara wallet import --password <password> --mnemonic "<24 words>"');
    process.exit(1);
  }

  const data = await walletRequest<{ address: string }>("POST", "/api/wallet/import", {
    password,
    mnemonic,
  });
  console.log("Wallet imported and unlocked");
  console.log(`eth address: ${data.address}`);
}

export async function rawWalletUnlock(password?: string): Promise<void> {
  if (!password) {
    console.error("Usage: cybara wallet unlock --password <password>");
    process.exit(1);
  }

  const data = await walletRequest<{ address: string; unlockExpiresAt: string }>(
    "POST",
    "/api/wallet/unlock",
    { password }
  );
  console.log("Wallet unlocked");
  console.log(`eth address: ${data.address}`);
  console.log(`expires: ${formatWalletTimestamp(data.unlockExpiresAt)}`);
}

export async function rawWalletRevealSeed(password?: string, confirmation?: string): Promise<void> {
  if (!password || confirmation !== "REVEAL") {
    console.error("Usage: cybara wallet reveal-seed --password <password> --confirm REVEAL");
    process.exit(1);
  }
  const data = await walletRequest<{ mnemonic: string; wordCount: number }>(
    "POST",
    "/api/wallet/seed",
    { password, acknowledgement: confirmation }
  );
  console.log(`${data.wordCount}-word seed phrase:`);
  console.log(data.mnemonic);
  console.log("");
  console.log("Store it offline and clear this terminal after recording it.");
}

export async function rawWalletLock(): Promise<void> {
  await walletRequest<{ success: boolean }>("POST", "/api/wallet/lock");
  console.log("Wallet locked");
}

export async function rawWalletAccounts(
  chains: string | undefined,
  count: string | undefined,
  start: string | undefined
): Promise<void> {
  const params = new URLSearchParams();
  if (chains) params.set("chains", chains);
  if (count) params.set("count", count);
  if (start) params.set("startIndex", start);

  const path = `/api/wallet/accounts${params.size ? `?${params.toString()}` : ""}`;
  const data = await walletRequest<CliWalletAccount[]>("GET", path);

  console.log("WALLET ACCOUNTS");
  console.log("===============");
  if (!data.length) {
    console.log("No accounts derived");
    return;
  }

  for (const account of data) {
    console.log(`- ${account.chain.toUpperCase()} index ${account.index}`);
    console.log(`  address: ${account.address}`);
    console.log(`  path: ${account.path}`);
  }
}

export async function rawWalletBalances(
  chains: string | undefined,
  count: string | undefined,
  start: string | undefined
): Promise<void> {
  const params = new URLSearchParams();
  if (chains) params.set("chains", chains);
  if (count) params.set("count", count);
  if (start) params.set("startIndex", start);

  const path = `/api/wallet/balances${params.size ? `?${params.toString()}` : ""}`;
  const data = await walletRequest<CliWalletBalance[]>("GET", path);

  console.log("WALLET BALANCES");
  console.log("===============");
  if (!data.length) {
    console.log("No balances returned");
    return;
  }

  for (const balance of data) {
    console.log(`- ${balance.chain.toUpperCase()} index ${balance.index}`);
    console.log(`  address: ${balance.address}`);
    console.log(`  balance: ${balance.amount} ${balance.symbol}`);
  }
}

export async function rawWalletTokenBalances(
  chain: string,
  index?: string,
  includeZero = false
): Promise<void> {
  if (chain !== "eth" && chain !== "sol") {
    console.error("Usage: cybara wallet tokens <eth|sol> [--index N] [--include-zero]");
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);
  if (includeZero) params.set("includeZero", "true");

  const data = await walletRequest<CliWalletTokenBalance[]>(
    "GET",
    `/api/wallet/tokens?${params.toString()}`
  );

  console.log(`WALLET TOKENS (${chain.toUpperCase()})`);
  console.log("========================");
  if (!data.length) {
    console.log("No token balances found");
    return;
  }

  for (const token of data) {
    console.log(`- ${token.symbol}${token.name ? ` (${token.name})` : ""}`);
    console.log(`  owner: ${token.address}`);
    console.log(`  token: ${token.tokenAddress}`);
    if (token.tokenAccount) console.log(`  account: ${token.tokenAccount}`);
    console.log(`  amount: ${token.amount}`);
  }
}

export async function rawWalletTransactions(
  chain: string,
  index?: string,
  limit?: string
): Promise<void> {
  if (!chain) {
    console.error("Usage: cybara wallet tx <eth|btc|sol> [--index N] [--limit N]");
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);
  if (limit) params.set("limit", limit);

  const data = await walletRequest<CliWalletTransaction[]>(
    "GET",
    `/api/wallet/transactions?${params.toString()}`
  );

  console.log(`WALLET TRANSACTIONS (${chain.toUpperCase()})`);
  console.log("================================");
  if (!data.length) {
    console.log("No transactions found");
    return;
  }

  for (const tx of data) {
    console.log(`- ${tx.txid}`);
    console.log(`  status: ${tx.status}`);
    if (tx.amount) console.log(`  amount: ${tx.amount}`);
    if (tx.fee) console.log(`  fee: ${tx.fee}`);
    if (tx.from) console.log(`  from: ${tx.from}`);
    if (tx.to) console.log(`  to: ${tx.to}`);
    if (tx.timestamp) console.log(`  timestamp: ${tx.timestamp}`);
    console.log(`  explorer: ${tx.explorerUrl}`);
  }
}

export async function rawWalletTokenTransactions(
  chain: string,
  index?: string,
  limit?: string,
  tokenAddress?: string,
  rpcUrl?: string
): Promise<void> {
  if (chain !== "eth" && chain !== "sol") {
    console.error(
      "Usage: cybara wallet token-tx <eth|sol> [--index N] [--limit N] [--token ADDRESS] [--rpc URL]"
    );
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);
  if (limit) params.set("limit", limit);
  if (tokenAddress) params.set("tokenAddress", tokenAddress);
  if (rpcUrl) params.set("rpcUrl", rpcUrl);

  const data = await walletRequest<CliWalletTokenTransaction[]>(
    "GET",
    `/api/wallet/token-transactions?${params.toString()}`
  );

  console.log(`WALLET TOKEN TRANSACTIONS (${chain.toUpperCase()})`);
  console.log("===================================");
  if (!data.length) {
    console.log("No token transactions found");
    return;
  }

  for (const tx of data) {
    console.log(`- ${tx.txid}`);
    console.log(`  token: ${tx.symbol} (${tx.tokenAddress})`);
    console.log(`  direction: ${tx.direction}`);
    console.log(`  amount: ${tx.amount}`);
    console.log(`  status: ${tx.status}`);
    if (tx.fee) console.log(`  fee: ${tx.fee}`);
    if (tx.timestamp) console.log(`  timestamp: ${tx.timestamp}`);
    console.log(`  explorer: ${tx.explorerUrl}`);
  }
}

export async function rawWalletReceive(chain: string, index?: string): Promise<void> {
  if (!chain) {
    console.error("Usage: cybara wallet receive <eth|btc|sol> [--index N]");
    process.exit(1);
  }

  const params = new URLSearchParams({ chain });
  if (index) params.set("index", index);

  const data = await walletRequest<CliWalletAccount>(
    "GET",
    `/api/wallet/receive?${params.toString()}`
  );
  console.log("WALLET RECEIVE ADDRESS");
  console.log("======================");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`index: ${data.index}`);
  console.log(`address: ${data.address}`);
  console.log(`path: ${data.path}`);
}

export async function rawWalletSend(args: string[]): Promise<void> {
  const chain = args[0];
  const to = getFlagValue(args, "--to");
  const amount = getFlagValue(args, "--amount");
  const index = getFlagValue(args, "--index");
  const memo = getFlagValue(args, "--memo");
  const feeRate = getFlagValue(args, "--fee-rate");

  if (!chain || !to || !amount) {
    console.error(
      "Usage: cybara wallet send <eth|btc|sol> --to <address> --amount <value> [--index N] [--memo TEXT] [--fee-rate SAT_PER_VB]"
    );
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    chain,
    to,
    amount,
  };
  if (index) payload.index = Number(index);
  if (memo) payload.memo = memo;
  if (feeRate) payload.feeRate = Number(feeRate);

  const data = await walletRequest<{ chain: string; txid: string; explorerUrl: string }>(
    "POST",
    "/api/wallet/send",
    payload
  );

  console.log("Transaction submitted");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`txid: ${data.txid}`);
  console.log(`explorer: ${data.explorerUrl}`);
}

export async function rawWalletSendToken(args: string[]): Promise<void> {
  const chain = args[0];
  const to = getFlagValue(args, "--to");
  const amount = getFlagValue(args, "--amount");
  const tokenAddress = getFlagValue(args, "--token") || getFlagValue(args, "--mint");
  const index = getFlagValue(args, "--index");
  const decimals = getFlagValue(args, "--decimals");
  const rpcUrl = getFlagValue(args, "--rpc");
  const memo = getFlagValue(args, "--memo");

  if ((chain !== "eth" && chain !== "sol") || !tokenAddress || !to || !amount) {
    console.error(
      "Usage: cybara wallet send-token <eth|sol> --token <address|mint> --to <address> --amount <value> [--index N] [--decimals N] [--rpc URL] [--memo TEXT]"
    );
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    chain,
    tokenAddress,
    to,
    amount,
  };
  if (index) payload.index = Number(index);
  if (decimals) payload.decimals = Number(decimals);
  if (rpcUrl) payload.rpcUrl = rpcUrl;
  if (memo) payload.memo = memo;

  const data = await walletRequest<{
    chain: string;
    txid: string;
    explorerUrl: string;
    tokenAddress: string;
  }>("POST", "/api/wallet/send-token", payload);

  console.log("Token transaction submitted");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`token: ${data.tokenAddress}`);
  console.log(`txid: ${data.txid}`);
  console.log(`explorer: ${data.explorerUrl}`);
}

export async function rawWalletEthContractCall(args: string[]): Promise<void> {
  const contractAddress = getFlagValue(args, "--contract");
  const abi = getFlagValue(args, "--abi");
  const method = getFlagValue(args, "--method");
  const methodSignature =
    getFlagValue(args, "--signature") || getFlagValue(args, "--method-signature");
  const argsJson = getFlagValue(args, "--args");
  const value = getFlagValue(args, "--value");
  const gasLimit = getFlagValue(args, "--gas-limit");
  const gasPriceGwei = getFlagValue(args, "--gas-price-gwei");
  const maxFeePerGasGwei = getFlagValue(args, "--max-fee-gwei");
  const maxPriorityFeePerGasGwei = getFlagValue(args, "--priority-fee-gwei");
  const nonce = getFlagValue(args, "--nonce");
  const index = getFlagValue(args, "--index");
  const rpcUrl = getFlagValue(args, "--rpc");
  const readOnly = args.includes("--read");

  if (!contractAddress || (!method && !methodSignature) || (!abi && !methodSignature)) {
    console.error(
      "Usage: cybara wallet contract-call --contract <address> (--abi '<json_or_signature>' | --signature '<name(types)>') [--method <name>] [--args '[...]'] [--value ETH] [--gas-limit N] [--gas-price-gwei N] [--max-fee-gwei N] [--priority-fee-gwei N] [--nonce N] [--index N] [--rpc URL] [--read]"
    );
    process.exit(1);
  }

  let parsedArgs: unknown[] = [];
  if (argsJson) {
    try {
      const parsed = JSON.parse(argsJson);
      if (!Array.isArray(parsed)) {
        throw new Error("args must be a JSON array");
      }
      parsedArgs = parsed;
    } catch (error) {
      console.error(`Invalid --args JSON: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  const payload: Record<string, unknown> = {
    contractAddress,
    method: method || methodSignature,
    args: parsedArgs,
    readOnly,
  };
  if (abi) payload.abi = abi;
  if (methodSignature) payload.methodSignature = methodSignature;
  if (value) payload.value = value;
  if (gasLimit) payload.gasLimit = gasLimit;
  if (gasPriceGwei) payload.gasPriceGwei = gasPriceGwei;
  if (maxFeePerGasGwei) payload.maxFeePerGasGwei = maxFeePerGasGwei;
  if (maxPriorityFeePerGasGwei) payload.maxPriorityFeePerGasGwei = maxPriorityFeePerGasGwei;
  if (nonce) payload.nonce = Number(nonce);
  if (index) payload.index = Number(index);
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<Record<string, unknown>>(
    "POST",
    "/api/wallet/eth-contract",
    payload
  );
  console.log("ETH contract call result");
  console.log(JSON.stringify(data, null, 2));
}

export async function rawWalletSolInstruction(args: string[]): Promise<void> {
  const programId = getFlagValue(args, "--program");
  const keysJson = getFlagValue(args, "--keys") || getFlagValue(args, "--accounts");
  const dataBase64 = getFlagValue(args, "--data-base64");
  const dataHex = getFlagValue(args, "--data-hex");
  const dataUtf8 = getFlagValue(args, "--data-utf8");
  const computeUnits = getFlagValue(args, "--compute-units");
  const computePriceMicroLamports = getFlagValue(args, "--compute-price-microlamports");
  const index = getFlagValue(args, "--index");
  const rpcUrl = getFlagValue(args, "--rpc");
  const skipPreflight = args.includes("--skip-preflight");

  if (!programId || !keysJson) {
    console.error(
      "Usage: cybara wallet sol-instruction --program <programId> (--keys '[...]' | --accounts '[...]') [--data-base64 DATA | --data-hex HEX | --data-utf8 TEXT] [--compute-units N] [--compute-price-microlamports N] [--skip-preflight] [--index N] [--rpc URL]"
    );
    process.exit(1);
  }

  const dataEncodings = [dataBase64, dataHex, dataUtf8].filter((value) => Boolean(value));
  if (dataEncodings.length > 1) {
    console.error(
      "Use only one instruction data encoding: --data-base64, --data-hex, or --data-utf8"
    );
    process.exit(1);
  }

  let keys: unknown[] = [];
  try {
    const parsed = JSON.parse(keysJson);
    if (!Array.isArray(parsed)) {
      throw new Error("keys must be a JSON array");
    }
    keys = parsed;
  } catch (error) {
    console.error(`Invalid --keys JSON: ${(error as Error).message}`);
    process.exit(1);
  }

  const payload: Record<string, unknown> = { programId, keys };
  if (dataBase64) payload.dataBase64 = dataBase64;
  if (dataHex) payload.dataHex = dataHex;
  if (dataUtf8) payload.dataUtf8 = dataUtf8;
  if (computeUnits) payload.computeUnitLimit = Number(computeUnits);
  if (computePriceMicroLamports)
    payload.computeUnitPriceMicroLamports = Number(computePriceMicroLamports);
  if (skipPreflight) payload.skipPreflight = true;
  if (index) payload.index = Number(index);
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<{ chain: string; txid: string; explorerUrl: string }>(
    "POST",
    "/api/wallet/sol-instruction",
    payload
  );

  console.log("Solana instruction submitted");
  console.log(`txid: ${data.txid}`);
  console.log(`explorer: ${data.explorerUrl}`);
}

export async function rawWalletSwapEthUniswap(args: string[]): Promise<void> {
  const tokenOut = getFlagValue(args, "--token") || getFlagValue(args, "--token-out");
  const percent = getFlagValue(args, "--percent");
  const amountEth = getFlagValue(args, "--amount-eth");
  const minAmountOut = getFlagValue(args, "--min-out");
  const slippageBps = getFlagValue(args, "--slippage-bps");
  const deadlineSeconds = getFlagValue(args, "--deadline");
  const index = getFlagValue(args, "--index");
  const recipient = getFlagValue(args, "--recipient");
  const rpcUrl = getFlagValue(args, "--rpc");
  const execute = args.includes("--execute");

  if (!tokenOut || (!percent && !amountEth)) {
    console.error(
      "Usage: cybara wallet swap-eth-uniswap --token <symbol|address> (--percent N | --amount-eth ETH) [--slippage-bps N] [--deadline SEC] [--index N] [--recipient ADDRESS] [--rpc URL] [--execute]"
    );
    process.exit(1);
  }

  if (percent && amountEth) {
    console.error("Use either --percent or --amount-eth, not both");
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    tokenOut,
    dryRun: !execute,
  };
  if (percent) payload.percent = Number(percent);
  if (amountEth) payload.amountEth = amountEth;
  if (minAmountOut) payload.minAmountOut = minAmountOut;
  if (slippageBps) payload.slippageBps = Number(slippageBps);
  if (deadlineSeconds) payload.deadlineSeconds = Number(deadlineSeconds);
  if (index) payload.index = Number(index);
  if (recipient) payload.recipient = recipient;
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<{
    amountInEth: string;
    toTokenSymbol: string;
    quotedAmountOut: string;
    minAmountOut: string;
    txid?: string;
    explorerUrl?: string;
    dryRun: boolean;
  }>("POST", "/api/wallet/swap-eth-uniswap", payload);

  console.log("UNISWAP ETH SWAP");
  console.log("================");
  console.log(`mode: ${data.dryRun ? "quote-only" : "execute"}`);
  console.log(`input_eth: ${data.amountInEth}`);
  console.log(`token_out: ${data.toTokenSymbol}`);
  console.log(`quote_out: ${data.quotedAmountOut}`);
  console.log(`min_out: ${data.minAmountOut}`);
  if (data.txid) console.log(`txid: ${data.txid}`);
  if (data.explorerUrl) console.log(`explorer: ${data.explorerUrl}`);
}

export async function rawWalletPrice(args: string[]): Promise<void> {
  const source = getFlagValue(args, "--source");
  let symbol = getFlagValue(args, "--symbol");
  let pair = getFlagValue(args, "--pair");
  const feedAddress = getFlagValue(args, "--feed-address");
  const feedId = getFlagValue(args, "--feed-id") || getFlagValue(args, "--pyth-feed-id");
  let mint = getFlagValue(args, "--mint");
  const quoteCurrency = getFlagValue(args, "--quote");
  const rpcUrl = getFlagValue(args, "--rpc");
  const positional = args[0] && !args[0].startsWith("--") ? args[0] : undefined;

  if (!symbol && !pair && !mint && positional) {
    if (positional.includes("/")) {
      pair = positional;
    } else if (positional.length >= 32) {
      mint = positional;
    } else {
      symbol = positional;
    }
  }

  if (!symbol && !pair && !mint) {
    console.error(
      "Usage: cybara wallet price [BTC|BTC/USD|<SOL_MINT>] [--source auto|chainlink|pyth|jupiter] [--symbol SYMBOL | --pair BASE/QUOTE | --mint SOL_MINT] [--feed-address ADDR] [--feed-id ID] [--quote USD] [--rpc URL]"
    );
    process.exit(1);
  }

  const payload: Record<string, unknown> = {};
  if (source) payload.source = source;
  if (symbol) payload.symbol = symbol;
  if (pair) payload.pair = pair;
  if (feedAddress) payload.feedAddress = feedAddress;
  if (feedId) payload.feedId = feedId;
  if (mint) payload.mint = mint;
  if (quoteCurrency) payload.quoteCurrency = quoteCurrency;
  if (rpcUrl) payload.rpcUrl = rpcUrl;

  const data = await walletRequest<{
    source: string;
    base: string;
    quote: string;
    price: string;
    confidence?: string;
    publishTime?: string;
    feedAddress?: string;
    feedId?: string;
    mint?: string;
  }>("POST", "/api/wallet/price", payload);

  console.log("PRICE QUOTE");
  console.log("===========");
  console.log(`source: ${data.source}`);
  console.log(`pair: ${data.base}/${data.quote}`);
  console.log(`price: ${data.price}`);
  if (data.confidence) console.log(`confidence: ${data.confidence}`);
  if (data.publishTime) console.log(`publish_time: ${data.publishTime}`);
  if (data.feedAddress) console.log(`feed_address: ${data.feedAddress}`);
  if (data.feedId) console.log(`feed_id: ${data.feedId}`);
  if (data.mint) console.log(`mint: ${data.mint}`);
}

export async function rawWalletEndpoints(): Promise<void> {
  const data = await walletRequest<{
    ethereum: {
      wrappedNative: string;
      dex: Record<string, string>;
      oracles: {
        chainlinkFeedRegistry: string;
        usdDenomination: string;
        chainlinkUsdFeeds: Record<string, string>;
      };
    };
    solana: {
      nativeMint: string;
      commonMints: Record<string, string>;
      programs: Record<string, string>;
    };
    services: Record<string, string>;
  }>("GET", "/api/wallet/endpoints");

  console.log("WALLET ENDPOINT DIRECTORY");
  console.log("=========================");
  console.log("Ethereum:");
  console.log(`  wrapped_native: ${data.ethereum.wrappedNative}`);
  for (const [key, value] of Object.entries(data.ethereum.dex || {})) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`  chainlink_feed_registry: ${data.ethereum.oracles.chainlinkFeedRegistry}`);
  console.log(`  chainlink_usd_denomination: ${data.ethereum.oracles.usdDenomination}`);
  for (const [symbol, address] of Object.entries(data.ethereum.oracles.chainlinkUsdFeeds || {})) {
    console.log(`  chainlink_${symbol.toLowerCase()}_usd: ${address}`);
  }
  console.log("Solana:");
  console.log(`  native_mint: ${data.solana.nativeMint}`);
  for (const [symbol, mint] of Object.entries(data.solana.commonMints || {})) {
    console.log(`  mint_${symbol.toLowerCase()}: ${mint}`);
  }
  for (const [key, value] of Object.entries(data.solana.programs || {})) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("Services:");
  for (const [key, value] of Object.entries(data.services || {})) {
    console.log(`  ${key}: ${value}`);
  }
}

export async function rawWalletDapps(): Promise<void> {
  const data = await walletRequest<{
    adapters: Array<{ adapter: string; chain: string; write: boolean; description: string }>;
    notes: string[];
  }>("GET", "/api/wallet/dapps");

  console.log("WALLET DAPP ADAPTERS");
  console.log("====================");
  for (const adapter of data.adapters || []) {
    console.log(`- ${adapter.adapter}`);
    console.log(`  chain: ${adapter.chain}`);
    console.log(`  write: ${adapter.write ? "yes" : "no"}`);
    console.log(`  ${adapter.description}`);
  }
  if (Array.isArray(data.notes) && data.notes.length > 0) {
    console.log("");
    console.log("notes:");
    for (const note of data.notes) {
      console.log(`- ${note}`);
    }
  }
}

export async function rawWalletRpcCall(args: string[]): Promise<void> {
  const chain = args[0];
  const methodFlag = getFlagValue(args, "--method");
  const positionalMethod = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const method = methodFlag || positionalMethod;
  const paramsJson = getFlagValue(args, "--params");
  const rpcUrl = getFlagValue(args, "--rpc");
  const id = getFlagValue(args, "--id");

  if ((chain !== "eth" && chain !== "sol") || !method) {
    console.error(
      "Usage: cybara wallet rpc-call <eth|sol> --method <rpc_method> [--params '[...]'] [--rpc URL] [--id VALUE]"
    );
    process.exit(1);
  }

  let params: unknown[] = [];
  if (paramsJson) {
    try {
      const parsed = JSON.parse(paramsJson);
      if (!Array.isArray(parsed)) {
        throw new Error("params must be a JSON array");
      }
      params = parsed;
    } catch (error) {
      console.error(`Invalid --params JSON: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  const payload: Record<string, unknown> = {
    chain,
    method,
    params,
  };
  if (rpcUrl) payload.rpcUrl = rpcUrl;
  if (id) payload.id = /^\d+$/.test(id) ? Number(id) : id;

  const data = await walletRequest<{
    chain: string;
    rpcUrl: string;
    method: string;
    id?: string | number;
    result?: unknown;
    error?: unknown;
  }>("POST", "/api/wallet/rpc-call", payload);

  console.log("RPC CALL RESULT");
  console.log("===============");
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`rpc: ${data.rpcUrl}`);
  console.log(`method: ${data.method}`);
  if (data.id !== undefined) console.log(`id: ${data.id}`);
  if (data.error !== undefined) {
    console.log("error:");
    console.log(JSON.stringify(data.error, null, 2));
  } else {
    console.log("result:");
    console.log(JSON.stringify(data.result, null, 2));
  }
}

export async function rawWalletDapp(args: string[]): Promise<void> {
  const adapter = getFlagValue(args, "--adapter");
  const jsonPayload = getFlagValue(args, "--json") || getFlagValue(args, "--payload");
  if (!adapter || !jsonPayload) {
    console.error("Usage: cybara wallet dapp --adapter <adapter> --json '<payload_json>'");
    process.exit(1);
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(jsonPayload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be a JSON object");
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    console.error(`Invalid --json payload: ${(error as Error).message}`);
    process.exit(1);
  }

  const data = await walletRequest<unknown>("POST", "/api/wallet/dapp", {
    adapter,
    payload,
  });

  console.log("DAPP RESULT");
  console.log("===========");
  console.log(JSON.stringify(data, null, 2));
}

export async function rawWalletX402(args: string[]): Promise<void> {
  const url = getFlagValue(args, "--url");
  const method = getFlagValue(args, "--method");
  const headersJson = getFlagValue(args, "--headers");
  const bodyJson = getFlagValue(args, "--body-json");
  const bodyRaw = getFlagValue(args, "--body");
  const network = getFlagValue(args, "--network");
  const maxAmountAtomic = getFlagValue(args, "--max-amount-atomic");
  const index = getFlagValue(args, "--index");
  const timeoutMs = getFlagValue(args, "--timeout-ms");
  const dryRun = args.includes("--dry-run");

  if (!url) {
    console.error(
      "Usage: cybara wallet x402 --url <https_url> [--method GET|POST] [--headers '{...}'] [--body-json '{...}' | --body TEXT] [--network eip155:8453] [--max-amount-atomic N] [--index N] [--timeout-ms N] [--dry-run]"
    );
    process.exit(1);
  }
  if (bodyJson && bodyRaw) {
    console.error("Use only one of --body-json or --body");
    process.exit(1);
  }

  let headers: Record<string, string> | undefined;
  if (headersJson) {
    try {
      const parsed = JSON.parse(headersJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("headers must be a JSON object");
      }
      headers = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value),
        ])
      );
    } catch (error) {
      console.error(`Invalid --headers JSON: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  let body: unknown = undefined;
  if (bodyJson) {
    try {
      body = JSON.parse(bodyJson);
    } catch (error) {
      console.error(`Invalid --body-json payload: ${(error as Error).message}`);
      process.exit(1);
    }
  } else if (bodyRaw !== undefined) {
    body = bodyRaw;
  }

  const payload: Record<string, unknown> = { url };
  if (method) payload.method = method;
  if (headers) payload.headers = headers;
  if (body !== undefined) payload.body = body;
  if (network) payload.network = network;
  if (maxAmountAtomic) payload.maxAmountAtomic = maxAmountAtomic;
  if (index) payload.index = Number(index);
  if (timeoutMs) payload.timeoutMs = Number(timeoutMs);
  if (dryRun) payload.dryRun = true;

  const data = await walletRequest<{
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
    };
    settlement?: {
      success?: boolean;
      errorReason?: string;
      transaction?: string;
      network?: string;
      payer?: string;
    };
    body?: unknown;
  }>("POST", "/api/wallet/x402", payload);

  console.log("X402 RESULT");
  console.log("===========");
  console.log(`url: ${data.url}`);
  console.log(`method: ${data.method}`);
  console.log(`status: ${data.status}`);
  console.log(`attempted_payment: ${data.attemptedPayment ? "yes" : "no"}`);
  console.log(`paid: ${data.paid ? "yes" : "no"}`);
  if (data.paymentHeaderUsed) console.log(`payment_header: ${data.paymentHeaderUsed}`);
  if (data.paymentRequirement) {
    console.log("payment_requirement:");
    console.log(
      `  x402v${data.paymentRequirement.x402Version} ${data.paymentRequirement.scheme} ${data.paymentRequirement.network}`
    );
    console.log(`  amount: ${data.paymentRequirement.amount}`);
    console.log(`  asset: ${data.paymentRequirement.asset}`);
    console.log(`  payTo: ${data.paymentRequirement.payTo}`);
  }
  if (data.settlement) {
    console.log("settlement:");
    console.log(`  success: ${data.settlement.success === true ? "yes" : "no"}`);
    if (data.settlement.errorReason) console.log(`  error: ${data.settlement.errorReason}`);
    if (data.settlement.transaction) console.log(`  tx: ${data.settlement.transaction}`);
    if (data.settlement.network) console.log(`  network: ${data.settlement.network}`);
    if (data.settlement.payer) console.log(`  payer: ${data.settlement.payer}`);
  }
  if (data.body !== undefined) {
    console.log("body:");
    console.log(typeof data.body === "string" ? data.body : JSON.stringify(data.body, null, 2));
  }
}

function normalizeWalletSwapVenue(
  value: string | undefined
): "uniswap_v2" | "uniswap_v3" | "jupiter" | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "uniswap_v2" || normalized === "uniswap-v2" || normalized === "v2")
    return "uniswap_v2";
  if (
    normalized === "uniswap_v3" ||
    normalized === "uniswap-v3" ||
    normalized === "uniswap" ||
    normalized === "uni" ||
    normalized === "v3"
  )
    return "uniswap_v3";
  if (normalized === "jupiter" || normalized === "jup") return "jupiter";
  return null;
}

export async function rawWalletSwap(args: string[], executeOverride?: boolean): Promise<void> {
  const venueFlag = getFlagValue(args, "--venue");
  const normalizedVenue = normalizeWalletSwapVenue(venueFlag);
  const amountEth = getFlagValue(args, "--amount-eth");
  const percent = getFlagValue(args, "--percent");
  const minAmountOut = getFlagValue(args, "--min-out");
  const slippageBps = getFlagValue(args, "--slippage-bps");
  const deadlineSeconds = getFlagValue(args, "--deadline");
  const recipient = getFlagValue(args, "--recipient");
  const feeTier = getFlagValue(args, "--fee-tier");
  const inputMint = getFlagValue(args, "--input-mint");
  const outputMint = getFlagValue(args, "--output-mint");
  const amount = getFlagValue(args, "--amount");
  const amountRaw = getFlagValue(args, "--amount-raw");
  const index = getFlagValue(args, "--index");
  const rpcUrl = getFlagValue(args, "--rpc");
  const wrapUnwrapSol = getFlagValue(args, "--wrap-sol");
  const computePrice = getFlagValue(args, "--compute-price-microlamports");
  const skipPreflight = args.includes("--skip-preflight");
  const explicitExecuteFlag = args.includes("--execute");
  const quoteOnlyFlag = args.includes("--quote-only") || args.includes("--dry-run");
  const positional = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const tokenOutFlag = getFlagValue(args, "--token") || getFlagValue(args, "--token-out");
  const tokenOut =
    tokenOutFlag || (positional && !inputMint && !outputMint ? positional : undefined);

  if (venueFlag && !normalizedVenue) {
    console.error(
      "Usage: cybara wallet swap [--venue <uniswap_v2|uniswap_v3|jupiter>] [--execute] [venue-specific flags]"
    );
    process.exit(1);
  }

  if (explicitExecuteFlag && quoteOnlyFlag && executeOverride === undefined) {
    console.error("Use either --execute or --quote-only/--dry-run, not both");
    process.exit(1);
  }

  const selectedVenue = normalizedVenue || (inputMint || outputMint ? "jupiter" : "uniswap_v3");
  let shouldExecute = executeOverride ?? explicitExecuteFlag;
  if (quoteOnlyFlag) {
    shouldExecute = false;
  }

  if ((selectedVenue === "uniswap_v2" || selectedVenue === "uniswap_v3") && !tokenOut) {
    console.error("ETH swap venues require --token <symbol|address> (or first positional arg)");
    process.exit(1);
  }

  if (
    (selectedVenue === "uniswap_v2" || selectedVenue === "uniswap_v3") &&
    !percent &&
    !amountEth
  ) {
    console.error("ETH swap venues require either --percent or --amount-eth");
    process.exit(1);
  }

  if (selectedVenue === "jupiter" && (!inputMint || !outputMint)) {
    console.error("Jupiter venue requires --input-mint and --output-mint");
    process.exit(1);
  }

  const payload: Record<string, unknown> = {
    venue: selectedVenue,
    dryRun: !shouldExecute,
  };
  if (tokenOut) payload.tokenOut = tokenOut;
  if (amountEth) payload.amountEth = amountEth;
  if (percent) payload.percent = Number(percent);
  if (minAmountOut) payload.minAmountOut = minAmountOut;
  if (slippageBps) payload.slippageBps = Number(slippageBps);
  if (deadlineSeconds) payload.deadlineSeconds = Number(deadlineSeconds);
  if (recipient) payload.recipient = recipient;
  if (feeTier) payload.feeTier = Number(feeTier);
  if (inputMint) payload.inputMint = inputMint;
  if (outputMint) payload.outputMint = outputMint;
  if (amount) payload.amount = amount;
  if (amountRaw) payload.amountRaw = amountRaw;
  if (index) payload.index = Number(index);
  if (rpcUrl) payload.rpcUrl = rpcUrl;
  if (wrapUnwrapSol) payload.wrapUnwrapSol = wrapUnwrapSol.toLowerCase() !== "false";
  if (computePrice) payload.computeUnitPriceMicroLamports = Number(computePrice);
  if (skipPreflight) payload.skipPreflight = true;

  const data = await walletRequest<{
    venue: string;
    chain: string;
    from: string;
    inputToken: string;
    outputToken: string;
    amountIn: string;
    quotedAmountOut: string;
    minAmountOut: string;
    slippageBps: number;
    dryRun: boolean;
    route?: string;
    routePlan?: Array<{ label?: string; ammKey?: string; inputMint?: string; outputMint?: string }>;
    txid?: string;
    explorerUrl?: string;
  }>("POST", "/api/wallet/swap", payload);

  console.log("SWAP RESULT");
  console.log("===========");
  console.log(`mode: ${data.dryRun ? "quote-only" : "execute"}`);
  console.log(`venue: ${data.venue}`);
  console.log(`chain: ${data.chain.toUpperCase()}`);
  console.log(`from: ${data.from}`);
  console.log(`input: ${data.amountIn} ${data.inputToken}`);
  console.log(`quote_out: ${data.quotedAmountOut} ${data.outputToken}`);
  console.log(`min_out: ${data.minAmountOut} ${data.outputToken}`);
  console.log(`slippage_bps: ${data.slippageBps}`);
  if (data.route) console.log(`route: ${data.route}`);
  if (Array.isArray(data.routePlan) && data.routePlan.length > 0) {
    console.log("route_plan:");
    for (const [indexValue, leg] of data.routePlan.entries()) {
      const title = leg.label || leg.ammKey || `leg_${indexValue + 1}`;
      console.log(`  ${indexValue + 1}. ${title}`);
      if (leg.ammKey) console.log(`     amm: ${leg.ammKey}`);
      if (leg.inputMint && leg.outputMint) {
        console.log(`     ${leg.inputMint} -> ${leg.outputMint}`);
      }
    }
  }
  if (data.txid) console.log(`txid: ${data.txid}`);
  if (data.explorerUrl) console.log(`explorer: ${data.explorerUrl}`);
}

export async function rawWalletAgentAccess(mode?: string): Promise<void> {
  if (mode !== "on" && mode !== "off") {
    console.error("Usage: cybara wallet agent-access <on|off>");
    process.exit(1);
  }

  const enabled = mode === "on";
  const data = await walletRequest<{ enabled: boolean }>("PUT", "/api/wallet/agent-access", {
    enabled,
  });
  console.log(`Agent wallet access ${data.enabled ? "enabled" : "disabled"}`);
}

export async function rawWalletAgentPolicy(subCmd?: string, args: string[] = []): Promise<void> {
  if (!subCmd || subCmd === "show") {
    const policy = await walletRequest<CliWalletAgentPolicy>("GET", "/api/wallet/agent-policy");
    console.log("WALLET AGENT POLICY");
    console.log("===================");
    console.log(`allow_native_send: ${policy.allowNativeSend ? "yes" : "no"}`);
    console.log(`allow_token_send: ${policy.allowTokenSend ? "yes" : "no"}`);
    console.log(`allow_eth_contract_write: ${policy.allowEthContractWrite ? "yes" : "no"}`);
    console.log(
      `allow_sol_program_instruction: ${policy.allowSolProgramInstruction ? "yes" : "no"}`
    );
    console.log(`allow_eth_swaps: ${policy.allowEthSwaps ? "yes" : "no"}`);
    console.log(`allow_sol_swaps: ${policy.allowSolSwaps ? "yes" : "no"}`);
    console.log(`allow_dapp_interaction: ${policy.allowDappInteraction ? "yes" : "no"}`);
    console.log(`allow_x402_payments: ${policy.allowX402Payments ? "yes" : "no"}`);
    console.log(
      `allowed_eth_contracts: ${policy.allowedEthContracts.length ? policy.allowedEthContracts.join(", ") : "(none)"}`
    );
    console.log(
      `allowed_sol_programs: ${policy.allowedSolPrograms.length ? policy.allowedSolPrograms.join(", ") : "(none)"}`
    );
    console.log(
      `allowed_dapp_hosts: ${policy.allowedDappHosts.length ? policy.allowedDappHosts.join(", ") : "(none)"}`
    );
    console.log(
      `allowed_x402_networks: ${policy.allowedX402Networks.length ? policy.allowedX402Networks.join(", ") : "(none)"}`
    );
    console.log(`x402_max_amount_atomic: ${policy.x402MaxAmountAtomic}`);
    return;
  }

  if (subCmd !== "set") {
    console.error("Usage: cybara wallet agent-policy [show]");
    console.error("       cybara wallet agent-policy set --json '<partial_policy_json>'");
    process.exit(1);
  }

  const jsonPayload = getFlagValue(args, "--json");
  if (!jsonPayload) {
    console.error("Usage: cybara wallet agent-policy set --json '<partial_policy_json>'");
    process.exit(1);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(jsonPayload) as Record<string, unknown>;
  } catch (error) {
    console.error(`Invalid --json value: ${(error as Error).message}`);
    process.exit(1);
  }

  const data = await walletRequest<{ success: boolean }>("PUT", "/api/wallet/agent-policy", parsed);
  if (!data.success) {
    console.error("Failed to update wallet agent policy");
    process.exit(1);
  }
  console.log("Wallet agent policy updated");
}

export async function rawWalletRpc(subCmd?: string, args: string[] = []): Promise<void> {
  if (!subCmd || subCmd === "show") {
    const rpc = await walletRequest<CliWalletRpc>("GET", "/api/wallet/rpc");
    console.log("WALLET RPC");
    console.log("==========");
    console.log(`eth: ${rpc.ethRpc}`);
    console.log(`sol: ${rpc.solRpc}`);
    console.log(`btc: ${rpc.btcApi}`);
    return;
  }

  if (subCmd === "status") {
    const status = await walletRequest<CliWalletRpcStatus>("GET", "/api/wallet/rpc/status");
    console.log("WALLET RPC STATUS");
    console.log("=================");
    for (const service of status.services || []) {
      console.log(`- ${service.chain.toUpperCase()} ${service.healthy ? "healthy" : "down"}`);
      console.log(`  endpoint: ${service.endpoint}`);
      console.log(`  latency_ms: ${service.latencyMs}`);
      if (service.latestHeight) console.log(`  latest: ${service.latestHeight}`);
      if (service.error) console.log(`  error: ${service.error}`);
    }
    return;
  }

  if (subCmd !== "set") {
    console.error("Usage: cybara wallet rpc [show]");
    console.error("       cybara wallet rpc status");
    console.error("       cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]");
    process.exit(1);
  }

  const ethRpc = getFlagValue(args, "--eth");
  const solRpc = getFlagValue(args, "--sol");
  const btcApi = getFlagValue(args, "--btc");

  if (!ethRpc && !solRpc && !btcApi) {
    console.error("Usage: cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]");
    process.exit(1);
  }

  await walletRequest("PUT", "/api/wallet/rpc", { ethRpc, solRpc, btcApi });
  console.log("Wallet RPC settings updated");
}
