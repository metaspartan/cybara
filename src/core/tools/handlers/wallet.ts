import {
  walletManager,
  type WalletChain,
  type WalletTokenChain,
  type SolInstructionAccountMeta,
} from "../../wallet";

function parseWalletChain(value: unknown, fallback: WalletChain = "eth"): WalletChain {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return value.trim().toLowerCase() as WalletChain;
}

function parseWalletTokenChain(
  value: unknown,
  fallback: WalletTokenChain = "eth"
): WalletTokenChain {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return value.trim().toLowerCase() as WalletTokenChain;
}

function parseWalletChains(value: unknown): WalletChain[] | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) as WalletChain[];
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean) as WalletChain[];
  }
  return undefined;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return [];
}

function parseInstructionKeys(value: unknown): SolInstructionAccountMeta[] {
  const keys = parseJsonArray(value);
  const parsed: SolInstructionAccountMeta[] = [];
  for (const entry of keys) {
    if (typeof entry === "string" && entry.trim()) {
      parsed.push({
        pubkey: entry.trim(),
        isSigner: false,
        isWritable: false,
      });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const typed = entry as {
      pubkey?: unknown;
      address?: unknown;
      isSigner?: unknown;
      signer?: unknown;
      isWritable?: unknown;
      writable?: unknown;
    };
    const pubkey = typeof typed.pubkey === "string" ? typed.pubkey : typed.address;
    if (typeof pubkey !== "string") continue;
    parsed.push({
      pubkey,
      isSigner: typed.isSigner === true || typed.signer === true,
      isWritable: typed.isWritable === true || typed.writable === true,
    });
  }
  return parsed;
}

function parseBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }
  return false;
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export async function handleWallet(args: Record<string, unknown>): Promise<unknown> {
  const action = String(args.action || "status");

  switch (action) {
    case "status":
      return walletManager.getStatusForAgent();

    case "address":
      return walletManager.getAgentAddress();

    case "accounts":
      return walletManager.getAccountsForAgent({
        chains: parseWalletChains(args.chains),
        count: parseNumber(args.count, 1),
        startIndex: parseNumber(args.startIndex, 0),
      });

    case "balances":
      return await walletManager.getBalancesForAgent({
        chains: parseWalletChains(args.chains),
        count: parseNumber(args.count, 1),
        startIndex: parseNumber(args.startIndex, 0),
      });

    case "token_balances":
      return await walletManager.getTokenBalancesForAgent({
        chain: parseWalletTokenChain(args.chain, "eth"),
        index: parseNumber(args.index, 0),
        includeZero: parseBoolean(args.includeZero),
      });

    case "token_transactions":
      return await walletManager.getTokenTransactionsForAgent({
        chain: parseWalletTokenChain(args.chain, "eth"),
        index: parseNumber(args.index, 0),
        limit: parseNumber(args.limit, 20),
        tokenAddress: typeof args.tokenAddress === "string" ? args.tokenAddress : undefined,
        rpcUrl: typeof args.rpcUrl === "string" ? args.rpcUrl : undefined,
      });

    case "transactions":
      return await walletManager.getTransactionsForAgent({
        chain: parseWalletChain(args.chain, "eth"),
        index: parseNumber(args.index, 0),
        limit: parseNumber(args.limit, 10),
      });

    case "receive":
      return walletManager.getReceiveAddressForAgent(
        parseWalletChain(args.chain, "eth"),
        parseNumber(args.index, 0)
      );

    case "send":
      return await walletManager.sendForAgent({
        chain: parseWalletChain(args.chain, "eth"),
        to: String(args.to || ""),
        amount: String(args.amount || ""),
        index: parseNumber(args.index, 0),
        memo: typeof args.memo === "string" ? args.memo : undefined,
        feeRate: parseOptionalNumber(args.feeRate),
      });

    case "send_token":
      return await walletManager.sendTokenForAgent({
        chain: parseWalletTokenChain(args.chain, "eth"),
        tokenAddress: String(args.tokenAddress || args.mint || ""),
        to: String(args.to || ""),
        amount: String(args.amount || ""),
        index: parseNumber(args.index, 0),
        decimals: parseOptionalNumber(args.decimals),
        memo: typeof args.memo === "string" ? args.memo : undefined,
        rpcUrl: typeof args.rpcUrl === "string" ? args.rpcUrl : undefined,
      });

    case "sign_message": {
      const message = args.message as string | undefined;
      return await walletManager.signMessageForAgent(
        message || "",
        parseWalletChain(args.chain, "eth"),
        parseNumber(args.index, 0)
      );
    }

    case "eth_contract_call":
      return await walletManager.callEthContractForAgent({
        contractAddress: String(args.contractAddress || ""),
        abi: typeof args.abi === "string" ? args.abi : undefined,
        method: String(args.method || args.methodSignature || ""),
        methodSignature:
          typeof args.methodSignature === "string" ? args.methodSignature : undefined,
        args: parseJsonArray(args.args),
        index: parseNumber(args.index, 0),
        value: typeof args.value === "string" ? args.value : undefined,
        gasLimit:
          typeof args.gasLimit === "number" || typeof args.gasLimit === "string"
            ? (args.gasLimit as number | string)
            : undefined,
        gasPriceGwei: typeof args.gasPriceGwei === "string" ? args.gasPriceGwei : undefined,
        maxFeePerGasGwei:
          typeof args.maxFeePerGasGwei === "string" ? args.maxFeePerGasGwei : undefined,
        maxPriorityFeePerGasGwei:
          typeof args.maxPriorityFeePerGasGwei === "string"
            ? args.maxPriorityFeePerGasGwei
            : undefined,
        nonce: parseOptionalNumber(args.nonce),
        readOnly: parseBoolean(args.readOnly),
        rpcUrl: typeof args.rpcUrl === "string" ? args.rpcUrl : undefined,
      });

    case "sol_program_instruction": {
      const parsedKeys = parseInstructionKeys(args.keys);
      const parsedAccounts = parseInstructionKeys(args.accounts);
      return await walletManager.sendSolInstructionForAgent({
        programId: String(args.programId || ""),
        keys: parsedKeys.length > 0 ? parsedKeys : parsedAccounts,
        dataBase64: typeof args.dataBase64 === "string" ? args.dataBase64 : undefined,
        dataHex: typeof args.dataHex === "string" ? args.dataHex : undefined,
        dataUtf8:
          typeof args.dataUtf8 === "string"
            ? args.dataUtf8
            : typeof args.data === "string"
              ? args.data
              : undefined,
        index: parseNumber(args.index, 0),
        rpcUrl: typeof args.rpcUrl === "string" ? args.rpcUrl : undefined,
        computeUnitLimit: parseOptionalNumber(args.computeUnitLimit),
        computeUnitPriceMicroLamports: parseOptionalNumber(args.computeUnitPriceMicroLamports),
        skipPreflight: parseBoolean(args.skipPreflight),
      });
    }

    case "swap_eth_uniswap":
      return await walletManager.swapEthOnUniswapForAgent({
        tokenOut: String(args.tokenOut || args.tokenAddress || args.symbol || ""),
        amountEth: typeof args.amountEth === "string" ? args.amountEth : undefined,
        percent: parseOptionalNumber(args.percent),
        minAmountOut: typeof args.minAmountOut === "string" ? args.minAmountOut : undefined,
        slippageBps: parseOptionalNumber(args.slippageBps),
        deadlineSeconds: parseOptionalNumber(args.deadlineSeconds),
        index: parseNumber(args.index, 0),
        recipient: typeof args.recipient === "string" ? args.recipient : undefined,
        rpcUrl: typeof args.rpcUrl === "string" ? args.rpcUrl : undefined,
        dryRun: parseBoolean(args.dryRun),
      });

    default:
      throw new Error(`Validation error: Unknown wallet action: ${action}`);
  }
}
