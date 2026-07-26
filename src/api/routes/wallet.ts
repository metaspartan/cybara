import type {
  WalletChain,
  WalletAgentPolicy,
  WalletPriceQuoteInput,
  WalletSwapInput,
  WalletSwapEthUniswapInput,
  SolInstructionAccountMeta,
  WalletDappCallInput,
  WalletX402RequestInput,
  WalletRpcCallInput,
} from "../../core/wallet";
import {
  parseWalletChains,
  parseWalletTokenChain,
  parseJsonArray,
  parseJsonObject,
  parseOptionalNumber,
  type RouteHandler,
} from "./_shared";

type WalletModule = typeof import("../../core/wallet");
type WalletManagerInstance = WalletModule["walletManager"];
let walletModulePromise: Promise<WalletModule> | null = null;

async function getWalletManager(): Promise<WalletManagerInstance> {
  if (!walletModulePromise) {
    walletModulePromise = import("../../core/wallet");
  }

  try {
    const walletModule = await walletModulePromise;
    if (!walletModule.walletManager) {
      walletModulePromise = null;
      throw new Error(
        "Wallet module loaded but walletManager is undefined. " +
          "This usually means a native dependency (tiny-secp256k1 WASM) " +
          "failed during module initialization. Check server logs for details."
      );
    }
    return walletModule.walletManager;
  } catch (error) {
    walletModulePromise = null;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Wallet module unavailable: ${reason}`);
  }
}

async function withWalletManager<T>(
  callback: (manager: WalletManagerInstance) => Promise<T> | T
): Promise<T> {
  const walletManager = await getWalletManager();
  return await callback(walletManager);
}

export const walletRoutes: Record<string, RouteHandler> = {
  "GET /api/wallet/status": async () => {
    return await withWalletManager((walletManager) => walletManager.getStatus());
  },
  "GET /api/wallet/rpc": async () => {
    return await withWalletManager((walletManager) => walletManager.getRpcConfig());
  },
  "GET /api/wallet/rpc/status": async () => {
    return await withWalletManager(async (walletManager) => await walletManager.getRpcStatus());
  },
  "PUT /api/wallet/rpc": async (body) => {
    const data = body as { ethRpc?: string; solRpc?: string; btcApi?: string };
    return await withWalletManager((walletManager) =>
      walletManager.setRpcConfig({
        ethRpc: data.ethRpc,
        solRpc: data.solRpc,
        btcApi: data.btcApi,
      })
    );
  },
  "GET /api/wallet/agent-policy": async () => {
    return await withWalletManager((walletManager) => walletManager.getAgentPolicy());
  },
  "PUT /api/wallet/agent-policy": async (body) => {
    const data = (body || {}) as Partial<WalletAgentPolicy>;
    return await withWalletManager((walletManager) =>
      walletManager.setAgentPolicy({
        allowNativeSend: data.allowNativeSend,
        allowTokenSend: data.allowTokenSend,
        allowEthContractWrite: data.allowEthContractWrite,
        allowSolProgramInstruction: data.allowSolProgramInstruction,
        allowEthSwaps: data.allowEthSwaps,
        allowDappInteraction: data.allowDappInteraction,
        allowX402Payments: data.allowX402Payments,
        allowedEthContracts: Array.isArray(data.allowedEthContracts)
          ? data.allowedEthContracts
          : undefined,
        allowedSolPrograms: Array.isArray(data.allowedSolPrograms)
          ? data.allowedSolPrograms
          : undefined,
        allowedDappHosts: Array.isArray(data.allowedDappHosts) ? data.allowedDappHosts : undefined,
        allowedX402Networks: Array.isArray(data.allowedX402Networks)
          ? data.allowedX402Networks
          : undefined,
        x402MaxAmountAtomic:
          typeof data.x402MaxAmountAtomic === "string" ? data.x402MaxAmountAtomic : undefined,
        allowedSendRecipients: Array.isArray(data.allowedSendRecipients)
          ? data.allowedSendRecipients
          : undefined,
        maxSendAmount: typeof data.maxSendAmount === "string" ? data.maxSendAmount : undefined,
      })
    );
  },
  "POST /api/wallet/create": async (body) => {
    const data = body as { password?: string };
    return await withWalletManager(
      async (walletManager) => await walletManager.createWallet(data.password || "")
    );
  },
  "POST /api/wallet/import": async (body) => {
    const data = body as { mnemonic?: string; password?: string };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.importWallet(data.mnemonic || "", data.password || "")
    );
  },
  "POST /api/wallet/unlock": async (body) => {
    const data = body as { password?: string };
    return await withWalletManager(
      async (walletManager) => await walletManager.unlock(data.password || "")
    );
  },
  "POST /api/wallet/seed": async (body) => {
    const data = body as { password?: string; acknowledgement?: string };
    if (data.acknowledgement !== "REVEAL") {
      throw new Error("Validation error: Type REVEAL to acknowledge seed phrase exposure");
    }
    return await withWalletManager(
      async (walletManager) => await walletManager.revealMnemonic(data.password || "")
    );
  },
  "POST /api/wallet/lock": async () => {
    return await withWalletManager((walletManager) => walletManager.lock());
  },
  "GET /api/wallet/accounts": async (_body, params) => {
    const count = params?.count ? Number(params.count) : undefined;
    const startIndex = params?.startIndex ? Number(params.startIndex) : undefined;
    const chains = parseWalletChains(params?.chains);
    return await withWalletManager((walletManager) =>
      walletManager.getAccounts({ chains, count, startIndex })
    );
  },
  "GET /api/wallet/receive": async (_body, params) => {
    const chain = String(params?.chain || "eth").toLowerCase();
    const index = params?.index ? Number(params.index) : 0;
    return await withWalletManager((walletManager) =>
      walletManager.getReceiveAddress(chain as WalletChain, index)
    );
  },
  "GET /api/wallet/balances": async (_body, params) => {
    const count = params?.count ? Number(params.count) : undefined;
    const startIndex = params?.startIndex ? Number(params.startIndex) : undefined;
    const chains = parseWalletChains(params?.chains);
    return await withWalletManager(
      async (walletManager) => await walletManager.getBalances({ chains, count, startIndex })
    );
  },
  "GET /api/wallet/tokens": async (_body, params) => {
    const chain = parseWalletTokenChain(params?.chain, "eth");
    const index = params?.index ? Number(params.index) : 0;
    const includeZero = String(params?.includeZero || "").toLowerCase() === "true";
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getTokenBalances({
          chain,
          index,
          includeZero,
        })
    );
  },
  "GET /api/wallet/token-transactions": async (_body, params) => {
    const chain = parseWalletTokenChain(params?.chain, "eth");
    const index = params?.index ? Number(params.index) : 0;
    const limit = params?.limit ? Number(params.limit) : undefined;
    const tokenAddress = params?.tokenAddress;
    const rpcUrl = params?.rpcUrl;

    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getTokenTransactions({
          chain,
          index,
          limit,
          tokenAddress,
          rpcUrl,
        })
    );
  },
  "GET /api/wallet/transactions": async (_body, params) => {
    const chain = String(params?.chain || "").toLowerCase();
    if (!chain) {
      throw new Error("Validation error: chain is required");
    }
    const index = params?.index ? Number(params.index) : 0;
    const limit = params?.limit ? Number(params.limit) : undefined;
    const rpcUrl = params?.rpcUrl;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getTransactions({
          chain: chain as WalletChain,
          index,
          limit,
          rpcUrl,
        })
    );
  },
  "POST /api/wallet/send": async (body) => {
    const data = body as {
      chain?: string;
      to?: string;
      amount?: string;
      index?: number;
      memo?: string;
      rpcUrl?: string;
      feeRate?: number;
    };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.send({
          chain: String(data.chain || "").toLowerCase() as WalletChain,
          to: data.to || "",
          amount: data.amount || "",
          index: data.index,
          memo: data.memo,
          rpcUrl: data.rpcUrl,
          feeRate: data.feeRate,
        })
    );
  },
  "POST /api/wallet/send-token": async (body) => {
    const data = body as {
      chain?: string;
      tokenAddress?: string;
      mint?: string;
      to?: string;
      amount?: string;
      index?: number;
      decimals?: number;
      rpcUrl?: string;
      memo?: string;
    };

    return await withWalletManager(
      async (walletManager) =>
        await walletManager.sendToken({
          chain: parseWalletTokenChain(data.chain, "eth"),
          tokenAddress: String(data.tokenAddress || data.mint || "").trim(),
          to: String(data.to || "").trim(),
          amount: String(data.amount || "").trim(),
          index: data.index,
          decimals: data.decimals,
          rpcUrl: data.rpcUrl,
          memo: data.memo,
        })
    );
  },
  "POST /api/wallet/eth-contract": async (body) => {
    const data = body as {
      contractAddress?: string;
      abi?: string;
      method?: string;
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
    };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.callEthContract({
          contractAddress: String(data.contractAddress || ""),
          abi: typeof data.abi === "string" ? data.abi : undefined,
          method: String(data.method || data.methodSignature || ""),
          methodSignature:
            typeof data.methodSignature === "string" ? data.methodSignature : undefined,
          args: parseJsonArray(data.args),
          index: data.index,
          value: data.value,
          gasLimit:
            typeof data.gasLimit === "number" || typeof data.gasLimit === "string"
              ? data.gasLimit
              : undefined,
          gasPriceGwei: typeof data.gasPriceGwei === "string" ? data.gasPriceGwei : undefined,
          maxFeePerGasGwei:
            typeof data.maxFeePerGasGwei === "string" ? data.maxFeePerGasGwei : undefined,
          maxPriorityFeePerGasGwei:
            typeof data.maxPriorityFeePerGasGwei === "string"
              ? data.maxPriorityFeePerGasGwei
              : undefined,
          nonce: parseOptionalNumber(data.nonce),
          readOnly: data.readOnly === true,
          rpcUrl: data.rpcUrl,
        })
    );
  },
  "POST /api/wallet/sol-instruction": async (body) => {
    const data = body as {
      programId?: string;
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
    };

    return await withWalletManager(
      async (walletManager) =>
        await walletManager.sendSolProgramInstruction({
          programId: String(data.programId || ""),
          keys: Array.isArray(data.keys) ? data.keys : undefined,
          accounts: Array.isArray(data.accounts) ? data.accounts : undefined,
          dataBase64: typeof data.dataBase64 === "string" ? data.dataBase64 : undefined,
          dataHex: typeof data.dataHex === "string" ? data.dataHex : undefined,
          dataUtf8: typeof data.dataUtf8 === "string" ? data.dataUtf8 : undefined,
          index: data.index,
          rpcUrl: data.rpcUrl,
          computeUnitLimit: parseOptionalNumber(data.computeUnitLimit),
          computeUnitPriceMicroLamports: parseOptionalNumber(data.computeUnitPriceMicroLamports),
          skipPreflight: data.skipPreflight === true,
        })
    );
  },
  "POST /api/wallet/swap-eth-uniswap": async (body) => {
    const data = (body || {}) as Partial<WalletSwapEthUniswapInput>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.swapEthOnUniswap({
          tokenOut: String(data.tokenOut || ""),
          amountEth: typeof data.amountEth === "string" ? data.amountEth : undefined,
          percent: typeof data.percent === "number" ? data.percent : undefined,
          minAmountOut: typeof data.minAmountOut === "string" ? data.minAmountOut : undefined,
          slippageBps: typeof data.slippageBps === "number" ? data.slippageBps : undefined,
          deadlineSeconds:
            typeof data.deadlineSeconds === "number" ? data.deadlineSeconds : undefined,
          index: typeof data.index === "number" ? data.index : undefined,
          recipient: typeof data.recipient === "string" ? data.recipient : undefined,
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
          dryRun: data.dryRun === true,
        })
    );
  },
  "POST /api/wallet/price": async (body) => {
    const data = (body || {}) as Partial<WalletPriceQuoteInput> & {
      feedId?: string;
    };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.getPriceQuote({
          source:
            data.source === "auto" ||
            data.source === "chainlink" ||
            data.source === "pyth" ||
            data.source === "jupiter"
              ? data.source
              : undefined,
          symbol: typeof data.symbol === "string" ? data.symbol : undefined,
          pair: typeof data.pair === "string" ? data.pair : undefined,
          feedAddress: typeof data.feedAddress === "string" ? data.feedAddress : undefined,
          pythFeedId:
            typeof data.pythFeedId === "string"
              ? data.pythFeedId
              : typeof data.feedId === "string"
                ? data.feedId
                : undefined,
          mint: typeof data.mint === "string" ? data.mint : undefined,
          quoteCurrency: typeof data.quoteCurrency === "string" ? data.quoteCurrency : undefined,
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
        })
    );
  },
  "GET /api/wallet/endpoints": async () => {
    return await withWalletManager((walletManager) => walletManager.getEndpointDirectory());
  },
  "GET /api/wallet/dapps": async () => {
    return await withWalletManager((walletManager) => walletManager.getDappDirectory());
  },
  "POST /api/wallet/rpc-call": async (body) => {
    const data = (body || {}) as Partial<WalletRpcCallInput>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.rpcCall({
          chain: data.chain === "sol" ? "sol" : "eth",
          method: String(data.method || ""),
          params: parseJsonArray(data.params),
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
          id: typeof data.id === "string" || typeof data.id === "number" ? data.id : undefined,
        })
    );
  },
  "POST /api/wallet/dapp": async (body) => {
    const data = (body || {}) as Partial<WalletDappCallInput> & {
      payload?: Record<string, unknown> | string;
      input?: Record<string, unknown> | string;
    };
    const payload = (parseJsonObject(data.payload) ||
      parseJsonObject(data.input) ||
      (data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
        ? (data.payload as Record<string, unknown>)
        : undefined) ||
      (data.input && typeof data.input === "object" && !Array.isArray(data.input)
        ? (data.input as Record<string, unknown>)
        : undefined) ||
      {}) as Record<string, unknown>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.executeDapp({
          adapter: typeof data.adapter === "string" ? data.adapter : "",
          payload,
        })
    );
  },
  "POST /api/wallet/x402": async (body) => {
    const data = (body || {}) as Partial<WalletX402RequestInput>;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.x402Request({
          url: String(data.url || ""),
          method: typeof data.method === "string" ? data.method : undefined,
          headers:
            data.headers && typeof data.headers === "object" && !Array.isArray(data.headers)
              ? (data.headers as Record<string, string>)
              : undefined,
          body: data.body,
          network: typeof data.network === "string" ? data.network : undefined,
          maxAmountAtomic:
            typeof data.maxAmountAtomic === "string" ? data.maxAmountAtomic : undefined,
          index: parseOptionalNumber(data.index),
          timeoutMs: parseOptionalNumber(data.timeoutMs),
          dryRun: data.dryRun === true,
          parseJsonResponse:
            typeof data.parseJsonResponse === "boolean" ? data.parseJsonResponse : undefined,
        })
    );
  },
  "POST /api/wallet/swap": async (body) => {
    const data = (body || {}) as Partial<WalletSwapInput> & {
      tokenAddress?: string;
      execute?: boolean;
      broadcast?: boolean;
    };
    const explicitDryRun = typeof data.dryRun === "boolean" ? data.dryRun : undefined;
    const execute = data.execute === true || data.broadcast === true;
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.swap({
          venue: typeof data.venue === "string" ? data.venue : "uniswap_v3",
          tokenOut:
            typeof data.tokenOut === "string"
              ? data.tokenOut
              : typeof data.tokenAddress === "string"
                ? data.tokenAddress
                : undefined,
          amountEth: typeof data.amountEth === "string" ? data.amountEth : undefined,
          percent: parseOptionalNumber(data.percent),
          minAmountOut: typeof data.minAmountOut === "string" ? data.minAmountOut : undefined,
          recipient: typeof data.recipient === "string" ? data.recipient : undefined,
          feeTier: parseOptionalNumber(data.feeTier),
          inputMint: typeof data.inputMint === "string" ? data.inputMint : undefined,
          outputMint: typeof data.outputMint === "string" ? data.outputMint : undefined,
          amount: typeof data.amount === "string" ? data.amount : undefined,
          amountRaw: typeof data.amountRaw === "string" ? data.amountRaw : undefined,
          index: parseOptionalNumber(data.index),
          slippageBps: parseOptionalNumber(data.slippageBps),
          deadlineSeconds: parseOptionalNumber(data.deadlineSeconds),
          rpcUrl: typeof data.rpcUrl === "string" ? data.rpcUrl : undefined,
          wrapUnwrapSol: typeof data.wrapUnwrapSol === "boolean" ? data.wrapUnwrapSol : undefined,
          computeUnitPriceMicroLamports: parseOptionalNumber(data.computeUnitPriceMicroLamports),
          skipPreflight: data.skipPreflight === true,
          dryRun: explicitDryRun ?? !execute,
        })
    );
  },
  "POST /api/wallet/sign": async (body) => {
    const data = body as { message?: string; chain?: string; index?: number };
    return await withWalletManager(
      async (walletManager) =>
        await walletManager.signMessage(
          data.message || "",
          (data.chain || "eth") as WalletChain,
          data.index || 0
        )
    );
  },
  "DELETE /api/wallet": async (body) => {
    const data = (body || {}) as { password?: string };
    return await withWalletManager(
      async (walletManager) => await walletManager.deleteWallet(data.password)
    );
  },
  "PUT /api/wallet/agent-access": async (body) => {
    const data = body as { enabled?: boolean };
    return await withWalletManager((walletManager) =>
      walletManager.setAgentAccessEnabled(data.enabled === true)
    );
  },
};
