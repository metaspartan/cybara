import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { formatEther, JsonRpcProvider } from "ethers";
import { config } from "./config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./solana-token";
import {
  AGENT_ACCESS_CONFIG_KEY,
  AGENT_POLICY_CONFIG_KEY,
  BTC_API_CONFIG_KEY,
  CHAINLINK_BASE_ASSETS,
  CHAINLINK_DENOMINATION_USD,
  CHAINLINK_FEED_REGISTRY_ETH,
  CHAINLINK_USD_FEEDS,
  ETH_RPC_CONFIG_KEY,
  JUPITER_PRICE_API_BASE,
  JUPITER_PROGRAM_LABELS_API,
  JUPITER_SWAP_API_BASE,
  MEMO_PROGRAM_ID,
  PYTH_HERMES_API_BASE,
  SOL_MINT,
  SOL_RPC_CONFIG_KEY,
  UNISWAP_PERMIT2_ETH,
  UNISWAP_UNIVERSAL_ROUTER_ETH,
  UNISWAP_V2_ROUTER_ETH,
  UNISWAP_V3_QUOTER_LEGACY_ETH,
  UNISWAP_V3_QUOTER_V2_ETH,
  UNISWAP_V3_ROUTER_ETH,
  UNLOCK_TTL_MS,
  USDC_SOL_MINT,
  WETH_MAINNET,
} from "./wallet-base";
import {
  assertWalletChain,
  assertWalletTokenChain,
  formatUnits,
  normalizeCount,
  normalizeMnemonic,
  normalizeStartIndex,
  parseBigIntOrZero,
  parseOptionalNumber,
} from "./wallet-internal";
import { WalletOperations } from "./wallet-operations";
import { assertAmountWithinCap, assertRecipientAllowed } from "./wallet-policy";
import { checkWalletRpcStatus } from "./wallet-rpc-health";
import { fetchWalletJson } from "./wallet-runtime";
import {
  type AccountsQuery,
  type EthContractCallInput,
  type SolInstructionAccountMeta,
  type SolProgramInstructionInput,
  SUPPORTED_CHAINS,
  type TokenBalancesQuery,
  type TokenTransactionsQuery,
  type TransactionsQuery,
  type WalletAccount,
  type WalletAgentPolicy,
  type WalletBalance,
  type WalletChain,
  type WalletDappAdapter,
  type WalletDappAdapterCapability,
  type WalletDappCallInput,
  type WalletDappDirectory,
  type WalletEndpointDirectory,
  type WalletPriceQuoteInput,
  type WalletPriceQuoteResult,
  type WalletPriceSource,
  type WalletRpcCallInput,
  type WalletRpcCallResult,
  type WalletRpcServiceStatus,
  type WalletRpcStatus,
  type WalletSendInput,
  type WalletSendResult,
  type WalletSendTokenInput,
  type WalletStatus,
  type WalletSwapEthUniswapInput,
  type WalletSwapEthUniswapResult,
  type WalletSwapInput,
  type WalletSwapResult,
  type WalletSwapVenue,
  type WalletTokenBalance,
  type WalletTokenChain,
  type WalletTokenTransaction,
  type WalletTransaction,
  type WalletX402RequestInput,
  type WalletX402RequestResult,
} from "./wallet-types";
import {
  decryptWalletMnemonic,
  deleteWalletVault,
  readWalletVault,
  validateWalletMnemonic,
  validateWalletPassword,
  writeWalletVault,
} from "./wallet-vault";

class WalletManager extends WalletOperations {
  getStatus(): WalletStatus {
    const vault = readWalletVault();
    const unlocked = this.getUnlockedState();
    const primaryAddresses = unlocked?.primaryAddresses || vault?.primaryAddresses;

    return {
      exists: !!vault,
      unlocked: !!unlocked,
      address: primaryAddresses?.eth || vault?.address,
      createdAt: vault?.createdAt,
      updatedAt: vault?.updatedAt,
      unlockExpiresAt: unlocked ? new Date(unlocked.expiresAtMs).toISOString() : undefined,
      wordCount: vault?.wordCount,
      kdf: vault
        ? {
            name: vault.kdf.name,
            hash: vault.kdf.hash,
            iterations: vault.kdf.iterations,
          }
        : undefined,
      agentAccessEnabled: this.isAgentAccessEnabled(),
      chains: SUPPORTED_CHAINS,
      primaryAddresses,
    };
  }

  async createWallet(password: string): Promise<{
    success: boolean;
    mnemonic: string;
    address: string;
    primaryAddresses: Record<WalletChain, string>;
  }> {
    validateWalletPassword(password);

    if (readWalletVault()) {
      throw new Error("Wallet already exists");
    }

    const mnemonic = generateMnemonic(wordlist, 256);
    return await this.storeMnemonic(mnemonic, password);
  }

  async importWallet(
    mnemonicInput: string,
    password: string
  ): Promise<{
    success: boolean;
    mnemonic: string;
    address: string;
    primaryAddresses: Record<WalletChain, string>;
  }> {
    validateWalletPassword(password);

    if (readWalletVault()) {
      throw new Error("Wallet already exists");
    }

    const mnemonic = normalizeMnemonic(mnemonicInput);
    validateWalletMnemonic(mnemonic);

    return await this.storeMnemonic(mnemonic, password);
  }

  async unlock(password: string): Promise<{
    success: boolean;
    address: string;
    primaryAddresses: Record<WalletChain, string>;
    unlockExpiresAt: string;
  }> {
    validateWalletPassword(password);

    const vault = readWalletVault();
    if (!vault) {
      throw new Error("Validation error: Wallet not found");
    }

    const mnemonic = await decryptWalletMnemonic(vault, password);
    const primaryAddresses = this.getPrimaryAddresses(mnemonic);
    const expiresAtMs = Date.now() + UNLOCK_TTL_MS;
    this.unlockedState = { mnemonic, primaryAddresses, expiresAtMs };

    if (
      !vault.primaryAddresses ||
      vault.primaryAddresses.eth !== primaryAddresses.eth ||
      (primaryAddresses.btc && vault.primaryAddresses.btc !== primaryAddresses.btc) ||
      vault.primaryAddresses.sol !== primaryAddresses.sol
    ) {
      writeWalletVault({
        ...vault,
        address: primaryAddresses.eth,
        primaryAddresses,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      address: primaryAddresses.eth,
      primaryAddresses,
      unlockExpiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async revealMnemonic(password: string): Promise<{ mnemonic: string; wordCount: number }> {
    validateWalletPassword(password);
    const vault = readWalletVault();
    if (!vault) {
      throw new Error("Validation error: Wallet not found");
    }
    const mnemonic = await decryptWalletMnemonic(vault, password);
    return { mnemonic, wordCount: mnemonic.split(/\s+/).length };
  }

  lock(): { success: boolean } {
    this.unlockedState = null;
    return { success: true };
  }

  async deleteWallet(password?: string): Promise<{ success: boolean }> {
    const vault = readWalletVault();
    if (!vault) {
      return { success: true };
    }

    if (password && password.trim()) {
      await decryptWalletMnemonic(vault, password);
    } else if (!this.getUnlockedState()) {
      throw new Error("Validation error: Password required to delete wallet");
    }

    deleteWalletVault();
    this.unlockedState = null;
    config.set(AGENT_ACCESS_CONFIG_KEY, false);
    config.set(AGENT_POLICY_CONFIG_KEY, this.getDefaultAgentPolicy());
    return { success: true };
  }

  setAgentAccessEnabled(enabled: boolean): { success: boolean; enabled: boolean } {
    const value = enabled === true;
    config.set(AGENT_ACCESS_CONFIG_KEY, value);
    if (value && !config.get<WalletAgentPolicy>(AGENT_POLICY_CONFIG_KEY)) {
      config.set(AGENT_POLICY_CONFIG_KEY, this.getDefaultAgentPolicy());
    }
    return { success: true, enabled: value };
  }

  isAgentAccessEnabled(): boolean {
    return config.get<boolean>(AGENT_ACCESS_CONFIG_KEY) === true;
  }

  getAgentPolicy(): WalletAgentPolicy {
    const stored = config.get<Partial<WalletAgentPolicy>>(AGENT_POLICY_CONFIG_KEY);
    return this.normalizeAgentPolicy(stored || {});
  }

  setAgentPolicy(input: Partial<WalletAgentPolicy>): {
    success: boolean;
    policy: WalletAgentPolicy;
  } {
    const current = this.getAgentPolicy();
    const next = this.normalizeAgentPolicy(
      {
        allowNativeSend: input.allowNativeSend ?? current.allowNativeSend,
        allowTokenSend: input.allowTokenSend ?? current.allowTokenSend,
        allowEthContractWrite: input.allowEthContractWrite ?? current.allowEthContractWrite,
        allowSolProgramInstruction:
          input.allowSolProgramInstruction ?? current.allowSolProgramInstruction,
        allowEthSwaps: input.allowEthSwaps ?? current.allowEthSwaps,
        allowDappInteraction: input.allowDappInteraction ?? current.allowDappInteraction,
        allowX402Payments: input.allowX402Payments ?? current.allowX402Payments,
        allowedEthContracts: input.allowedEthContracts ?? current.allowedEthContracts,
        allowedSolPrograms: input.allowedSolPrograms ?? current.allowedSolPrograms,
        allowedDappHosts: input.allowedDappHosts ?? current.allowedDappHosts,
        allowedX402Networks: input.allowedX402Networks ?? current.allowedX402Networks,
        x402MaxAmountAtomic: input.x402MaxAmountAtomic ?? current.x402MaxAmountAtomic,
        allowedSendRecipients: input.allowedSendRecipients ?? current.allowedSendRecipients,
        maxSendAmount: input.maxSendAmount ?? current.maxSendAmount,
      },
      true
    );
    config.set(AGENT_POLICY_CONFIG_KEY, next);
    return { success: true, policy: next };
  }

  setRpcConfig(input: { ethRpc?: string; solRpc?: string; btcApi?: string }): {
    success: boolean;
    config: { ethRpc: string; solRpc: string; btcApi: string };
  } {
    if (input.ethRpc !== undefined) {
      this.validateHttpUrl(input.ethRpc, "ETH RPC URL");
      config.set(ETH_RPC_CONFIG_KEY, input.ethRpc.trim());
    }
    if (input.solRpc !== undefined) {
      this.validateHttpUrl(input.solRpc, "SOL RPC URL");
      config.set(SOL_RPC_CONFIG_KEY, input.solRpc.trim());
    }
    if (input.btcApi !== undefined) {
      this.validateHttpUrl(input.btcApi, "BTC API URL");
      config.set(BTC_API_CONFIG_KEY, this.normalizeBtcApiBase(input.btcApi));
    }

    return {
      success: true,
      config: this.getRpcConfig(),
    };
  }

  getRpcConfig(): { ethRpc: string; solRpc: string; btcApi: string } {
    return {
      ethRpc: this.getEthRpc(),
      solRpc: this.getSolRpc(),
      btcApi: this.getBtcApiBase(),
    };
  }

  async getRpcStatus(): Promise<WalletRpcStatus> {
    return checkWalletRpcStatus(this.getRpcConfig());
  }

  getAgentAddress(): {
    address: string;
    primaryAddresses: Record<WalletChain, string>;
    unlockExpiresAt: string;
  } {
    this.assertAgentAccessEnabled();
    const unlocked = this.requireUnlocked();
    return {
      address: unlocked.primaryAddresses.eth,
      primaryAddresses: unlocked.primaryAddresses,
      unlockExpiresAt: new Date(unlocked.expiresAtMs).toISOString(),
    };
  }

  getStatusForAgent(): WalletStatus {
    this.assertAgentAccessEnabled();
    return this.getStatus();
  }

  async signMessageForAgent(
    message: string,
    chain: WalletChain = "eth",
    index = 0
  ): Promise<{ address: string; signature: string }> {
    this.assertAgentAccessEnabled();
    return await this.signMessage(message, chain, index);
  }

  getAccountsForAgent(query?: AccountsQuery): WalletAccount[] {
    this.assertAgentAccessEnabled();
    return this.getAccounts(query);
  }

  async getBalancesForAgent(query?: AccountsQuery): Promise<WalletBalance[]> {
    this.assertAgentAccessEnabled();
    return await this.getBalances(query);
  }

  async getTransactionsForAgent(query: TransactionsQuery): Promise<WalletTransaction[]> {
    this.assertAgentAccessEnabled();
    return await this.getTransactions(query);
  }

  async getTokenBalancesForAgent(query: TokenBalancesQuery): Promise<WalletTokenBalance[]> {
    this.assertAgentAccessEnabled();
    return await this.getTokenBalances(query);
  }

  async getTokenTransactionsForAgent(
    query: TokenTransactionsQuery
  ): Promise<WalletTokenTransaction[]> {
    this.assertAgentAccessEnabled();
    return await this.getTokenTransactions(query);
  }

  getReceiveAddressForAgent(chain: WalletChain, index = 0): WalletAccount {
    this.assertAgentAccessEnabled();
    return this.getReceiveAddress(chain, index);
  }

  private assertAgentSendWithinPolicy(to: string, amount: string, policy: WalletAgentPolicy): void {
    const recipient = String(to || "").trim();
    if (policy.allowedSendRecipients.length > 0) {
      const allow = policy.allowedSendRecipients.map((a) => a.trim().toLowerCase());
      if (!recipient || !allow.includes(recipient.toLowerCase())) {
        throw new Error(
          "Validation error: Recipient is not in the agent send allowlist (wallet policy)"
        );
      }
    }
    assertAmountWithinCap(amount, policy);
  }

  private assertAgentAmountWithinCap(amount: string | undefined, policy: WalletAgentPolicy): void {
    assertAmountWithinCap(amount, policy);
  }

  private assertAgentRecipientAllowed(
    recipient: string | undefined,
    policy: WalletAgentPolicy
  ): void {
    assertRecipientAllowed(recipient, policy);
  }

  async sendForAgent(input: WalletSendInput): Promise<WalletSendResult> {
    this.assertAgentAccessEnabled();
    const policy = this.getAgentPolicy();
    if (!policy.allowNativeSend) {
      throw new Error("Validation error: Agent native sends are disabled by wallet policy");
    }
    this.assertAgentSendWithinPolicy(input.to, input.amount, policy);
    return await this.send(input);
  }

  async sendTokenForAgent(
    input: WalletSendTokenInput
  ): Promise<WalletSendResult & { tokenAddress: string }> {
    this.assertAgentAccessEnabled();
    const policy = this.getAgentPolicy();
    if (!policy.allowTokenSend) {
      throw new Error("Validation error: Agent token sends are disabled by wallet policy");
    }
    this.assertAgentSendWithinPolicy(input.to, input.amount, policy);
    return await this.sendToken(input);
  }

  async callEthContractForAgent(input: EthContractCallInput): Promise<unknown> {
    this.assertAgentAccessEnabled();
    const contractAddress = String(input.contractAddress || "")
      .trim()
      .toLowerCase();
    const readOnly = input.readOnly === true;
    const policy = this.getAgentPolicy();

    if (!readOnly && !policy.allowEthContractWrite) {
      throw new Error("Validation error: Agent ETH contract writes are disabled by wallet policy");
    }
    if (
      !readOnly &&
      policy.allowedEthContracts.length > 0 &&
      !policy.allowedEthContracts.includes(contractAddress)
    ) {
      throw new Error("Validation error: Contract address is not allowlisted for agent writes");
    }
    if (!readOnly && input.value !== undefined) {
      this.assertAgentAmountWithinCap(String(input.value), policy);
    }

    return await this.callEthContract(input);
  }

  async sendSolInstructionForAgent(
    input: SolProgramInstructionInput
  ): Promise<{ chain: "sol"; txid: string; explorerUrl: string }> {
    this.assertAgentAccessEnabled();
    const programId = String(input.programId || "").trim();
    const policy = this.getAgentPolicy();
    if (!policy.allowSolProgramInstruction) {
      throw new Error(
        "Validation error: Agent Solana program instructions are disabled by wallet policy"
      );
    }
    if (policy.allowedSolPrograms.length > 0 && !policy.allowedSolPrograms.includes(programId)) {
      throw new Error("Validation error: Solana program is not allowlisted for agent writes");
    }
    return await this.sendSolProgramInstruction(input);
  }

  async swapEthOnUniswapForAgent(
    input: WalletSwapEthUniswapInput
  ): Promise<WalletSwapEthUniswapResult> {
    this.assertAgentAccessEnabled();
    const policy = this.getAgentPolicy();
    if (!policy.allowEthSwaps) {
      throw new Error("Validation error: Agent ETH swaps are disabled by wallet policy");
    }
    this.assertAgentRecipientAllowed(input.recipient, policy);
    this.assertAgentAmountWithinCap(input.amountEth, policy);
    return await this.swapEthOnUniswap(input);
  }

  async getPriceQuoteForAgent(input: WalletPriceQuoteInput): Promise<WalletPriceQuoteResult> {
    this.assertAgentAccessEnabled();
    return await this.getPriceQuote(input);
  }

  getEndpointDirectoryForAgent(): WalletEndpointDirectory {
    this.assertAgentAccessEnabled();
    return this.getEndpointDirectory();
  }

  getDappDirectoryForAgent(): WalletDappDirectory {
    this.assertAgentAccessEnabled();
    return this.getDappDirectory();
  }

  async rpcCallForAgent(input: WalletRpcCallInput): Promise<WalletRpcCallResult> {
    this.assertAgentAccessEnabled();
    return await this.rpcCall(input);
  }

  async x402RequestForAgent(input: WalletX402RequestInput): Promise<WalletX402RequestResult> {
    this.assertAgentAccessEnabled();
    const policy = this.getAgentPolicy();
    if (!policy.allowX402Payments) {
      throw new Error("Validation error: Agent x402 payments are disabled by wallet policy");
    }
    this.assertAgentUrlAllowedByPolicy(input.url, policy, "x402");
    if (policy.allowedX402Networks.length > 0 && !input.network) {
      throw new Error(
        "Validation error: x402 network is required by wallet policy (allowedX402Networks)"
      );
    }
    if (
      policy.allowedX402Networks.length > 0 &&
      input.network &&
      !policy.allowedX402Networks.includes(input.network.toLowerCase())
    ) {
      throw new Error(
        "Validation error: Requested x402 network is not allowlisted by wallet policy"
      );
    }
    return await this.x402Request({
      ...input,
      maxAmountAtomic: input.maxAmountAtomic || policy.x402MaxAmountAtomic,
    });
  }

  async executeDappForAgent(input: WalletDappCallInput): Promise<unknown> {
    this.assertAgentAccessEnabled();
    const policy = this.getAgentPolicy();
    if (!policy.allowDappInteraction) {
      throw new Error("Validation error: Agent dapp interactions are disabled by wallet policy");
    }

    const adapter = this.normalizeDappAdapter(input.adapter);
    const payload = input.payload || {};
    switch (adapter) {
      case "eth_contract_call": {
        const contractAddress = String(payload.contractAddress || "")
          .trim()
          .toLowerCase();
        const readOnly = payload.readOnly === true;
        if (!readOnly && !policy.allowEthContractWrite) {
          throw new Error(
            "Validation error: Agent ETH contract writes are disabled by wallet policy"
          );
        }
        if (
          !readOnly &&
          policy.allowedEthContracts.length > 0 &&
          !policy.allowedEthContracts.includes(contractAddress)
        ) {
          throw new Error("Validation error: Contract address is not allowlisted for agent writes");
        }
        if (!readOnly && typeof payload.value === "string" && payload.value.trim()) {
          this.assertAgentAmountWithinCap(payload.value, policy);
        }
        return await this.callEthContract({
          contractAddress: String(payload.contractAddress || ""),
          abi: typeof payload.abi === "string" ? payload.abi : undefined,
          method: String(payload.method || payload.methodSignature || ""),
          methodSignature:
            typeof payload.methodSignature === "string" ? payload.methodSignature : undefined,
          args: Array.isArray(payload.args) ? payload.args : [],
          index: parseOptionalNumber(payload.index),
          value: typeof payload.value === "string" ? payload.value : undefined,
          gasLimit:
            typeof payload.gasLimit === "number" || typeof payload.gasLimit === "string"
              ? (payload.gasLimit as number | string)
              : undefined,
          gasPriceGwei: typeof payload.gasPriceGwei === "string" ? payload.gasPriceGwei : undefined,
          maxFeePerGasGwei:
            typeof payload.maxFeePerGasGwei === "string" ? payload.maxFeePerGasGwei : undefined,
          maxPriorityFeePerGasGwei:
            typeof payload.maxPriorityFeePerGasGwei === "string"
              ? payload.maxPriorityFeePerGasGwei
              : undefined,
          nonce: parseOptionalNumber(payload.nonce),
          readOnly,
          rpcUrl: typeof payload.rpcUrl === "string" ? payload.rpcUrl : undefined,
        });
      }
      case "sol_program_instruction": {
        const programId = String(payload.programId || "").trim();
        if (!policy.allowSolProgramInstruction) {
          throw new Error(
            "Validation error: Agent Solana program instructions are disabled by wallet policy"
          );
        }
        if (
          policy.allowedSolPrograms.length > 0 &&
          !policy.allowedSolPrograms.includes(programId)
        ) {
          throw new Error("Validation error: Solana program is not allowlisted for agent writes");
        }
        return await this.sendSolProgramInstruction({
          programId,
          keys: Array.isArray(payload.keys)
            ? (payload.keys as SolInstructionAccountMeta[])
            : Array.isArray(payload.accounts)
              ? (payload.accounts as SolInstructionAccountMeta[])
              : [],
          dataBase64: typeof payload.dataBase64 === "string" ? payload.dataBase64 : undefined,
          dataHex: typeof payload.dataHex === "string" ? payload.dataHex : undefined,
          dataUtf8: typeof payload.dataUtf8 === "string" ? payload.dataUtf8 : undefined,
          index: parseOptionalNumber(payload.index),
          rpcUrl: typeof payload.rpcUrl === "string" ? payload.rpcUrl : undefined,
          computeUnitLimit: parseOptionalNumber(payload.computeUnitLimit),
          computeUnitPriceMicroLamports: parseOptionalNumber(payload.computeUnitPriceMicroLamports),
          skipPreflight: payload.skipPreflight === true,
        });
      }
      case "swap": {
        const dryRun = payload.dryRun === true;
        if (!dryRun && !policy.allowEthSwaps) {
          throw new Error("Validation error: Agent swaps are disabled by wallet policy");
        }
        if (!dryRun) {
          this.assertAgentRecipientAllowed(
            typeof payload.recipient === "string" ? payload.recipient : undefined,
            policy
          );
          this.assertAgentAmountWithinCap(
            typeof payload.amountEth === "string"
              ? payload.amountEth
              : typeof payload.amount === "string"
                ? payload.amount
                : undefined,
            policy
          );
        }
        return await this.swap({
          venue: String(payload.venue || "uniswap_v3"),
          tokenOut: typeof payload.tokenOut === "string" ? payload.tokenOut : undefined,
          amountEth: typeof payload.amountEth === "string" ? payload.amountEth : undefined,
          percent: parseOptionalNumber(payload.percent),
          minAmountOut: typeof payload.minAmountOut === "string" ? payload.minAmountOut : undefined,
          recipient: typeof payload.recipient === "string" ? payload.recipient : undefined,
          feeTier: parseOptionalNumber(payload.feeTier),
          inputMint: typeof payload.inputMint === "string" ? payload.inputMint : undefined,
          outputMint: typeof payload.outputMint === "string" ? payload.outputMint : undefined,
          amount: typeof payload.amount === "string" ? payload.amount : undefined,
          amountRaw: typeof payload.amountRaw === "string" ? payload.amountRaw : undefined,
          index: parseOptionalNumber(payload.index),
          slippageBps: parseOptionalNumber(payload.slippageBps),
          deadlineSeconds: parseOptionalNumber(payload.deadlineSeconds),
          rpcUrl: typeof payload.rpcUrl === "string" ? payload.rpcUrl : undefined,
          wrapUnwrapSol:
            typeof payload.wrapUnwrapSol === "boolean" ? payload.wrapUnwrapSol : undefined,
          computeUnitPriceMicroLamports: parseOptionalNumber(payload.computeUnitPriceMicroLamports),
          skipPreflight: payload.skipPreflight === true,
          dryRun,
        });
      }
      case "x402_http":
        return await this.x402RequestForAgent({
          url: String(payload.url || ""),
          method: typeof payload.method === "string" ? payload.method : undefined,
          headers:
            payload.headers && typeof payload.headers === "object"
              ? (payload.headers as Record<string, string>)
              : undefined,
          body: payload.body,
          network: typeof payload.network === "string" ? payload.network : undefined,
          maxAmountAtomic:
            typeof payload.maxAmountAtomic === "string" ? payload.maxAmountAtomic : undefined,
          index: parseOptionalNumber(payload.index),
          timeoutMs: parseOptionalNumber(payload.timeoutMs),
          dryRun: payload.dryRun === true,
          parseJsonResponse:
            typeof payload.parseJsonResponse === "boolean" ? payload.parseJsonResponse : undefined,
        });
      case "price":
        return await this.getPriceQuote({
          source:
            payload.source === "auto" ||
            payload.source === "chainlink" ||
            payload.source === "pyth" ||
            payload.source === "jupiter"
              ? payload.source
              : undefined,
          symbol: typeof payload.symbol === "string" ? payload.symbol : undefined,
          pair: typeof payload.pair === "string" ? payload.pair : undefined,
          feedAddress: typeof payload.feedAddress === "string" ? payload.feedAddress : undefined,
          pythFeedId: typeof payload.pythFeedId === "string" ? payload.pythFeedId : undefined,
          mint: typeof payload.mint === "string" ? payload.mint : undefined,
          quoteCurrency:
            typeof payload.quoteCurrency === "string" ? payload.quoteCurrency : undefined,
          rpcUrl: typeof payload.rpcUrl === "string" ? payload.rpcUrl : undefined,
        });
      case "rpc_call":
        return await this.rpcCall({
          chain: payload.chain === "sol" ? "sol" : "eth",
          method: String(payload.method || ""),
          params: Array.isArray(payload.params) ? payload.params : [],
          rpcUrl: typeof payload.rpcUrl === "string" ? payload.rpcUrl : undefined,
          id:
            typeof payload.id === "string" || typeof payload.id === "number"
              ? payload.id
              : undefined,
        });
      default:
        throw new Error(
          `Validation error: Unsupported dapp adapter '${String(input.adapter || "")}'`
        );
    }
  }

  async swapForAgent(input: WalletSwapInput): Promise<WalletSwapResult> {
    this.assertAgentAccessEnabled();
    if (input.dryRun !== true) {
      const policy = this.getAgentPolicy();
      if (!policy.allowEthSwaps) {
        throw new Error("Validation error: Agent swaps are disabled by wallet policy");
      }
      this.assertAgentRecipientAllowed(input.recipient, policy);
      this.assertAgentAmountWithinCap(input.amountEth ?? input.amount, policy);
    }
    return await this.swap(input);
  }

  getEndpointDirectory(): WalletEndpointDirectory {
    return {
      ethereum: {
        wrappedNative: WETH_MAINNET,
        dex: {
          uniswapV2Router: UNISWAP_V2_ROUTER_ETH,
          uniswapV3Router02: UNISWAP_V3_ROUTER_ETH,
          uniswapV3QuoterV2: UNISWAP_V3_QUOTER_V2_ETH,
          uniswapV3QuoterLegacy: UNISWAP_V3_QUOTER_LEGACY_ETH,
          uniswapUniversalRouter: UNISWAP_UNIVERSAL_ROUTER_ETH,
          permit2: UNISWAP_PERMIT2_ETH,
        },
        oracles: {
          chainlinkFeedRegistry: CHAINLINK_FEED_REGISTRY_ETH,
          usdDenomination: CHAINLINK_DENOMINATION_USD,
          chainlinkUsdFeeds: { ...CHAINLINK_USD_FEEDS },
          chainlinkBaseAssets: { ...CHAINLINK_BASE_ASSETS },
        },
      },
      solana: {
        nativeMint: SOL_MINT,
        commonMints: {
          SOL: SOL_MINT,
          USDC: USDC_SOL_MINT,
          USDT: "Es9vMFrzaCERmJfr8j7Xw4eE3f7zQht4p59SJ4f5kL7Q",
        },
        programs: {
          systemProgram: SystemProgram.programId.toBase58(),
          tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
          token2022Program: TOKEN_2022_PROGRAM_ID.toBase58(),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
          memoProgram: MEMO_PROGRAM_ID.toBase58(),
        },
      },
      services: {
        pythHermes: PYTH_HERMES_API_BASE,
        jupiterPriceApi: JUPITER_PRICE_API_BASE,
        jupiterSwapApi: JUPITER_SWAP_API_BASE,
        jupiterProgramLabelsApi: JUPITER_PROGRAM_LABELS_API,
      },
    };
  }

  getDappDirectory(): WalletDappDirectory {
    return {
      adapters: [
        {
          adapter: "rpc_call",
          chain: "multi",
          write: false,
          description: "Direct JSON-RPC call to ETH/SOL nodes for dynamic on-chain reads",
        },
        {
          adapter: "eth_contract_call",
          chain: "eth",
          write: true,
          description:
            "Dynamic EVM smart contract calls/writes with ABI + method signature support",
        },
        {
          adapter: "sol_program_instruction",
          chain: "sol",
          write: true,
          description: "Dynamic Solana program instruction execution with custom account metas",
        },
        {
          adapter: "swap",
          chain: "multi",
          write: true,
          description: "Dynamic swap routing via Uniswap v2/v3 and Jupiter",
        },
        {
          adapter: "price",
          chain: "multi",
          write: false,
          description: "Price lookup via Chainlink/Pyth/Jupiter sources",
        },
        {
          adapter: "x402_http",
          chain: "multi",
          write: true,
          description:
            "HTTP call with automatic x402 payment-required handling for EVM (EIP-3009 + Permit2) and Solana",
        },
      ],
      notes: [
        "x402 uses official @x402 clients with exact scheme support across EVM and Solana",
        "EVM flows support both eip3009 and permit2 assetTransferMethod values when provided by merchant requirements",
      ],
    };
  }

  getAccounts(query?: AccountsQuery): WalletAccount[] {
    const unlocked = this.requireUnlocked();
    const chains = query?.chains?.length
      ? query.chains.map((chain) => assertWalletChain(String(chain)))
      : SUPPORTED_CHAINS;
    const count = normalizeCount(query?.count);
    const startIndex = normalizeStartIndex(query?.startIndex);

    const accounts: WalletAccount[] = [];
    for (const chain of chains) {
      for (let offset = 0; offset < count; offset++) {
        const index = startIndex + offset;
        try {
          accounts.push(this.deriveAccount(chain, index, unlocked.mnemonic));
        } catch {
          break;
        }
      }
    }

    return accounts;
  }

  getReceiveAddress(chain: WalletChain, index = 0): WalletAccount {
    const unlocked = this.requireUnlocked();
    return this.deriveAccount(
      assertWalletChain(String(chain)),
      Math.max(0, Math.floor(index)),
      unlocked.mnemonic
    );
  }

  async getBalances(query?: AccountsQuery): Promise<WalletBalance[]> {
    const accounts = this.getAccounts(query);

    return await Promise.all(
      accounts.map(async (account) => {
        switch (account.chain) {
          case "eth": {
            const provider = new JsonRpcProvider(this.getEthRpc());
            const wei = await provider.getBalance(account.address);
            return {
              ...account,
              symbol: "ETH" as const,
              decimals: 18,
              amount: formatEther(wei),
              raw: wei.toString(),
            };
          }
          case "sol": {
            const connection = new Connection(this.getSolRpc(), "confirmed");
            const lamports = await connection.getBalance(
              new PublicKey(account.address),
              "confirmed"
            );
            return {
              ...account,
              symbol: "SOL" as const,
              decimals: 9,
              amount: formatUnits(BigInt(lamports), 9),
              raw: String(lamports),
            };
          }
          case "btc": {
            const payload = await fetchWalletJson<{
              chain_stats?: {
                funded_txo_sum?: number;
                spent_txo_sum?: number;
              };
              mempool_stats?: {
                funded_txo_sum?: number;
                spent_txo_sum?: number;
              };
            }>(`${this.getBtcApiBase()}/address/${account.address}`);

            const fundedChain = BigInt(payload.chain_stats?.funded_txo_sum || 0);
            const spentChain = BigInt(payload.chain_stats?.spent_txo_sum || 0);
            const fundedMempool = BigInt(payload.mempool_stats?.funded_txo_sum || 0);
            const spentMempool = BigInt(payload.mempool_stats?.spent_txo_sum || 0);

            const sats = fundedChain - spentChain + fundedMempool - spentMempool;
            return {
              ...account,
              symbol: "BTC" as const,
              decimals: 8,
              amount: formatUnits(sats, 8),
              raw: sats.toString(),
            };
          }
          default:
            throw new Error(`Validation error: Unsupported chain '${account.chain}'`);
        }
      })
    );
  }

  async getTokenBalances(query: TokenBalancesQuery): Promise<WalletTokenBalance[]> {
    const chain = assertWalletTokenChain(query.chain);
    const index = normalizeStartIndex(query.index);
    const includeZero = query.includeZero === true;
    const account = this.getReceiveAddress(chain, index);

    if (chain === "eth") {
      const payload = await fetchWalletJson<
        Array<{
          value?: string;
          token?: {
            address?: string;
            symbol?: string;
            name?: string;
            decimals?: string | number;
            type?: string;
          };
        }>
      >(`https://eth.blockscout.com/api/v2/addresses/${account.address}/token-balances`);

      return (payload || [])
        .map((entry) => {
          const tokenAddress = String(entry.token?.address || "").trim();
          const decimals = Math.max(
            0,
            Math.min(36, Number(String(entry.token?.decimals ?? "18")) || 18)
          );
          const raw = String(entry.value || "0");
          const rawValue = BigInt(raw);
          return {
            chain: "eth" as const,
            index: account.index,
            address: account.address,
            tokenAddress,
            symbol: String(entry.token?.symbol || "ERC20"),
            name: entry.token?.name,
            decimals,
            amount: formatUnits(rawValue, decimals),
            raw,
          };
        })
        .filter((item) => item.tokenAddress && (includeZero || BigInt(item.raw) > 0n));
    }

    const connection = new Connection(this.getSolRpc(), "confirmed");
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(account.address),
      { programId: TOKEN_PROGRAM_ID },
      "confirmed"
    );

    return tokenAccounts.value
      .map((entry) => {
        const parsed = entry.account.data.parsed;
        const info = parsed?.info as {
          mint?: string;
          tokenAmount?: {
            amount?: string;
            decimals?: number;
            uiAmountString?: string;
          };
        };
        const mint = String(info?.mint || "").trim();
        const decimals = Number(info?.tokenAmount?.decimals || 0);
        const raw = String(info?.tokenAmount?.amount || "0");
        const rawValue = BigInt(raw);
        const symbol = mint ? `SPL-${mint.slice(0, 4).toUpperCase()}` : "SPL";

        return {
          chain: "sol" as const,
          index: account.index,
          address: account.address,
          tokenAddress: mint,
          symbol,
          name: mint ? `SPL Token ${mint.slice(0, 6)}...` : "SPL Token",
          decimals,
          amount: formatUnits(rawValue, decimals),
          raw,
          tokenAccount: entry.pubkey.toBase58(),
        };
      })
      .filter((item) => item.tokenAddress && (includeZero || BigInt(item.raw) > 0n));
  }

  async getTokenTransactions(query: TokenTransactionsQuery): Promise<WalletTokenTransaction[]> {
    const chain = assertWalletTokenChain(query.chain);
    const index = normalizeStartIndex(query.index);
    const limit = Math.min(100, Math.max(1, Math.floor(query.limit || 20)));
    const tokenFilter = String(query.tokenAddress || "")
      .trim()
      .toLowerCase();
    const account = this.getReceiveAddress(chain, index);
    const ownerLower = account.address.toLowerCase();

    if (chain === "eth") {
      const payload = await fetchWalletJson<{
        items?: Array<{
          block_number?: number;
          timestamp?: string;
          transaction_hash?: string;
          from?: { hash?: string };
          to?: { hash?: string };
          token?: {
            address_hash?: string;
            symbol?: string;
            name?: string;
            decimals?: string | number;
          };
          total?: {
            value?: string;
            decimals?: string | number;
          };
        }>;
      }>(
        `https://eth.blockscout.com/api/v2/addresses/${account.address}/token-transfers?type=ERC-20`
      );

      const txs = (payload.items || [])
        .map((item) => {
          const tokenAddress = String(item.token?.address_hash || "").trim();
          const from = String(item.from?.hash || "").trim();
          const to = String(item.to?.hash || "").trim();
          const fromLower = from.toLowerCase();
          const toLower = to.toLowerCase();
          const direction: WalletTokenTransaction["direction"] =
            fromLower === ownerLower && toLower === ownerLower
              ? "self"
              : toLower === ownerLower
                ? "in"
                : fromLower === ownerLower
                  ? "out"
                  : "unknown";
          const decimals = Math.max(
            0,
            Math.min(36, Number(String(item.total?.decimals ?? item.token?.decimals ?? "18")) || 18)
          );
          const raw = String(item.total?.value || "0");
          const rawValue = parseBigIntOrZero(raw);
          const txid = String(item.transaction_hash || "").trim();

          return {
            chain: "eth" as const,
            index: account.index,
            address: account.address,
            tokenAddress,
            symbol: String(item.token?.symbol || "ERC20"),
            name: item.token?.name,
            decimals,
            txid,
            status: item.block_number ? ("confirmed" as const) : ("pending" as const),
            direction,
            from: from || undefined,
            to: to || undefined,
            amount: formatUnits(rawValue, decimals),
            raw,
            timestamp: item.timestamp,
            explorerUrl: txid ? `https://etherscan.io/tx/${txid}` : "https://etherscan.io",
          };
        })
        .filter((item) => item.txid && item.tokenAddress)
        .filter((item) => !tokenFilter || item.tokenAddress.toLowerCase() === tokenFilter);

      return txs.slice(0, limit);
    }

    const connection = new Connection(
      this.resolveRpcUrl(query.rpcUrl, this.getSolRpc()),
      "confirmed"
    );
    const publicKey = new PublicKey(account.address);
    const signatures = await connection.getSignaturesForAddress(publicKey, { limit });
    const tokenTxs: WalletTokenTransaction[] = [];

    for (const sig of signatures) {
      const txid = sig.signature;
      try {
        const parsedTx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!parsedTx?.meta) {
          continue;
        }

        const preBalances = parsedTx.meta.preTokenBalances || [];
        const postBalances = parsedTx.meta.postTokenBalances || [];

        const preByMint = new Map<string, { amount: bigint; decimals: number }>();
        const postByMint = new Map<string, { amount: bigint; decimals: number }>();

        for (const balance of preBalances) {
          if (String(balance.owner || "").toLowerCase() !== ownerLower) continue;
          preByMint.set(balance.mint, {
            amount: parseBigIntOrZero(balance.uiTokenAmount.amount),
            decimals: Number(balance.uiTokenAmount.decimals || 0),
          });
        }

        for (const balance of postBalances) {
          if (String(balance.owner || "").toLowerCase() !== ownerLower) continue;
          postByMint.set(balance.mint, {
            amount: parseBigIntOrZero(balance.uiTokenAmount.amount),
            decimals: Number(balance.uiTokenAmount.decimals || 0),
          });
        }

        const mints = new Set<string>([...preByMint.keys(), ...postByMint.keys()]);
        for (const mint of mints) {
          if (!mint) continue;
          if (tokenFilter && mint.toLowerCase() !== tokenFilter) continue;

          const pre = preByMint.get(mint);
          const post = postByMint.get(mint);
          const decimals = post?.decimals ?? pre?.decimals ?? 0;
          const preAmount = pre?.amount || 0n;
          const postAmount = post?.amount || 0n;
          const delta = postAmount - preAmount;
          if (delta === 0n) continue;

          const rawAbs = delta < 0n ? -delta : delta;
          tokenTxs.push({
            chain: "sol",
            index: account.index,
            address: account.address,
            tokenAddress: mint,
            symbol: `SPL-${mint.slice(0, 4).toUpperCase()}`,
            decimals,
            txid,
            status: sig.err
              ? "failed"
              : sig.confirmationStatus === "confirmed" || sig.confirmationStatus === "finalized"
                ? "confirmed"
                : "pending",
            direction: delta > 0n ? "in" : "out",
            amount: formatUnits(rawAbs, decimals),
            raw: rawAbs.toString(),
            fee: formatUnits(BigInt(parsedTx.meta.fee || 0), 9),
            timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : undefined,
            explorerUrl: `https://solscan.io/tx/${txid}`,
          });
        }
      } catch {
        void 0;
      }
    }

    return tokenTxs.slice(0, limit);
  }

  async getTransactions(query: TransactionsQuery): Promise<WalletTransaction[]> {
    const chain = assertWalletChain(query.chain);
    const index = normalizeStartIndex(query.index);
    const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 10)));
    const account = this.getReceiveAddress(chain, index);

    if (chain === "eth") {
      const payload = await fetchWalletJson<{
        items?: Array<{
          hash?: string;
          status?: string;
          confirmations?: number;
          value?: string;
          fee?: { value?: string };
          from?: { hash?: string };
          to?: { hash?: string };
          timestamp?: string;
        }>;
      }>(`https://eth.blockscout.com/api/v2/addresses/${account.address}/transactions`);

      return (payload.items || []).slice(0, limit).map((tx) => {
        const valueWei = BigInt(tx.value || "0");
        const feeWei = BigInt(tx.fee?.value || "0");
        const confirmations = Number(tx.confirmations || 0);

        return {
          chain,
          txid: tx.hash || "",
          status: tx.status === "ok" ? (confirmations > 0 ? "confirmed" : "pending") : "failed",
          from: tx.from?.hash,
          to: tx.to?.hash,
          amount: formatEther(valueWei),
          fee: formatEther(feeWei),
          confirmations,
          timestamp: tx.timestamp,
          explorerUrl: `https://etherscan.io/tx/${tx.hash || ""}`,
        };
      });
    }

    if (chain === "sol") {
      const connection = new Connection(
        this.resolveRpcUrl(query.rpcUrl, this.getSolRpc()),
        "confirmed"
      );
      const publicKey = new PublicKey(account.address);
      const signatures = await connection.getSignaturesForAddress(publicKey, { limit });

      return await Promise.all(
        signatures.map(async (entry) => {
          let amount: string | undefined;
          let fee: string | undefined;

          try {
            const parsedTx = await connection.getParsedTransaction(entry.signature, {
              maxSupportedTransactionVersion: 0,
            });
            if (parsedTx?.meta && parsedTx.transaction) {
              fee = formatUnits(BigInt(parsedTx.meta.fee || 0), 9);

              const accountKeys = parsedTx.transaction.message.accountKeys.map((key) =>
                key.pubkey.toBase58()
              );
              const accountIndex = accountKeys.indexOf(account.address);
              if (
                accountIndex >= 0 &&
                parsedTx.meta.preBalances[accountIndex] !== undefined &&
                parsedTx.meta.postBalances[accountIndex] !== undefined
              ) {
                const delta =
                  BigInt(parsedTx.meta.postBalances[accountIndex]) -
                  BigInt(parsedTx.meta.preBalances[accountIndex]);
                amount = formatUnits(delta < 0n ? -delta : delta, 9);
              }
            }
          } catch {
            void 0;
          }

          return {
            chain,
            txid: entry.signature,
            status: entry.err
              ? "failed"
              : entry.confirmationStatus === "confirmed" || entry.confirmationStatus === "finalized"
                ? "confirmed"
                : "pending",
            amount,
            fee,
            confirmations: entry.confirmationStatus === "finalized" ? 1 : 0,
            timestamp: entry.blockTime ? new Date(entry.blockTime * 1000).toISOString() : undefined,
            explorerUrl: `https://solscan.io/tx/${entry.signature}`,
          };
        })
      );
    }

    const txs = await fetchWalletJson<
      Array<{
        txid: string;
        fee?: number;
        status?: { confirmed?: boolean; block_time?: number };
        vin?: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
        vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
      }>
    >(`${this.getBtcApiBase()}/address/${account.address}/txs`);

    return txs.slice(0, limit).map((tx) => {
      const incoming = (tx.vout || [])
        .filter((vout) => vout.scriptpubkey_address === account.address)
        .reduce((sum, vout) => sum + BigInt(vout.value || 0), 0n);

      const outgoing = (tx.vin || [])
        .filter((vin) => vin.prevout?.scriptpubkey_address === account.address)
        .reduce((sum, vin) => sum + BigInt(vin.prevout?.value || 0), 0n);

      const net = incoming - outgoing;
      const sampleOutput = (tx.vout || []).find(
        (vout) => vout.scriptpubkey_address !== account.address
      );
      const sampleInput = (tx.vin || []).find((vin) => vin.prevout?.scriptpubkey_address);

      return {
        chain,
        txid: tx.txid,
        status: tx.status?.confirmed ? "confirmed" : "pending",
        from: sampleInput?.prevout?.scriptpubkey_address,
        to: sampleOutput?.scriptpubkey_address,
        amount: formatUnits(net < 0n ? -net : net, 8),
        fee: formatUnits(BigInt(tx.fee || 0), 8),
        confirmations: tx.status?.confirmed ? 1 : 0,
        timestamp: tx.status?.block_time
          ? new Date(tx.status.block_time * 1000).toISOString()
          : undefined,
        explorerUrl: `https://mempool.space/tx/${tx.txid}`,
      };
    });
  }
}

export const walletManager = new WalletManager();
export type {
  EthContractCallInput,
  SolInstructionAccountMeta,
  SolProgramInstructionInput,
  TokenTransactionsQuery,
  WalletAccount,
  WalletAgentPolicy,
  WalletBalance,
  WalletChain,
  WalletDappAdapter,
  WalletDappAdapterCapability,
  WalletDappCallInput,
  WalletDappDirectory,
  WalletEndpointDirectory,
  WalletPriceQuoteInput,
  WalletPriceQuoteResult,
  WalletPriceSource,
  WalletRpcCallInput,
  WalletRpcCallResult,
  WalletRpcServiceStatus,
  WalletRpcStatus,
  WalletSendInput,
  WalletSendResult,
  WalletSendTokenInput,
  WalletStatus,
  WalletSwapEthUniswapInput,
  WalletSwapEthUniswapResult,
  WalletSwapInput,
  WalletSwapResult,
  WalletSwapVenue,
  WalletTokenBalance,
  WalletTokenChain,
  WalletTokenTransaction,
  WalletTransaction,
  WalletX402RequestInput,
  WalletX402RequestResult,
};
