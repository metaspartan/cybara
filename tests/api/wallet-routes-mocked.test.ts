import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WalletChain } from "../../src/core/wallet";

const walletMockState = {
  getStatusCalls: 0,
  getRpcCalls: 0,
  getRpcStatusCalls: 0,
  getAgentPolicyCalls: 0,
  setRpcCalls: [] as Array<{ ethRpc?: string; solRpc?: string; btcApi?: string }>,
  setAgentPolicyCalls: [] as Array<{
    allowNativeSend?: boolean;
    allowTokenSend?: boolean;
    allowEthContractWrite?: boolean;
    allowSolProgramInstruction?: boolean;
    allowEthSwaps?: boolean;
    allowedEthContracts?: string[];
    allowedSolPrograms?: string[];
  }>,
  createCalls: [] as string[],
  importCalls: [] as Array<{ mnemonic: string; password: string }>,
  unlockCalls: [] as string[],
  lockCalls: 0,
  accountsCalls: [] as Array<{ chains?: WalletChain[]; count?: number; startIndex?: number }>,
  receiveCalls: [] as Array<{ chain: WalletChain; index: number }>,
  balancesCalls: [] as Array<{ chains?: WalletChain[]; count?: number; startIndex?: number }>,
  tokenBalancesCalls: [] as Array<{ chain: "eth" | "sol"; index?: number; includeZero?: boolean }>,
  tokenTransactionsCalls: [] as Array<{
    chain: "eth" | "sol";
    index?: number;
    limit?: number;
    tokenAddress?: string;
    rpcUrl?: string;
  }>,
  transactionsCalls: [] as Array<{
    chain: WalletChain;
    index?: number;
    limit?: number;
    rpcUrl?: string;
  }>,
  sendCalls: [] as Array<{
    chain: WalletChain;
    to: string;
    amount: string;
    index?: number;
    memo?: string;
    rpcUrl?: string;
    feeRate?: number;
  }>,
  sendTokenCalls: [] as Array<{
    chain: "eth" | "sol";
    tokenAddress: string;
    to: string;
    amount: string;
    index?: number;
    decimals?: number;
    rpcUrl?: string;
    memo?: string;
  }>,
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
    accounts?: Array<{ pubkey: string; isSigner?: boolean; isWritable?: boolean }>;
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
  signCalls: [] as Array<{ message: string; chain: WalletChain; index: number }>,
  deleteCalls: [] as Array<string | undefined>,
  agentAccessCalls: [] as boolean[],
};

mock.module("../../src/core/wallet", () => ({
  walletManager: {
    getStatus: () => {
      walletMockState.getStatusCalls += 1;
      return {
        exists: true,
        unlocked: true,
        agentAccessEnabled: false,
        chains: ["eth", "btc", "sol"],
      };
    },
    getRpcConfig: () => {
      walletMockState.getRpcCalls += 1;
      return {
        ethRpc: "https://eth.example",
        solRpc: "https://sol.example",
        btcApi: "https://btc.example",
      };
    },
    getRpcStatus: async () => {
      walletMockState.getRpcStatusCalls += 1;
      return {
        checkedAt: new Date().toISOString(),
        services: [
          {
            chain: "eth",
            endpoint: "https://eth.example",
            healthy: true,
            latencyMs: 22,
            latestHeight: "22000000",
          },
        ],
      };
    },
    getAgentPolicy: () => {
      walletMockState.getAgentPolicyCalls += 1;
      return {
        allowNativeSend: false,
        allowTokenSend: false,
        allowEthContractWrite: false,
        allowSolProgramInstruction: false,
        allowEthSwaps: false,
        allowedEthContracts: [],
        allowedSolPrograms: [],
      };
    },
    setRpcConfig: (input: { ethRpc?: string; solRpc?: string; btcApi?: string }) => {
      walletMockState.setRpcCalls.push(input);
      return { success: true, config: input };
    },
    setAgentPolicy: (input: {
      allowNativeSend?: boolean;
      allowTokenSend?: boolean;
      allowEthContractWrite?: boolean;
      allowSolProgramInstruction?: boolean;
      allowEthSwaps?: boolean;
      allowedEthContracts?: string[];
      allowedSolPrograms?: string[];
    }) => {
      walletMockState.setAgentPolicyCalls.push(input);
      return {
        success: true,
        policy: {
          allowNativeSend: input.allowNativeSend === true,
          allowTokenSend: input.allowTokenSend === true,
          allowEthContractWrite: input.allowEthContractWrite === true,
          allowSolProgramInstruction: input.allowSolProgramInstruction === true,
          allowEthSwaps: input.allowEthSwaps === true,
          allowedEthContracts: input.allowedEthContracts || [],
          allowedSolPrograms: input.allowedSolPrograms || [],
        },
      };
    },
    createWallet: async (password: string) => {
      walletMockState.createCalls.push(password);
      return {
        success: true,
        mnemonic: "one two three",
        address: "0xabc",
        primaryAddresses: { eth: "0xabc", btc: "bc1", sol: "sol" },
      };
    },
    importWallet: async (mnemonic: string, password: string) => {
      walletMockState.importCalls.push({ mnemonic, password });
      return {
        success: true,
        mnemonic,
        address: "0xabc",
        primaryAddresses: { eth: "0xabc", btc: "bc1", sol: "sol" },
      };
    },
    unlock: async (password: string) => {
      walletMockState.unlockCalls.push(password);
      return {
        success: true,
        address: "0xabc",
        unlockExpiresAt: new Date().toISOString(),
        primaryAddresses: { eth: "0xabc", btc: "bc1", sol: "sol" },
      };
    },
    lock: () => {
      walletMockState.lockCalls += 1;
      return { success: true };
    },
    getAccounts: (query: { chains?: WalletChain[]; count?: number; startIndex?: number }) => {
      walletMockState.accountsCalls.push(query);
      return [{ chain: "eth", index: 0, path: "m/mock", address: "0xabc" }];
    },
    getReceiveAddress: (chain: WalletChain, index = 0) => {
      walletMockState.receiveCalls.push({ chain, index });
      return { chain, index, path: "m/mock", address: `${chain}-addr-${index}` };
    },
    getBalances: async (query: { chains?: WalletChain[]; count?: number; startIndex?: number }) => {
      walletMockState.balancesCalls.push(query);
      return [
        { chain: "eth", index: 0, path: "m/mock", address: "0xabc", symbol: "ETH", amount: "0.1" },
      ];
    },
    getTokenBalances: async (query: {
      chain: "eth" | "sol";
      index?: number;
      includeZero?: boolean;
    }) => {
      walletMockState.tokenBalancesCalls.push(query);
      return [
        {
          chain: query.chain,
          index: query.index || 0,
          address: `${query.chain}-owner`,
          tokenAddress: `${query.chain}-token`,
          symbol: query.chain === "eth" ? "USDC" : "SPL",
          decimals: query.chain === "eth" ? 6 : 9,
          amount: "1.23",
          raw: "1230000",
        },
      ];
    },
    getTokenTransactions: async (query: {
      chain: "eth" | "sol";
      index?: number;
      limit?: number;
      tokenAddress?: string;
      rpcUrl?: string;
    }) => {
      walletMockState.tokenTransactionsCalls.push(query);
      return [
        {
          chain: query.chain,
          index: query.index || 0,
          address: `${query.chain}-owner`,
          tokenAddress: query.tokenAddress || `${query.chain}-token`,
          symbol: query.chain === "eth" ? "USDC" : "SPL",
          decimals: query.chain === "eth" ? 6 : 9,
          txid: `${query.chain}-token-tx-1`,
          status: "confirmed",
          direction: "in",
          amount: "2.0",
          raw: "2000000",
          explorerUrl: "https://exp/token",
        },
      ];
    },
    getTransactions: async (query: {
      chain: WalletChain;
      index?: number;
      limit?: number;
      rpcUrl?: string;
    }) => {
      walletMockState.transactionsCalls.push(query);
      return [{ chain: query.chain, txid: "tx1", status: "confirmed", explorerUrl: "https://exp" }];
    },
    send: async (input: {
      chain: WalletChain;
      to: string;
      amount: string;
      index?: number;
      memo?: string;
      rpcUrl?: string;
      feeRate?: number;
    }) => {
      walletMockState.sendCalls.push(input);
      return { chain: input.chain, txid: "tx123", explorerUrl: "https://exp/tx123" };
    },
    sendToken: async (input: {
      chain: "eth" | "sol";
      tokenAddress: string;
      to: string;
      amount: string;
      index?: number;
      decimals?: number;
      rpcUrl?: string;
      memo?: string;
    }) => {
      walletMockState.sendTokenCalls.push(input);
      return {
        chain: input.chain,
        txid: "tx-token-123",
        explorerUrl: "https://exp/tx-token-123",
        tokenAddress: input.tokenAddress,
      };
    },
    callEthContract: async (input: {
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
      walletMockState.ethContractCalls.push(input);
      return { chain: "eth", readOnly: true, result: "ok" };
    },
    sendSolProgramInstruction: async (input: {
      programId: string;
      keys?: Array<{ pubkey: string; isSigner?: boolean; isWritable?: boolean }>;
      accounts?: Array<{ pubkey: string; isSigner?: boolean; isWritable?: boolean }>;
      dataBase64?: string;
      dataHex?: string;
      dataUtf8?: string;
      index?: number;
      rpcUrl?: string;
      computeUnitLimit?: number;
      computeUnitPriceMicroLamports?: number;
      skipPreflight?: boolean;
    }) => {
      walletMockState.solInstructionCalls.push(input);
      return {
        chain: "sol",
        txid: "sol-inst-123",
        explorerUrl: "https://solscan.io/tx/sol-inst-123",
      };
    },
    swapEthOnUniswap: async (input: {
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
      walletMockState.swapCalls.push(input);
      return {
        chain: "eth",
        dex: "uniswap_v2",
        from: "0xabc",
        toTokenAddress: "0xlink",
        toTokenSymbol: "LINK",
        amountInEth: "0.5",
        amountInWei: "500000000000000000",
        quotedAmountOut: "100",
        quotedAmountOutRaw: "100000000000000000000",
        minAmountOut: "99",
        minAmountOutRaw: "99000000000000000000",
        slippageBps: 100,
        recipient: "0xabc",
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
        dryRun: input.dryRun === true,
        txid: input.dryRun ? undefined : "swap-tx-1",
        explorerUrl: input.dryRun ? undefined : "https://etherscan.io/tx/swap-tx-1",
      };
    },
    signMessage: async (message: string, chain: WalletChain, index: number) => {
      walletMockState.signCalls.push({ message, chain, index });
      return { address: "0xabc", signature: "0xsig" };
    },
    deleteWallet: async (password?: string) => {
      walletMockState.deleteCalls.push(password);
      return { success: true };
    },
    setAgentAccessEnabled: (enabled: boolean) => {
      walletMockState.agentAccessCalls.push(enabled);
      return { success: true, enabled };
    },
  },
}));

let handleRequest: (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; headers: Record<string, string>; body?: unknown }>;

function resetState() {
  walletMockState.getStatusCalls = 0;
  walletMockState.getRpcCalls = 0;
  walletMockState.getRpcStatusCalls = 0;
  walletMockState.getAgentPolicyCalls = 0;
  walletMockState.setRpcCalls = [];
  walletMockState.setAgentPolicyCalls = [];
  walletMockState.createCalls = [];
  walletMockState.importCalls = [];
  walletMockState.unlockCalls = [];
  walletMockState.lockCalls = 0;
  walletMockState.accountsCalls = [];
  walletMockState.receiveCalls = [];
  walletMockState.balancesCalls = [];
  walletMockState.tokenBalancesCalls = [];
  walletMockState.tokenTransactionsCalls = [];
  walletMockState.transactionsCalls = [];
  walletMockState.sendCalls = [];
  walletMockState.sendTokenCalls = [];
  walletMockState.ethContractCalls = [];
  walletMockState.solInstructionCalls = [];
  walletMockState.swapCalls = [];
  walletMockState.signCalls = [];
  walletMockState.deleteCalls = [];
  walletMockState.agentAccessCalls = [];
}

async function api(method: string, path: string, body?: unknown) {
  return await handleRequest({
    method,
    url: `http://localhost:4269${path}`,
    headers: { host: "localhost:4269" },
    body,
  });
}

describe("Wallet route contracts (mocked manager)", () => {
  beforeAll(async () => {
    const routes = await import("../../src/api/routes");
    handleRequest = routes.handleRequest;
  });

  beforeEach(() => {
    resetState();
  });

  test("status/rpc/policy endpoints call wallet manager", async () => {
    const statusRes = await api("GET", "/api/wallet/status");
    expect(statusRes.status).toBe(200);
    expect(walletMockState.getStatusCalls).toBe(1);

    const rpcRes = await api("GET", "/api/wallet/rpc");
    expect(rpcRes.status).toBe(200);
    expect(rpcRes.body).toEqual({
      ethRpc: "https://eth.example",
      solRpc: "https://sol.example",
      btcApi: "https://btc.example",
    });
    expect(walletMockState.getRpcCalls).toBe(1);

    const rpcStatusRes = await api("GET", "/api/wallet/rpc/status");
    expect(rpcStatusRes.status).toBe(200);
    expect(walletMockState.getRpcStatusCalls).toBe(1);

    const policyRes = await api("GET", "/api/wallet/agent-policy");
    expect(policyRes.status).toBe(200);
    expect(walletMockState.getAgentPolicyCalls).toBe(1);
  });

  test("accounts and balances parse query params", async () => {
    const accountsRes = await api(
      "GET",
      "/api/wallet/accounts?chains=eth,btc&count=3&startIndex=2"
    );
    expect(accountsRes.status).toBe(200);
    expect(walletMockState.accountsCalls).toEqual([
      {
        chains: ["eth", "btc"],
        count: 3,
        startIndex: 2,
      },
    ]);

    const balancesRes = await api("GET", "/api/wallet/balances?chains=sol&count=1&startIndex=0");
    expect(balancesRes.status).toBe(200);
    expect(walletMockState.balancesCalls).toEqual([
      {
        chains: ["sol"],
        count: 1,
        startIndex: 0,
      },
    ]);
  });

  test("invalid chain query returns validation error", async () => {
    const res = await api("GET", "/api/wallet/accounts?chains=eth,doge");
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  test("receive, token balances/token tx, transactions, send, sign and agent-access forward payloads", async () => {
    const receiveRes = await api("GET", "/api/wallet/receive?chain=btc&index=4");
    expect(receiveRes.status).toBe(200);
    expect(walletMockState.receiveCalls).toEqual([{ chain: "btc", index: 4 }]);

    const tokenRes = await api("GET", "/api/wallet/tokens?chain=eth&index=2&includeZero=true");
    expect(tokenRes.status).toBe(200);
    expect(walletMockState.tokenBalancesCalls).toEqual([
      {
        chain: "eth",
        index: 2,
        includeZero: true,
      },
    ]);

    const tokenTxRes = await api(
      "GET",
      "/api/wallet/token-transactions?chain=sol&index=2&limit=5&tokenAddress=SoMint&rpcUrl=https://rpc.sol"
    );
    expect(tokenTxRes.status).toBe(200);
    expect(walletMockState.tokenTransactionsCalls).toEqual([
      {
        chain: "sol",
        index: 2,
        limit: 5,
        tokenAddress: "SoMint",
        rpcUrl: "https://rpc.sol",
      },
    ]);

    const txRes = await api(
      "GET",
      "/api/wallet/transactions?chain=sol&index=1&limit=7&rpcUrl=https://rpc"
    );
    expect(txRes.status).toBe(200);
    expect(walletMockState.transactionsCalls).toEqual([
      {
        chain: "sol",
        index: 1,
        limit: 7,
        rpcUrl: "https://rpc",
      },
    ]);

    const sendRes = await api("POST", "/api/wallet/send", {
      chain: "eth",
      to: "0xdef",
      amount: "1.2",
      index: 9,
      memo: "hello",
    });
    expect(sendRes.status).toBe(200);
    expect(walletMockState.sendCalls).toEqual([
      {
        chain: "eth",
        to: "0xdef",
        amount: "1.2",
        index: 9,
        memo: "hello",
        rpcUrl: undefined,
        feeRate: undefined,
      },
    ]);

    const signRes = await api("POST", "/api/wallet/sign", {
      message: "hello",
      chain: "eth",
      index: 3,
    });
    expect(signRes.status).toBe(200);
    expect(walletMockState.signCalls).toEqual([
      {
        message: "hello",
        chain: "eth",
        index: 3,
      },
    ]);

    const agentAccessRes = await api("PUT", "/api/wallet/agent-access", { enabled: true });
    expect(agentAccessRes.status).toBe(200);
    expect(walletMockState.agentAccessCalls).toEqual([true]);
  });

  test("send-token, eth-contract, sol-instruction, and swap routes forward payloads", async () => {
    const sendTokenRes = await api("POST", "/api/wallet/send-token", {
      chain: "sol",
      tokenAddress: "SoMint",
      to: "SoReceiver",
      amount: "1.5",
      index: 1,
      decimals: 9,
      memo: "memo",
    });
    expect(sendTokenRes.status).toBe(200);
    expect(walletMockState.sendTokenCalls).toEqual([
      {
        chain: "sol",
        tokenAddress: "SoMint",
        to: "SoReceiver",
        amount: "1.5",
        index: 1,
        decimals: 9,
        rpcUrl: undefined,
        memo: "memo",
      },
    ]);

    const contractRes = await api("POST", "/api/wallet/eth-contract", {
      contractAddress: "0x0000000000000000000000000000000000000001",
      methodSignature: "totalSupply()",
      args: "[]",
      readOnly: true,
      gasLimit: "210000",
      nonce: "4",
    });
    expect(contractRes.status).toBe(200);
    expect(walletMockState.ethContractCalls).toEqual([
      {
        contractAddress: "0x0000000000000000000000000000000000000001",
        abi: undefined,
        method: "totalSupply()",
        methodSignature: "totalSupply()",
        args: [],
        gasLimit: "210000",
        nonce: 4,
        index: undefined,
        value: undefined,
        readOnly: true,
        rpcUrl: undefined,
      },
    ]);

    const instructionRes = await api("POST", "/api/wallet/sol-instruction", {
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
    expect(instructionRes.status).toBe(200);
    expect(walletMockState.solInstructionCalls).toEqual([
      {
        programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        keys: undefined,
        accounts: [
          { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
        ],
        dataBase64: undefined,
        dataHex: "0x0102",
        dataUtf8: undefined,
        computeUnitLimit: 180000,
        computeUnitPriceMicroLamports: 2000,
        skipPreflight: true,
        index: 0,
        rpcUrl: undefined,
      },
    ]);

    const swapRes = await api("POST", "/api/wallet/swap-eth-uniswap", {
      tokenOut: "LINK",
      percent: 50,
      slippageBps: 120,
      dryRun: true,
      index: 1,
    });
    expect(swapRes.status).toBe(200);
    expect(walletMockState.swapCalls).toEqual([
      {
        tokenOut: "LINK",
        amountEth: undefined,
        percent: 50,
        minAmountOut: undefined,
        slippageBps: 120,
        deadlineSeconds: undefined,
        index: 1,
        recipient: undefined,
        rpcUrl: undefined,
        dryRun: true,
      },
    ]);
  });

  test("create/import/unlock/lock/delete and rpc/policy set call manager methods", async () => {
    const createRes = await api("POST", "/api/wallet/create", { password: "secretpass" });
    expect(createRes.status).toBe(200);
    expect(walletMockState.createCalls).toEqual(["secretpass"]);

    const importRes = await api("POST", "/api/wallet/import", {
      mnemonic: "alpha beta gamma",
      password: "secretpass",
    });
    expect(importRes.status).toBe(200);
    expect(walletMockState.importCalls).toEqual([
      {
        mnemonic: "alpha beta gamma",
        password: "secretpass",
      },
    ]);

    const unlockRes = await api("POST", "/api/wallet/unlock", { password: "secretpass" });
    expect(unlockRes.status).toBe(200);
    expect(walletMockState.unlockCalls).toEqual(["secretpass"]);

    const lockRes = await api("POST", "/api/wallet/lock");
    expect(lockRes.status).toBe(200);
    expect(walletMockState.lockCalls).toBe(1);

    const deleteRes = await api("DELETE", "/api/wallet", { password: "secretpass" });
    expect(deleteRes.status).toBe(200);
    expect(walletMockState.deleteCalls).toEqual(["secretpass"]);

    const rpcRes = await api("PUT", "/api/wallet/rpc", {
      ethRpc: "https://eth.alt",
      solRpc: "https://sol.alt",
      btcApi: "https://btc.alt",
    });
    expect(rpcRes.status).toBe(200);
    expect(walletMockState.setRpcCalls).toEqual([
      {
        ethRpc: "https://eth.alt",
        solRpc: "https://sol.alt",
        btcApi: "https://btc.alt",
      },
    ]);

    const policyRes = await api("PUT", "/api/wallet/agent-policy", {
      allowNativeSend: true,
      allowTokenSend: true,
      allowEthSwaps: true,
      allowedEthContracts: ["0x0000000000000000000000000000000000000001"],
      allowedSolPrograms: ["11111111111111111111111111111111"],
    });
    expect(policyRes.status).toBe(200);
    expect(walletMockState.setAgentPolicyCalls).toEqual([
      {
        allowNativeSend: true,
        allowTokenSend: true,
        allowEthContractWrite: undefined,
        allowSolProgramInstruction: undefined,
        allowEthSwaps: true,
        allowedEthContracts: ["0x0000000000000000000000000000000000000001"],
        allowedSolPrograms: ["11111111111111111111111111111111"],
      },
    ]);
  });
});
