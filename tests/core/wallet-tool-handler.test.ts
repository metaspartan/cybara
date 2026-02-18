import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const walletToolMockState = {
  accountsCalls: [] as Array<{ chains?: string[]; count?: number; startIndex?: number }>,
  balancesCalls: [] as Array<{ chains?: string[]; count?: number; startIndex?: number }>,
  tokenBalancesCalls: [] as Array<{ chain: "eth" | "sol"; index?: number; includeZero?: boolean }>,
  tokenTransactionsCalls: [] as Array<{
    chain: "eth" | "sol";
    index?: number;
    limit?: number;
    tokenAddress?: string;
    rpcUrl?: string;
  }>,
  transactionsCalls: [] as Array<{ chain: string; index?: number; limit?: number }>,
  receiveCalls: [] as Array<{ chain: string; index: number }>,
  sendCalls: [] as Array<{
    chain: string;
    to: string;
    amount: string;
    index?: number;
    memo?: string;
    feeRate?: number;
  }>,
  sendTokenCalls: [] as Array<{
    chain: "eth" | "sol";
    tokenAddress: string;
    to: string;
    amount: string;
    index?: number;
    decimals?: number;
    memo?: string;
    rpcUrl?: string;
  }>,
  signCalls: [] as Array<{ message: string; chain: string; index: number }>,
  ethContractCalls: [] as Array<{
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
  }>,
  solInstructionCalls: [] as Array<{
    programId: string;
    keys: Array<{ pubkey: string; isSigner?: boolean; isWritable?: boolean }>;
    dataBase64?: string;
    dataHex?: string;
    dataUtf8?: string;
    index?: number;
    rpcUrl?: string;
    computeUnitLimit?: number;
    computeUnitPriceMicroLamports?: number;
    skipPreflight?: boolean;
  }>,
  swapCalls: [] as Array<{
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
  }>,
  priceQuoteCalls: [] as Array<{
    source?: string;
    symbol?: string;
    pair?: string;
    feedAddress?: string;
    pythFeedId?: string;
    mint?: string;
    quoteCurrency?: string;
    rpcUrl?: string;
  }>,
  dynamicSwapCalls: [] as Array<{
    venue: "uniswap_v2" | "uniswap_v3" | "jupiter";
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
    wrapUnwrapSol?: boolean;
    computeUnitPriceMicroLamports?: number;
    skipPreflight?: boolean;
    dryRun?: boolean;
  }>,
};

function resetState() {
  walletToolMockState.accountsCalls = [];
  walletToolMockState.balancesCalls = [];
  walletToolMockState.tokenBalancesCalls = [];
  walletToolMockState.tokenTransactionsCalls = [];
  walletToolMockState.transactionsCalls = [];
  walletToolMockState.receiveCalls = [];
  walletToolMockState.sendCalls = [];
  walletToolMockState.sendTokenCalls = [];
  walletToolMockState.signCalls = [];
  walletToolMockState.ethContractCalls = [];
  walletToolMockState.solInstructionCalls = [];
  walletToolMockState.swapCalls = [];
  walletToolMockState.priceQuoteCalls = [];
  walletToolMockState.dynamicSwapCalls = [];
}

mock.module("../../src/core/wallet", () => ({
  walletManager: {
    getStatusForAgent: () => ({ exists: true, unlocked: true, agentAccessEnabled: true }),
    getAgentAddress: () => ({ eth: "0xagent" }),
    getAccountsForAgent: (query: { chains?: string[]; count?: number; startIndex?: number }) => {
      walletToolMockState.accountsCalls.push(query);
      return [{ chain: "eth", index: 0, address: "0xabc" }];
    },
    getBalancesForAgent: async (query: {
      chains?: string[];
      count?: number;
      startIndex?: number;
    }) => {
      walletToolMockState.balancesCalls.push(query);
      return [{ chain: "eth", amount: "1.0" }];
    },
    getTokenBalancesForAgent: async (query: {
      chain: "eth" | "sol";
      index?: number;
      includeZero?: boolean;
    }) => {
      walletToolMockState.tokenBalancesCalls.push(query);
      return [{ chain: query.chain, symbol: "USDC", amount: "1.0" }];
    },
    getTokenTransactionsForAgent: async (query: {
      chain: "eth" | "sol";
      index?: number;
      limit?: number;
      tokenAddress?: string;
      rpcUrl?: string;
    }) => {
      walletToolMockState.tokenTransactionsCalls.push(query);
      return [{ chain: query.chain, txid: "token-tx-1", amount: "2.0", symbol: "USDC" }];
    },
    getTransactionsForAgent: async (query: { chain: string; index?: number; limit?: number }) => {
      walletToolMockState.transactionsCalls.push(query);
      return [{ chain: query.chain, txid: "tx" }];
    },
    getReceiveAddressForAgent: (chain: string, index: number) => {
      walletToolMockState.receiveCalls.push({ chain, index });
      return { chain, index, address: `${chain}-addr-${index}` };
    },
    sendForAgent: async (input: {
      chain: string;
      to: string;
      amount: string;
      index?: number;
      memo?: string;
      feeRate?: number;
    }) => {
      walletToolMockState.sendCalls.push(input);
      return { chain: input.chain, txid: "native-tx" };
    },
    sendTokenForAgent: async (input: {
      chain: "eth" | "sol";
      tokenAddress: string;
      to: string;
      amount: string;
      index?: number;
      decimals?: number;
      memo?: string;
      rpcUrl?: string;
    }) => {
      walletToolMockState.sendTokenCalls.push(input);
      return { chain: input.chain, txid: "token-tx" };
    },
    signMessageForAgent: async (message: string, chain: string, index: number) => {
      walletToolMockState.signCalls.push({ message, chain, index });
      return { signature: "sig" };
    },
    callEthContractForAgent: async (input: {
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
    }) => {
      walletToolMockState.ethContractCalls.push(input);
      return { ok: true };
    },
    sendSolInstructionForAgent: async (input: {
      programId: string;
      keys: Array<{ pubkey: string; isSigner?: boolean; isWritable?: boolean }>;
      dataBase64?: string;
      dataHex?: string;
      dataUtf8?: string;
      index?: number;
      rpcUrl?: string;
      computeUnitLimit?: number;
      computeUnitPriceMicroLamports?: number;
      skipPreflight?: boolean;
    }) => {
      walletToolMockState.solInstructionCalls.push(input);
      return { txid: "sol-tx" };
    },
    swapEthOnUniswapForAgent: async (input: {
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
    }) => {
      walletToolMockState.swapCalls.push(input);
      return { dryRun: input.dryRun === true, quotedAmountOut: "123.45", toTokenSymbol: "LINK" };
    },
    getPriceQuoteForAgent: async (input: {
      source?: string;
      symbol?: string;
      pair?: string;
      feedAddress?: string;
      pythFeedId?: string;
      mint?: string;
      quoteCurrency?: string;
      rpcUrl?: string;
    }) => {
      walletToolMockState.priceQuoteCalls.push(input);
      return { source: input.source || "auto", base: input.symbol || "BTC", quote: "USD", price: "123.45" };
    },
    swapForAgent: async (input: {
      venue: "uniswap_v2" | "uniswap_v3" | "jupiter";
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
      wrapUnwrapSol?: boolean;
      computeUnitPriceMicroLamports?: number;
      skipPreflight?: boolean;
      dryRun?: boolean;
    }) => {
      walletToolMockState.dynamicSwapCalls.push(input);
      return {
        venue: input.venue,
        chain: input.venue === "jupiter" ? "sol" : "eth",
        from: "mock-from",
        inputToken: input.venue === "jupiter" ? "So11111111111111111111111111111111111111112" : "ETH",
        outputToken: input.venue === "jupiter" ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "LINK",
        amountIn: "1",
        amountInRaw: "1000000000",
        quotedAmountOut: "100",
        quotedAmountOutRaw: "100000000",
        minAmountOut: "99",
        minAmountOutRaw: "99000000",
        slippageBps: input.slippageBps ?? 100,
        dryRun: input.dryRun === true,
      };
    },
  },
}));

let handleWallet: (args: Record<string, unknown>) => Promise<unknown>;

describe("Wallet tool handler", () => {
  beforeAll(async () => {
    const walletTool = await import("../../src/core/tools/handlers/wallet");
    handleWallet = walletTool.handleWallet;
  });

  beforeEach(() => {
    resetState();
  });

  test("token_balances parses chain/index/includeZero", async () => {
    const result = await handleWallet({
      action: "token_balances",
      chain: "sol",
      index: "2",
      includeZero: "true",
    });

    expect(result).toEqual([{ chain: "sol", symbol: "USDC", amount: "1.0" }]);
    expect(walletToolMockState.tokenBalancesCalls).toEqual([
      { chain: "sol", index: 2, includeZero: true },
    ]);
  });

  test("token_transactions parses chain/index/limit/token filter", async () => {
    const result = await handleWallet({
      action: "token_transactions",
      chain: "eth",
      index: "4",
      limit: "15",
      tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      rpcUrl: "https://rpc.example",
    });

    expect(result).toEqual([{ chain: "eth", txid: "token-tx-1", amount: "2.0", symbol: "USDC" }]);
    expect(walletToolMockState.tokenTransactionsCalls).toEqual([
      {
        chain: "eth",
        index: 4,
        limit: 15,
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        rpcUrl: "https://rpc.example",
      },
    ]);
  });

  test("send parses numeric strings and falls back invalid values", async () => {
    await handleWallet({
      action: "send",
      chain: "eth",
      to: "0xabc",
      amount: "1.5",
      index: "not-a-number",
      feeRate: "12",
      memo: "memo",
    });

    expect(walletToolMockState.sendCalls).toEqual([
      {
        chain: "eth",
        to: "0xabc",
        amount: "1.5",
        index: 0,
        feeRate: 12,
        memo: "memo",
      },
    ]);
  });

  test("send_token supports mint alias and decimal strings", async () => {
    await handleWallet({
      action: "send_token",
      chain: "eth",
      mint: "0xTokenAddress",
      to: "0xReceiver",
      amount: "2.25",
      index: "3",
      decimals: "6",
      rpcUrl: "https://rpc.example",
      memo: "usdc transfer",
    });

    expect(walletToolMockState.sendTokenCalls).toEqual([
      {
        chain: "eth",
        tokenAddress: "0xTokenAddress",
        to: "0xReceiver",
        amount: "2.25",
        index: 3,
        decimals: 6,
        rpcUrl: "https://rpc.example",
        memo: "usdc transfer",
      },
    ]);
  });

  test("eth_contract_call parses signature, args JSON, and override fields", async () => {
    await handleWallet({
      action: "eth_contract_call",
      contractAddress: "0xContract",
      methodSignature: "balanceOf(address)",
      args: '["0xUser"]',
      index: "1",
      readOnly: "true",
      gasLimit: "250000",
      maxFeePerGasGwei: "22.5",
      maxPriorityFeePerGasGwei: "1.2",
      nonce: "7",
      rpcUrl: "https://eth-rpc.example",
    });

    expect(walletToolMockState.ethContractCalls).toEqual([
      {
        contractAddress: "0xContract",
        abi: undefined,
        method: "balanceOf(address)",
        methodSignature: "balanceOf(address)",
        args: ["0xUser"],
        index: 1,
        gasLimit: "250000",
        maxFeePerGasGwei: "22.5",
        maxPriorityFeePerGasGwei: "1.2",
        nonce: 7,
        readOnly: true,
        rpcUrl: "https://eth-rpc.example",
      },
    ]);
  });

  test("sol_program_instruction parses key aliases, utf8 data, and compute params", async () => {
    await handleWallet({
      action: "sol_program_instruction",
      programId: "11111111111111111111111111111111",
      accounts: JSON.stringify([
        {
          address: "So11111111111111111111111111111111111111112",
          signer: false,
          writable: true,
        },
        "So11111111111111111111111111111111111111113",
      ]),
      data: "hello world",
      computeUnitLimit: "200000",
      computeUnitPriceMicroLamports: "10000",
      skipPreflight: "true",
      index: "5",
      rpcUrl: "https://sol-rpc.example",
    });

    expect(walletToolMockState.solInstructionCalls).toEqual([
      {
        programId: "11111111111111111111111111111111",
        keys: [
          {
            pubkey: "So11111111111111111111111111111111111111112",
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: "So11111111111111111111111111111111111111113",
            isSigner: false,
            isWritable: false,
          },
        ],
        dataBase64: undefined,
        dataHex: undefined,
        dataUtf8: "hello world",
        computeUnitLimit: 200000,
        computeUnitPriceMicroLamports: 10000,
        skipPreflight: true,
        index: 5,
        rpcUrl: "https://sol-rpc.example",
      },
    ]);
  });

  test("swap_eth_uniswap parses percent/slippage/deadline fields", async () => {
    const result = await handleWallet({
      action: "swap_eth_uniswap",
      tokenOut: "LINK",
      percent: "50",
      slippageBps: "120",
      deadlineSeconds: "600",
      index: "1",
      dryRun: "true",
    });

    expect(result).toEqual({ dryRun: true, quotedAmountOut: "123.45", toTokenSymbol: "LINK" });
    expect(walletToolMockState.swapCalls).toEqual([
      {
        tokenOut: "LINK",
        amountEth: undefined,
        percent: 50,
        minAmountOut: undefined,
        slippageBps: 120,
        deadlineSeconds: 600,
        index: 1,
        recipient: undefined,
        rpcUrl: undefined,
        dryRun: true,
      },
    ]);
  });

  test("price_quote parses source/feed aliases", async () => {
    const result = await handleWallet({
      action: "price_quote",
      source: "pyth",
      symbol: "BTC",
      feedId: "0xfeed",
      quoteCurrency: "USD",
      rpcUrl: "https://eth-rpc.example",
    });

    expect(result).toEqual({ source: "pyth", base: "BTC", quote: "USD", price: "123.45" });
    expect(walletToolMockState.priceQuoteCalls).toEqual([
      {
        source: "pyth",
        symbol: "BTC",
        pair: undefined,
        feedAddress: undefined,
        pythFeedId: "0xfeed",
        mint: undefined,
        quoteCurrency: "USD",
        rpcUrl: "https://eth-rpc.example",
      },
    ]);
  });

  test("swap_quote and swap_execute forward dynamic venue payloads", async () => {
    const quote = await handleWallet({
      action: "swap_quote",
      venue: "uniswap_v3",
      tokenOut: "LINK",
      amountEth: "0.5",
      feeTier: "3000",
      slippageBps: "75",
      index: "1",
    });
    expect((quote as { dryRun?: boolean }).dryRun).toBe(true);

    const execute = await handleWallet({
      action: "swap_execute",
      venue: "jupiter",
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1.25",
      slippageBps: "120",
      wrapUnwrapSol: "true",
      skipPreflight: "true",
    });
    expect((execute as { dryRun?: boolean }).dryRun).toBe(false);

    expect(walletToolMockState.dynamicSwapCalls).toEqual([
      {
        venue: "uniswap_v3",
        tokenOut: "LINK",
        amountEth: "0.5",
        percent: undefined,
        minAmountOut: undefined,
        recipient: undefined,
        feeTier: 3000,
        inputMint: undefined,
        outputMint: undefined,
        amount: undefined,
        amountRaw: undefined,
        index: 1,
        slippageBps: 75,
        deadlineSeconds: undefined,
        rpcUrl: undefined,
        wrapUnwrapSol: undefined,
        computeUnitPriceMicroLamports: undefined,
        skipPreflight: false,
        dryRun: true,
      },
      {
        venue: "jupiter",
        tokenOut: undefined,
        amountEth: undefined,
        percent: undefined,
        minAmountOut: undefined,
        recipient: undefined,
        feeTier: undefined,
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1.25",
        amountRaw: undefined,
        index: 0,
        slippageBps: 120,
        deadlineSeconds: undefined,
        rpcUrl: undefined,
        wrapUnwrapSol: true,
        computeUnitPriceMicroLamports: undefined,
        skipPreflight: true,
        dryRun: false,
      },
    ]);
  });

  test("unknown action returns validation error", async () => {
    await expect(handleWallet({ action: "unsupported_action" })).rejects.toThrow(
      "Validation error: Unknown wallet action: unsupported_action"
    );
  });
});
