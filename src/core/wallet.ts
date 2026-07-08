import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { assertRecipientAllowed, assertAmountWithinCap } from "./wallet-policy";
import { assertPublicHttpUrl } from "./wallet-url-guard";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  HDNodeWallet,
  JsonRpcProvider,
  Contract,
  TypedDataDomain,
  formatEther,
  isAddress as isEvmAddress,
  parseEther,
} from "ethers";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getMintDecimals,
  getAssociatedTokenAddressSync,
} from "./solana-token";
import { createKeyPairSignerFromBytes } from "@solana/signers";
import {
  SelectPaymentRequirements as X402SelectPaymentRequirements,
  x402Client as X402Client,
  x402HTTPClient as X402HttpClient,
} from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import {
  EVM_NETWORK_CHAIN_ID_MAP as X402EvmNetworkChainIdMap,
  ExactEvmSchemeV1,
} from "@x402/evm/v1";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import { ExactSvmSchemeV1, NETWORKS as X402SvmV1Networks } from "@x402/svm/v1";
import { derivePath as deriveEd25519Path } from "ed25519-hd-key";
import * as bitcoinImport from "bitcoinjs-lib";
import BIP32Factory from "bip32";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import { config } from "./config";
import { secureDir } from "./paths";
import {
  SUPPORTED_CHAINS,
  SUPPORTED_TOKEN_CHAINS,
  type AccountsQuery,
  type AesKeyUsage,
  type BtcUtxo,
  type EthContractCallInput,
  type SolInstructionAccountMeta,
  type SolProgramInstructionInput,
  type TokenBalancesQuery,
  type TokenTransactionsQuery,
  type TransactionsQuery,
  type UnlockedWalletState,
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
  type WalletVault,
  type WalletX402PaymentRequiredV1,
  type WalletX402PaymentRequiredV2,
  type WalletX402RequestInput,
  type WalletX402RequestResult,
  type WalletX402RequirementV1,
  type WalletX402RequirementV2,
  type WalletX402SelectedRequirement,
  type WalletX402SettlementResponse,
} from "./wallet-types";

// tiny-secp256k1 loads WASM at import time. The sidecar build patches the
// loader to resolve secp256k1.wasm from the executable's directory. Wrap
// initialization in try-catch so ETH/SOL still work if WASM fails.
let bitcoin: typeof bitcoinImport | null = null;
let bip32: ReturnType<typeof BIP32Factory> | null = null;
let ECPair: ReturnType<typeof ECPairFactory> | null = null;
try {
  bitcoinImport.initEccLib(ecc);
  bitcoin = bitcoinImport;
  bip32 = BIP32Factory(ecc);
  ECPair = ECPairFactory(ecc);
} catch (eccError) {
  console.warn(
    "[Wallet] tiny-secp256k1 WASM init failed — BTC operations will be unavailable:",
    eccError instanceof Error ? eccError.message : eccError
  );
}

const WALLET_FILE = join(secureDir, "wallet.v1.json");
const WALLET_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 310_000;
const UNLOCK_TTL_MS = 15 * 60 * 1000;
const AGENT_ACCESS_CONFIG_KEY = "wallet_agent_access_enabled";
const AGENT_POLICY_CONFIG_KEY = "wallet_agent_policy";

const DEFAULT_ETH_RPC = "https://ethereum-rpc.publicnode.com";
const DEFAULT_SOL_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_BTC_API_BASE = "https://mempool.space/api";

const ETH_RPC_CONFIG_KEY = "wallet_rpc_eth";
const SOL_RPC_CONFIG_KEY = "wallet_rpc_sol";
const BTC_API_CONFIG_KEY = "wallet_btc_api";

const UNISWAP_V2_ROUTER_ETH = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_V3_ROUTER_ETH = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const UNISWAP_V3_QUOTER_V2_ETH = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const UNISWAP_V3_QUOTER_LEGACY_ETH = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const UNISWAP_UNIVERSAL_ROUTER_ETH = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const UNISWAP_PERMIT2_ETH = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const WETH_MAINNET = "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2";
const UNISWAP_TOKEN_LIST_URL = "https://tokens.uniswap.org";
const PYTH_HERMES_API_BASE = "https://hermes.pyth.network/v2";
const JUPITER_PRICE_API_BASE = "https://lite-api.jup.ag/price/v3";
const JUPITER_SWAP_API_BASE = "https://lite-api.jup.ag/swap/v1";
const JUPITER_PROGRAM_LABELS_API = "https://lite-api.jup.ag/swap/v1/program-id-to-label";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CHAINLINK_FEED_REGISTRY_ETH = "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf";
const CHAINLINK_DENOMINATION_USD = "0x0000000000000000000000000000000000000348";
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
const X402_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const X402_RESPONSE_HEADER = "PAYMENT-RESPONSE";
const X402_LEGACY_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";
const X402_AGENT_MAX_DEFAULT_ATOMIC = "1000000";
const X402_AGENT_SUPPORTED_SCHEMES = new Set<string>(["exact"]);
const X402_V1_EVM_NETWORK_CHAIN_IDS: Record<string, number> = {
  ...Object.fromEntries(
    Object.entries(X402EvmNetworkChainIdMap).map(([network, chainId]) => [
      network.toLowerCase(),
      Number(chainId),
    ])
  ),
  mainnet: 1,
  arbitrum: 42161,
  optimism: 10,
};
const X402_V1_SOLANA_NETWORKS = [
  ...new Set(X402SvmV1Networks.map((network) => network.toLowerCase())),
];
const CHAINLINK_BASE_ASSETS: Record<string, string> = {
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  BTC: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
};

const CHAINLINK_USD_FEEDS: Record<string, string> = {
  BTC: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  ETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  SOL: "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  LINK: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
};

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64(bytes: Uint8Array | ArrayBuffer): string {
  const normalized = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return Buffer.from(normalized).toString("base64");
}

function decodeBase64(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
}

function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function normalizeCount(input?: number): number {
  const fallback = 1;
  if (typeof input !== "number" || Number.isNaN(input)) return fallback;
  return Math.min(20, Math.max(1, Math.floor(input)));
}

function normalizeStartIndex(input?: number): number {
  if (typeof input !== "number" || Number.isNaN(input)) return 0;
  return Math.max(0, Math.floor(input));
}

function parseAmountToUnits(amountInput: string, decimals: number): bigint {
  const normalized = amountInput.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Validation error: Amount must be a positive decimal number");
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > decimals) {
    throw new Error(`Validation error: Amount supports up to ${decimals} decimals`);
  }

  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart) * scale;
  const fractional = BigInt((fractionalPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole + fractional;
}

function formatUnits(amount: bigint, decimals: number): string {
  const sign = amount < 0n ? "-" : "";
  const value = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractional = value % scale;

  if (fractional === 0n) {
    return `${sign}${whole.toString()}`;
  }

  const fractionalString = fractional.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fractionalString}`;
}

function parseBigIntOrZero(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
    return 0n;
  } catch {
    return 0n;
  }
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

function normalizeAddressList(values: unknown[]): string[] {
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeStringList(values: unknown[]): string[] {
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeHostList(values: unknown[]): string[] {
  const hosts: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const candidate = value.trim().toLowerCase();
    if (!candidate) continue;
    try {
      if (candidate.includes("://")) {
        hosts.push(new URL(candidate).host.toLowerCase());
      } else {
        const url = new URL(`https://${candidate}`);
        hosts.push(url.host.toLowerCase());
      }
    } catch {
      void 0;
    }
  }
  return [...new Set(hosts)];
}

function normalizeNetworkList(values: unknown[]): string[] {
  return normalizeStringList(values).map((value) => value.toLowerCase());
}

function parsePositiveAtomicAmount(value: string, label: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Validation error: ${label} must be a positive integer string`);
  }
  const amount = BigInt(normalized);
  if (amount <= 0n) {
    throw new Error(`Validation error: ${label} must be greater than zero`);
  }
  return amount;
}

function assertWalletChain(chain: string): WalletChain {
  if (SUPPORTED_CHAINS.includes(chain as WalletChain)) {
    return chain as WalletChain;
  }
  throw new Error(`Validation error: Unsupported chain '${chain}'`);
}

function assertWalletTokenChain(chain: string): WalletTokenChain {
  if (SUPPORTED_TOKEN_CHAINS.includes(chain as WalletTokenChain)) {
    return chain as WalletTokenChain;
  }
  throw new Error(
    `Validation error: Unsupported token chain '${chain}'. Use one of: ${SUPPORTED_TOKEN_CHAINS.join(", ")}`
  );
}

function isValidEvmAddress(value: string): boolean {
  return isEvmAddress(value);
}

function normalizeContractResult(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeContractResult(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      normalizeContractResult(nested),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function resolvePair(input: { symbol?: string; pair?: string }): { base: string; quote: string } {
  const pair = typeof input.pair === "string" ? normalizeTicker(input.pair) : "";
  if (pair.includes("/")) {
    const [base, quote] = pair.split("/");
    if (base && quote) {
      return { base, quote };
    }
  }

  const rawSymbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  if (rawSymbol && isEvmAddress(rawSymbol)) {
    return { base: rawSymbol, quote: "USD" };
  }

  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : "";
  if (symbol) {
    return { base: symbol, quote: "USD" };
  }

  throw new Error("Validation error: symbol or pair is required");
}

function normalizeSwapVenue(input: string): WalletSwapVenue {
  const venue = input.trim().toLowerCase();
  if (venue === "uniswap_v2" || venue === "uniswap-v2" || venue === "uni_v2" || venue === "v2") {
    return "uniswap_v2";
  }
  if (
    venue === "uniswap_v3" ||
    venue === "uniswap-v3" ||
    venue === "uniswap" ||
    venue === "uni" ||
    venue === "v3"
  ) {
    return "uniswap_v3";
  }
  if (venue === "jupiter" || venue === "jup") {
    return "jupiter";
  }
  throw new Error(
    "Validation error: Unsupported swap venue. Use uniswap_v2, uniswap_v3, or jupiter"
  );
}

function normalizeHttpMethod(value?: string): string {
  const method = String(value || "GET")
    .trim()
    .toUpperCase();
  return method || "GET";
}

function parseEip155ChainId(networkInput: string): number | undefined {
  const network = networkInput.trim().toLowerCase();
  if (!network) return undefined;
  if (network.startsWith("eip155:")) {
    const parsed = Number(network.slice("eip155:".length));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return X402_V1_EVM_NETWORK_CHAIN_IDS[network];
}

function parseX402NetworkFamily(networkInput: string): "evm" | "solana" | undefined {
  const network = networkInput.trim().toLowerCase();
  if (!network) return undefined;
  if (parseEip155ChainId(network)) return "evm";
  if (network.startsWith("solana:") && network.length > "solana:".length) return "solana";
  if (X402_V1_SOLANA_NETWORKS.includes(network)) {
    return "solana";
  }
  return undefined;
}

function normalizeFeedId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Validation error: pyth feed id is required");
  }
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function normalizeEthMethodSelector(input: string): string {
  const trimmed = input.trim().replace(/^function\s+/, "");
  const openIndex = trimmed.indexOf("(");
  if (openIndex < 0) {
    return trimmed;
  }

  let depth = 0;
  for (let index = openIndex; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char !== ")") {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      const name = trimmed.slice(0, openIndex).trim();
      const args = trimmed.slice(openIndex + 1, index).trim();
      return `${name}(${args})`;
    }
  }

  return trimmed;
}

function extractEthMethodName(input: string): string {
  const selector = normalizeEthMethodSelector(input);
  if (!selector) {
    return "";
  }
  const openIndex = selector.indexOf("(");
  if (openIndex < 0) {
    return selector.trim();
  }
  return selector.slice(0, openIndex).trim();
}

function decodeInstructionData(input: {
  dataBase64?: string;
  dataHex?: string;
  dataUtf8?: string;
}): Buffer {
  const base64 = typeof input.dataBase64 === "string" ? input.dataBase64.trim() : "";
  const hex = typeof input.dataHex === "string" ? input.dataHex.trim() : "";
  const utf8 = typeof input.dataUtf8 === "string" ? input.dataUtf8 : "";
  const sources = [base64 ? "base64" : "", hex ? "hex" : "", utf8 ? "utf8" : ""].filter(Boolean);

  if (sources.length > 1) {
    throw new Error("Validation error: Provide only one instruction data encoding");
  }

  if (base64) {
    try {
      return Buffer.from(base64, "base64");
    } catch {
      throw new Error("Validation error: Invalid base64 instruction data");
    }
  }

  if (hex) {
    const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
      throw new Error("Validation error: Invalid hex instruction data");
    }
    return Buffer.from(normalized, "hex");
  }

  if (utf8) {
    return Buffer.from(utf8, "utf8");
  }

  return Buffer.alloc(0);
}

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  usages: AesKeyUsage[]
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "user-agent": "cybara-wallet/1.0" },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Wallet network request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

class WalletManager {
  private unlockedState: UnlockedWalletState | null = null;
  private uniswapTokenListCache: {
    loadedAtMs: number;
    tokens: Array<{
      address: string;
      symbol: string;
      name?: string;
      decimals: number;
      chainId: number;
    }>;
  } | null = null;
  private jupiterProgramLabelsCache: {
    loadedAtMs: number;
    labels: Record<string, string>;
  } | null = null;

  getStatus(): WalletStatus {
    const vault = this.readVault();
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
    this.validatePassword(password);

    if (this.readVault()) {
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
    this.validatePassword(password);

    if (this.readVault()) {
      throw new Error("Wallet already exists");
    }

    const mnemonic = normalizeMnemonic(mnemonicInput);
    this.validateMnemonic(mnemonic);

    return await this.storeMnemonic(mnemonic, password);
  }

  async unlock(password: string): Promise<{
    success: boolean;
    address: string;
    primaryAddresses: Record<WalletChain, string>;
    unlockExpiresAt: string;
  }> {
    this.validatePassword(password);

    const vault = this.readVault();
    if (!vault) {
      throw new Error("Validation error: Wallet not found");
    }

    const mnemonic = await this.decryptMnemonic(vault, password);
    const primaryAddresses = this.getPrimaryAddresses(mnemonic);
    const expiresAtMs = Date.now() + UNLOCK_TTL_MS;
    this.unlockedState = { mnemonic, primaryAddresses, expiresAtMs };

    if (
      !vault.primaryAddresses ||
      vault.primaryAddresses.eth !== primaryAddresses.eth ||
      (primaryAddresses.btc && vault.primaryAddresses.btc !== primaryAddresses.btc) ||
      vault.primaryAddresses.sol !== primaryAddresses.sol
    ) {
      this.writeVault({
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

  lock(): { success: boolean } {
    this.unlockedState = null;
    return { success: true };
  }

  async deleteWallet(password?: string): Promise<{ success: boolean }> {
    const vault = this.readVault();
    if (!vault) {
      return { success: true };
    }

    if (password && password.trim()) {
      await this.decryptMnemonic(vault, password);
    } else if (!this.getUnlockedState()) {
      throw new Error("Validation error: Password required to delete wallet");
    }

    rmSync(WALLET_FILE, { force: true });
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
    const rpc = this.getRpcConfig();
    const checkedAt = new Date().toISOString();

    const services = await Promise.all([
      this.checkEthRpc(rpc.ethRpc),
      this.checkSolRpc(rpc.solRpc),
      this.checkBtcApi(rpc.btcApi),
    ]);

    return { checkedAt, services };
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

  /**
   * Enforce the recipient allowlist and per-transaction cap for agent-initiated
   * sends. A single prompt-injection should not be able to move funds to an
   * arbitrary address or in an arbitrary amount.
   */
  private assertAgentSendWithinPolicy(to: string, amount: string, policy: WalletAgentPolicy): void {
    const recipient = String(to || "").trim();
    // A send requires an explicit, allowlisted recipient when an allowlist is set.
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

  /** Enforce the per-transaction amount cap (shared by all fund-moving paths). */
  private assertAgentAmountWithinCap(amount: string | undefined, policy: WalletAgentPolicy): void {
    assertAmountWithinCap(amount, policy);
  }

  /**
   * Enforce the recipient allowlist for any path that can direct funds to an
   * external address (swaps with an explicit recipient, contract calls). When no
   * recipient is given, output goes to the wallet's own address, which is safe;
   * an explicitly-directed recipient must be allowlisted like a send.
   */
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
      // Native ETH attached to a contract call is a fund movement — cap it.
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
          // Chain derivation unavailable (e.g. BTC WASM missing); skip
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
            const payload = await fetchJson<{
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
      const payload = await fetchJson<
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
      const payload = await fetchJson<{
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
      const payload = await fetchJson<{
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

    const txs = await fetchJson<
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

  async send(input: WalletSendInput): Promise<WalletSendResult> {
    const chain = assertWalletChain(input.chain);
    const to = String(input.to || "").trim();
    const amount = String(input.amount || "").trim();
    const index = normalizeStartIndex(input.index);

    if (!to) {
      throw new Error("Validation error: Destination address is required");
    }

    if (!amount) {
      throw new Error("Validation error: Amount is required");
    }

    const unlocked = this.requireUnlocked();

    if (chain === "eth") {
      return await this.sendEth({
        mnemonic: unlocked.mnemonic,
        to,
        amount,
        index,
        memo: input.memo,
        rpcUrl: input.rpcUrl,
      });
    }

    if (chain === "sol") {
      return await this.sendSol({
        mnemonic: unlocked.mnemonic,
        to,
        amount,
        index,
        memo: input.memo,
        rpcUrl: input.rpcUrl,
      });
    }

    return await this.sendBtc({
      mnemonic: unlocked.mnemonic,
      to,
      amount,
      index,
      feeRate: input.feeRate,
    });
  }

  async sendToken(
    input: WalletSendTokenInput
  ): Promise<WalletSendResult & { tokenAddress: string }> {
    const chain = assertWalletTokenChain(input.chain);
    const tokenAddress = String(input.tokenAddress || "").trim();
    const to = String(input.to || "").trim();
    const amount = String(input.amount || "").trim();
    const index = normalizeStartIndex(input.index);

    if (!tokenAddress) {
      throw new Error("Validation error: tokenAddress is required");
    }
    if (!to) {
      throw new Error("Validation error: Destination address is required");
    }
    if (!amount) {
      throw new Error("Validation error: Amount is required");
    }

    const unlocked = this.requireUnlocked();

    if (chain === "eth") {
      return await this.sendEthToken({
        mnemonic: unlocked.mnemonic,
        tokenAddress,
        to,
        amount,
        index,
        decimals: input.decimals,
        rpcUrl: input.rpcUrl,
      });
    }

    return await this.sendSolToken({
      mnemonic: unlocked.mnemonic,
      tokenAddress,
      to,
      amount,
      index,
      decimals: input.decimals,
      rpcUrl: input.rpcUrl,
      memo: input.memo,
    });
  }

  async swapEthOnUniswap(input: WalletSwapEthUniswapInput): Promise<WalletSwapEthUniswapResult> {
    const tokenOutInput = String(input.tokenOut || "").trim();
    if (!tokenOutInput) {
      throw new Error("Validation error: tokenOut is required");
    }

    const index = normalizeStartIndex(input.index);
    const amountEth = String(input.amountEth || "").trim();
    const percent =
      typeof input.percent === "number" && Number.isFinite(input.percent)
        ? Number(input.percent)
        : undefined;
    const dryRun = input.dryRun === true;

    if (!amountEth && percent === undefined) {
      throw new Error("Validation error: amountEth or percent is required");
    }
    if (amountEth && percent !== undefined) {
      throw new Error("Validation error: Specify either amountEth or percent, not both");
    }

    const slippageBps =
      typeof input.slippageBps === "number" && Number.isFinite(input.slippageBps)
        ? Math.min(5_000, Math.max(10, Math.floor(input.slippageBps)))
        : 100;
    const deadlineSeconds =
      typeof input.deadlineSeconds === "number" && Number.isFinite(input.deadlineSeconds)
        ? Math.min(7_200, Math.max(60, Math.floor(input.deadlineSeconds)))
        : 900;

    const unlocked = this.requireUnlocked();
    const provider = new JsonRpcProvider(this.resolveRpcUrl(input.rpcUrl, this.getEthRpc()));
    const account = this.deriveEthWallet(unlocked.mnemonic, index);
    const signer = account.wallet.connect(provider);
    const from = account.address;
    const balanceWei = await provider.getBalance(from);
    const gasReserveWei = parseEther("0.003");

    if (balanceWei <= gasReserveWei) {
      throw new Error("Validation error: Not enough ETH balance available after gas reserve");
    }

    let amountInWei: bigint;
    if (percent !== undefined) {
      if (percent <= 0 || percent > 100) {
        throw new Error("Validation error: percent must be greater than 0 and at most 100");
      }
      const scaledPercent = BigInt(Math.round(percent * 10_000));
      amountInWei = (balanceWei * scaledPercent) / 1_000_000n;
    } else {
      amountInWei = parseEther(amountEth);
    }

    if (amountInWei <= 0n) {
      throw new Error("Validation error: Swap input amount must be greater than zero");
    }

    if (amountInWei + gasReserveWei > balanceWei) {
      if (percent !== undefined) {
        amountInWei = balanceWei - gasReserveWei;
      } else {
        throw new Error("Validation error: Insufficient ETH balance after reserving gas");
      }
    }

    const tokenOut = await this.resolveEthTokenTarget(tokenOutInput, provider);
    if (tokenOut.address.toLowerCase() === WETH_MAINNET.toLowerCase()) {
      throw new Error("Validation error: tokenOut must be a non-WETH ERC-20 token");
    }

    const recipient = String(input.recipient || from).trim();
    if (!isEvmAddress(recipient)) {
      throw new Error("Validation error: recipient must be a valid ETH address");
    }

    const router = new Contract(
      UNISWAP_V2_ROUTER_ETH,
      [
        "function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)",
        "function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable returns (uint256[] memory amounts)",
      ],
      signer
    );

    const path = [WETH_MAINNET, tokenOut.address];
    const quote = (await router.getAmountsOut(amountInWei, path)) as bigint[];
    const quotedAmountOutRaw = parseBigIntOrZero(quote[quote.length - 1]);
    if (quotedAmountOutRaw <= 0n) {
      throw new Error("Validation error: Could not quote output amount from Uniswap");
    }

    const minAmountOutRaw =
      typeof input.minAmountOut === "string" && input.minAmountOut.trim()
        ? parseAmountToUnits(input.minAmountOut.trim(), tokenOut.decimals)
        : (quotedAmountOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;

    const deadlineEpoch = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const baseResult: WalletSwapEthUniswapResult = {
      chain: "eth",
      dex: "uniswap_v2",
      from,
      toTokenAddress: tokenOut.address,
      toTokenSymbol: tokenOut.symbol,
      amountInEth: formatEther(amountInWei),
      amountInWei: amountInWei.toString(),
      quotedAmountOut: formatUnits(quotedAmountOutRaw, tokenOut.decimals),
      quotedAmountOutRaw: quotedAmountOutRaw.toString(),
      minAmountOut: formatUnits(minAmountOutRaw, tokenOut.decimals),
      minAmountOutRaw: minAmountOutRaw.toString(),
      slippageBps,
      recipient,
      deadline: new Date(deadlineEpoch * 1000).toISOString(),
      dryRun,
    };

    if (dryRun) {
      return baseResult;
    }

    const tx = await router.swapExactETHForTokens(minAmountOutRaw, path, recipient, deadlineEpoch, {
      value: amountInWei,
    });

    return {
      ...baseResult,
      dryRun: false,
      txid: tx.hash,
      explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
    };
  }

  async getPriceQuote(input: WalletPriceQuoteInput): Promise<WalletPriceQuoteResult> {
    const requestedSource = String(input.source || "auto")
      .trim()
      .toLowerCase() as WalletPriceSource;
    const source: WalletPriceSource =
      requestedSource === "chainlink" ||
      requestedSource === "pyth" ||
      requestedSource === "jupiter" ||
      requestedSource === "auto"
        ? requestedSource
        : "auto";

    const { base, quote } = resolvePair({
      symbol: input.symbol,
      pair: input.pair,
    });

    const tryChainlink = async (): Promise<WalletPriceQuoteResult> => {
      if (quote !== "USD") {
        throw new Error("Validation error: Chainlink source currently supports USD quote only");
      }

      const provider = new JsonRpcProvider(this.resolveRpcUrl(input.rpcUrl, this.getEthRpc()));
      const configuredFeed = typeof input.feedAddress === "string" ? input.feedAddress.trim() : "";
      const feedAddress =
        configuredFeed ||
        (await this.resolveChainlinkFeedAddress({
          base,
          quote,
          provider,
        }));
      if (!feedAddress || !isEvmAddress(feedAddress)) {
        throw new Error(
          `Validation error: No Chainlink feed configured for ${base}/${quote}; provide feedAddress`
        );
      }

      const feed = new Contract(
        feedAddress,
        [
          "function decimals() view returns (uint8)",
          "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
        ],
        provider
      );

      const [decimalsRaw, roundData] = await Promise.all([feed.decimals(), feed.latestRoundData()]);
      const decimals = Number(decimalsRaw);
      const answer = parseBigIntOrZero((roundData as { answer?: unknown }).answer);
      const updatedAtRaw = parseBigIntOrZero((roundData as { updatedAt?: unknown }).updatedAt);

      if (answer <= 0n) {
        throw new Error("Validation error: Chainlink feed returned a non-positive price");
      }

      return {
        source: "chainlink",
        base,
        quote,
        price: formatUnits(answer, Number.isFinite(decimals) ? decimals : 8),
        feedAddress,
        publishTime:
          updatedAtRaw > 0n ? new Date(Number(updatedAtRaw) * 1000).toISOString() : undefined,
      };
    };

    const tryPyth = async (): Promise<WalletPriceQuoteResult> => {
      if (quote !== "USD") {
        throw new Error("Validation error: Pyth source currently supports USD quote only");
      }

      const feedId = await this.resolvePythFeedId({
        pythFeedId: input.pythFeedId,
        symbol: base,
        pair: `${base}/${quote}`,
      });

      const url = `${PYTH_HERMES_API_BASE}/updates/price/latest?ids[]=${encodeURIComponent(
        feedId
      )}&parsed=true`;
      const payload = await fetchJson<{
        parsed?: Array<{
          id?: string;
          price?: {
            price?: string;
            conf?: string;
            expo?: number;
            publish_time?: number;
          };
        }>;
      }>(url);

      const parsed = payload.parsed?.[0];
      const price = parsed?.price;
      if (!price || typeof price.price !== "string" || typeof price.expo !== "number") {
        throw new Error("Validation error: Pyth feed did not return parsed price data");
      }

      return {
        source: "pyth",
        base,
        quote,
        price: this.formatScaledSignedInteger(price.price, price.expo),
        confidence:
          typeof price.conf === "string"
            ? this.formatScaledSignedInteger(price.conf, price.expo)
            : undefined,
        publishTime:
          typeof price.publish_time === "number"
            ? new Date(price.publish_time * 1000).toISOString()
            : undefined,
        feedId,
      };
    };

    const tryJupiter = async (): Promise<WalletPriceQuoteResult> => {
      if (quote !== "USD") {
        throw new Error("Validation error: Jupiter source currently supports USD quote only");
      }

      const mint = this.resolveSolMint(String(input.mint || "").trim() || base);
      const payload = await fetchJson<
        Record<
          string,
          {
            usdPrice?: number;
            createdAt?: string;
          }
        >
      >(`${JUPITER_PRICE_API_BASE}?ids=${encodeURIComponent(mint)}`);

      const entry = payload[mint];
      if (!entry || typeof entry.usdPrice !== "number" || !Number.isFinite(entry.usdPrice)) {
        throw new Error("Validation error: Jupiter price API returned no usable price");
      }

      return {
        source: "jupiter",
        base,
        quote,
        price: String(entry.usdPrice),
        mint,
        publishTime: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
      };
    };

    if (source === "chainlink") return await tryChainlink();
    if (source === "pyth") return await tryPyth();
    if (source === "jupiter") return await tryJupiter();

    const attempts: Array<() => Promise<WalletPriceQuoteResult>> = [];
    if (
      base in CHAINLINK_USD_FEEDS ||
      base in CHAINLINK_BASE_ASSETS ||
      isEvmAddress(base) ||
      input.feedAddress
    ) {
      attempts.push(tryChainlink);
    }
    attempts.push(tryPyth);
    attempts.push(tryJupiter);

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw lastError || new Error("Validation error: Could not resolve a price source");
  }

  async swap(input: WalletSwapInput): Promise<WalletSwapResult> {
    const venue = normalizeSwapVenue(String(input.venue || ""));
    if (venue === "uniswap_v2") {
      const result = await this.swapEthOnUniswap({
        tokenOut: String(input.tokenOut || ""),
        amountEth: input.amountEth,
        percent: input.percent,
        minAmountOut: input.minAmountOut,
        slippageBps: input.slippageBps,
        deadlineSeconds: input.deadlineSeconds,
        index: input.index,
        recipient: input.recipient,
        rpcUrl: input.rpcUrl,
        dryRun: input.dryRun,
      });
      return {
        venue: "uniswap_v2",
        chain: "eth",
        from: result.from,
        inputToken: "ETH",
        outputToken: result.toTokenSymbol,
        amountIn: result.amountInEth,
        amountInRaw: result.amountInWei,
        quotedAmountOut: result.quotedAmountOut,
        quotedAmountOutRaw: result.quotedAmountOutRaw,
        minAmountOut: result.minAmountOut,
        minAmountOutRaw: result.minAmountOutRaw,
        slippageBps: result.slippageBps,
        dryRun: result.dryRun,
        txid: result.txid,
        explorerUrl: result.explorerUrl,
      };
    }

    if (venue === "uniswap_v3") {
      return await this.swapEthOnUniswapV3(input);
    }
    if (venue === "jupiter") {
      return await this.swapOnJupiter(input);
    }
    throw new Error(
      "Validation error: Unsupported swap venue. Use uniswap_v2, uniswap_v3, or jupiter"
    );
  }

  private async swapEthOnUniswapV3(input: WalletSwapInput): Promise<WalletSwapResult> {
    const tokenOutInput = String(input.tokenOut || "").trim();
    if (!tokenOutInput) {
      throw new Error("Validation error: tokenOut is required for uniswap_v3 swaps");
    }

    const index = normalizeStartIndex(input.index);
    const amountEth = String(input.amountEth || "").trim();
    const percent =
      typeof input.percent === "number" && Number.isFinite(input.percent)
        ? Number(input.percent)
        : undefined;
    const dryRun = input.dryRun === true;
    if (!amountEth && percent === undefined) {
      throw new Error("Validation error: amountEth or percent is required");
    }
    if (amountEth && percent !== undefined) {
      throw new Error("Validation error: Specify either amountEth or percent, not both");
    }

    const feeTierRaw =
      typeof input.feeTier === "number" && Number.isFinite(input.feeTier)
        ? Math.floor(input.feeTier)
        : 3000;
    const allowedFeeTiers = new Set<number>([100, 500, 3000, 10_000]);
    const feeTier = allowedFeeTiers.has(feeTierRaw) ? feeTierRaw : 3000;
    const slippageBps =
      typeof input.slippageBps === "number" && Number.isFinite(input.slippageBps)
        ? Math.min(5_000, Math.max(10, Math.floor(input.slippageBps)))
        : 100;
    const deadlineSeconds =
      typeof input.deadlineSeconds === "number" && Number.isFinite(input.deadlineSeconds)
        ? Math.min(7_200, Math.max(60, Math.floor(input.deadlineSeconds)))
        : 900;

    const unlocked = this.requireUnlocked();
    const provider = new JsonRpcProvider(this.resolveRpcUrl(input.rpcUrl, this.getEthRpc()));
    const account = this.deriveEthWallet(unlocked.mnemonic, index);
    const signer = account.wallet.connect(provider);
    const from = account.address;
    const balanceWei = await provider.getBalance(from);
    const gasReserveWei = parseEther("0.003");

    if (balanceWei <= gasReserveWei) {
      throw new Error("Validation error: Not enough ETH balance available after gas reserve");
    }

    let amountInWei: bigint;
    if (percent !== undefined) {
      if (percent <= 0 || percent > 100) {
        throw new Error("Validation error: percent must be greater than 0 and at most 100");
      }
      const scaledPercent = BigInt(Math.round(percent * 10_000));
      amountInWei = (balanceWei * scaledPercent) / 1_000_000n;
    } else {
      amountInWei = parseEther(amountEth);
    }
    if (amountInWei <= 0n) {
      throw new Error("Validation error: Swap input amount must be greater than zero");
    }
    if (amountInWei + gasReserveWei > balanceWei) {
      if (percent !== undefined) {
        amountInWei = balanceWei - gasReserveWei;
      } else {
        throw new Error("Validation error: Insufficient ETH balance after reserving gas");
      }
    }

    const tokenOut = await this.resolveEthTokenTarget(tokenOutInput, provider);
    if (tokenOut.address.toLowerCase() === WETH_MAINNET.toLowerCase()) {
      throw new Error("Validation error: tokenOut must be a non-WETH ERC-20 token");
    }

    const recipient = String(input.recipient || from).trim();
    if (!isEvmAddress(recipient)) {
      throw new Error("Validation error: recipient must be a valid ETH address");
    }

    const quotedAmountOutRaw = await this.quoteUniswapV3ExactInputSingle({
      provider,
      tokenIn: WETH_MAINNET,
      tokenOut: tokenOut.address,
      feeTier,
      amountIn: amountInWei,
    });

    if (quotedAmountOutRaw <= 0n) {
      throw new Error("Validation error: Could not quote output amount from Uniswap V3");
    }

    const minAmountOutRaw =
      typeof input.minAmountOut === "string" && input.minAmountOut.trim()
        ? parseAmountToUnits(input.minAmountOut.trim(), tokenOut.decimals)
        : (quotedAmountOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;

    const deadlineEpoch = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const baseResult: WalletSwapResult = {
      venue: "uniswap_v3",
      chain: "eth",
      from,
      inputToken: "ETH",
      outputToken: tokenOut.symbol,
      amountIn: formatEther(amountInWei),
      amountInRaw: amountInWei.toString(),
      quotedAmountOut: formatUnits(quotedAmountOutRaw, tokenOut.decimals),
      quotedAmountOutRaw: quotedAmountOutRaw.toString(),
      minAmountOut: formatUnits(minAmountOutRaw, tokenOut.decimals),
      minAmountOutRaw: minAmountOutRaw.toString(),
      slippageBps,
      dryRun,
      route: `uniswap_v3_fee_${feeTier}`,
    };

    if (dryRun) {
      return baseResult;
    }

    const router = new Contract(
      UNISWAP_V3_ROUTER_ETH,
      [
        "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
      ],
      signer
    );

    const tx = await (
      router as unknown as Record<
        string,
        (
          params: Record<string, unknown>,
          overrides?: Record<string, unknown>
        ) => Promise<{ hash: string }>
      >
    ).exactInputSingle(
      {
        tokenIn: WETH_MAINNET,
        tokenOut: tokenOut.address,
        fee: feeTier,
        recipient,
        deadline: deadlineEpoch,
        amountIn: amountInWei,
        amountOutMinimum: minAmountOutRaw,
        sqrtPriceLimitX96: 0,
      },
      { value: amountInWei }
    );

    return {
      ...baseResult,
      dryRun: false,
      txid: tx.hash,
      explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
    };
  }

  private async swapOnJupiter(input: WalletSwapInput): Promise<WalletSwapResult> {
    const outputMint = String(input.outputMint || "").trim();
    if (!outputMint) {
      throw new Error("Validation error: outputMint is required for jupiter swaps");
    }
    const inputMint = String(input.inputMint || SOL_MINT).trim();
    const index = normalizeStartIndex(input.index);
    const dryRun = input.dryRun === true;
    const slippageBps =
      typeof input.slippageBps === "number" && Number.isFinite(input.slippageBps)
        ? Math.min(5_000, Math.max(10, Math.floor(input.slippageBps)))
        : 100;

    const unlocked = this.requireUnlocked();
    const connection = new Connection(
      this.resolveRpcUrl(input.rpcUrl, this.getSolRpc()),
      "confirmed"
    );
    const signer = this.deriveSolKeypair(unlocked.mnemonic, index);
    const from = signer.publicKey.toBase58();

    const inputDecimals = await this.getSolMintDecimals(connection, inputMint);
    const outputDecimals = await this.getSolMintDecimals(connection, outputMint);
    const amountRaw = await this.resolveJupiterAmountRaw({
      connection,
      owner: signer.publicKey,
      inputMint,
      inputAmount: input.amount,
      inputAmountRaw: input.amountRaw,
      inputPercent: input.percent,
      inputDecimals,
    });

    const quoteUrl = new URL(`${JUPITER_SWAP_API_BASE}/quote`);
    quoteUrl.searchParams.set("inputMint", inputMint);
    quoteUrl.searchParams.set("outputMint", outputMint);
    quoteUrl.searchParams.set("amount", amountRaw.toString());
    quoteUrl.searchParams.set("slippageBps", String(slippageBps));

    const quoteResponse = await fetchJson<{
      error?: string;
      errorCode?: string;
      outAmount?: string;
      otherAmountThreshold?: string;
      routePlan?: Array<{
        swapInfo?: {
          label?: string;
          ammKey?: string;
          inputMint?: string;
          outputMint?: string;
          inAmount?: string;
          outAmount?: string;
        };
      }>;
      [key: string]: unknown;
    }>(quoteUrl.toString());

    if (quoteResponse.error) {
      throw new Error(
        `Validation error: Jupiter quote failed (${quoteResponse.errorCode || "error"}): ${quoteResponse.error}`
      );
    }

    const outAmountRaw = parseBigIntOrZero(quoteResponse.outAmount);
    if (outAmountRaw <= 0n) {
      throw new Error("Validation error: Jupiter quote returned zero output amount");
    }
    const minAmountOutRaw = parseBigIntOrZero(
      quoteResponse.otherAmountThreshold || quoteResponse.outAmount
    );
    const programLabels = await this.getJupiterProgramLabels();
    const routePlan =
      quoteResponse.routePlan
        ?.map((leg) => {
          const swapInfo = leg.swapInfo;
          if (!swapInfo) return undefined;
          const ammKey = typeof swapInfo.ammKey === "string" ? swapInfo.ammKey : undefined;
          const resolvedLabel =
            typeof swapInfo.label === "string" && swapInfo.label.trim()
              ? swapInfo.label
              : ammKey
                ? programLabels[ammKey]
                : undefined;
          return {
            label: resolvedLabel,
            ammKey,
            inputMint: typeof swapInfo.inputMint === "string" ? swapInfo.inputMint : undefined,
            outputMint: typeof swapInfo.outputMint === "string" ? swapInfo.outputMint : undefined,
            inAmount: typeof swapInfo.inAmount === "string" ? swapInfo.inAmount : undefined,
            outAmount: typeof swapInfo.outAmount === "string" ? swapInfo.outAmount : undefined,
          };
        })
        ?.filter((leg): leg is NonNullable<typeof leg> => Boolean(leg)) || [];
    const routeSummary =
      routePlan
        .map((leg) => leg.label || leg.ammKey)
        .filter((item): item is string => Boolean(item))
        .join(" -> ") || "jupiter";

    const baseResult: WalletSwapResult = {
      venue: "jupiter",
      chain: "sol",
      from,
      inputToken: inputMint,
      outputToken: outputMint,
      amountIn: formatUnits(amountRaw, inputDecimals),
      amountInRaw: amountRaw.toString(),
      quotedAmountOut: formatUnits(outAmountRaw, outputDecimals),
      quotedAmountOutRaw: outAmountRaw.toString(),
      minAmountOut: formatUnits(minAmountOutRaw, outputDecimals),
      minAmountOutRaw: minAmountOutRaw.toString(),
      slippageBps,
      dryRun,
      route: routeSummary,
      routePlan,
    };

    if (dryRun) {
      return baseResult;
    }

    const swapResponse = await fetch(`${JUPITER_SWAP_API_BASE}/swap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "cybara-wallet/1.0",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: from,
        wrapAndUnwrapSol: input.wrapUnwrapSol !== false,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports:
          typeof input.computeUnitPriceMicroLamports === "number" &&
          Number.isFinite(input.computeUnitPriceMicroLamports) &&
          input.computeUnitPriceMicroLamports > 0
            ? {
                priorityLevelWithMaxLamports: { priorityLevel: "veryHigh", maxLamports: 2_000_000 },
              }
            : undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!swapResponse.ok) {
      const reason = await swapResponse.text();
      throw new Error(
        `Validation error: Jupiter swap request failed (${swapResponse.status}): ${reason}`
      );
    }

    const swapPayload = (await swapResponse.json()) as { swapTransaction?: string };
    if (!swapPayload.swapTransaction) {
      throw new Error("Validation error: Jupiter did not return a swap transaction");
    }

    const versionedTx = VersionedTransaction.deserialize(
      Buffer.from(swapPayload.swapTransaction, "base64")
    );
    versionedTx.sign([signer]);

    const signature = await connection.sendRawTransaction(versionedTx.serialize(), {
      skipPreflight: input.skipPreflight === true,
      maxRetries: 3,
    });
    await connection.confirmTransaction(signature, "confirmed");

    return {
      ...baseResult,
      dryRun: false,
      txid: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
    };
  }

  async callEthContract(input: EthContractCallInput): Promise<unknown> {
    const contractAddress = String(input.contractAddress || "").trim();
    const methodInput = String(input.method || "").trim();
    const explicitMethodSignature = String(input.methodSignature || "").trim();
    const args = Array.isArray(input.args) ? input.args : [];
    const index = normalizeStartIndex(input.index);
    const readOnly = input.readOnly === true;
    const inferredMethodSignature = methodInput.includes("(") ? methodInput : "";
    const methodSignature = normalizeEthMethodSelector(
      explicitMethodSignature || inferredMethodSignature
    );
    const method =
      methodInput && !methodInput.includes("(")
        ? methodInput
        : extractEthMethodName(methodInput || methodSignature);

    if (!isEvmAddress(contractAddress)) {
      throw new Error("Validation error: Invalid ETH contract address");
    }
    if (!method) {
      throw new Error("Validation error: Contract method is required");
    }

    const provider = new JsonRpcProvider(this.resolveRpcUrl(input.rpcUrl, this.getEthRpc()));
    const abi = this.parseEthContractAbi(input.abi, methodSignature);
    const overrides = this.buildEthContractOverrides(input);
    const invokeArgs = overrides ? [...args, overrides] : args;

    if (readOnly) {
      const contract = new Contract(contractAddress, abi as never, provider);
      const methodFn = this.resolveEthContractMethod(contract, method, methodSignature);
      const result =
        typeof methodFn.staticCall === "function"
          ? await methodFn.staticCall(...invokeArgs)
          : await methodFn(...invokeArgs);
      return {
        chain: "eth",
        readOnly: true,
        contractAddress,
        method,
        result: normalizeContractResult(result),
      };
    }

    const unlocked = this.requireUnlocked();
    const signer = this.deriveEthWallet(unlocked.mnemonic, index).wallet.connect(provider);
    const contract = new Contract(contractAddress, abi as never, signer);
    const writeMethod = this.resolveEthContractMethod(contract, method, methodSignature);
    const tx = await writeMethod(...invokeArgs);
    if (!tx || typeof tx !== "object" || typeof (tx as { hash?: unknown }).hash !== "string") {
      throw new Error("Validation error: Contract write did not return a transaction hash");
    }

    return {
      chain: "eth",
      readOnly: false,
      contractAddress,
      method,
      txid: (tx as { hash: string }).hash,
      explorerUrl: `https://etherscan.io/tx/${(tx as { hash: string }).hash}`,
    };
  }

  async sendSolProgramInstruction(
    input: SolProgramInstructionInput
  ): Promise<{ chain: "sol"; txid: string; explorerUrl: string }> {
    const programId = String(input.programId || "").trim();
    const keys =
      Array.isArray(input.keys) && input.keys.length
        ? input.keys
        : Array.isArray(input.accounts)
          ? input.accounts
          : [];
    const index = normalizeStartIndex(input.index);

    if (!programId) {
      throw new Error("Validation error: programId is required");
    }
    if (!keys.length) {
      throw new Error("Validation error: keys are required");
    }

    const unlocked = this.requireUnlocked();
    const connection = new Connection(
      this.resolveRpcUrl(input.rpcUrl, this.getSolRpc()),
      "confirmed"
    );
    const signer = this.deriveSolKeypair(unlocked.mnemonic, index);
    const transaction = new Transaction();

    if (input.computeUnitLimit !== undefined) {
      const units = Math.floor(Number(input.computeUnitLimit));
      if (!Number.isFinite(units) || units <= 0) {
        throw new Error("Validation error: computeUnitLimit must be a positive integer");
      }
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units }));
    }

    if (input.computeUnitPriceMicroLamports !== undefined) {
      const microLamports = Math.floor(Number(input.computeUnitPriceMicroLamports));
      if (!Number.isFinite(microLamports) || microLamports < 0) {
        throw new Error(
          "Validation error: computeUnitPriceMicroLamports must be a non-negative integer"
        );
      }
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
    }

    const instruction = new TransactionInstruction({
      programId: new PublicKey(programId),
      keys: keys.map((key) => ({
        pubkey: new PublicKey(String(key.pubkey || "")),
        isSigner: key.isSigner === true,
        isWritable: key.isWritable === true,
      })),
      data: decodeInstructionData({
        dataBase64: input.dataBase64,
        dataHex: input.dataHex,
        dataUtf8: input.dataUtf8,
      }),
    });
    transaction.add(instruction);

    const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
      commitment: "confirmed",
      skipPreflight: input.skipPreflight === true,
    });

    return {
      chain: "sol",
      txid: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
    };
  }

  async signMessage(
    message: string,
    chain: WalletChain = "eth",
    index = 0
  ): Promise<{ address: string; signature: string }> {
    if (typeof message !== "string" || !message.trim()) {
      throw new Error("Validation error: Message is required");
    }

    const unlocked = this.requireUnlocked();
    const normalizedIndex = normalizeStartIndex(index);

    if (chain !== "eth") {
      throw new Error(
        "Validation error: Message signing is currently supported for ETH accounts only"
      );
    }

    const account = this.deriveEthWallet(unlocked.mnemonic, normalizedIndex);
    const signature = await account.wallet.signMessage(message);

    return {
      address: account.address,
      signature,
    };
  }

  async rpcCall(input: WalletRpcCallInput): Promise<WalletRpcCallResult> {
    const chain = input.chain === "sol" ? "sol" : "eth";
    const method = String(input.method || "").trim();
    if (!method) {
      throw new Error("Validation error: RPC method is required");
    }
    const params = Array.isArray(input.params) ? input.params : [];
    const rpcUrl =
      chain === "sol"
        ? this.resolveRpcUrl(input.rpcUrl, this.getSolRpc())
        : this.resolveRpcUrl(input.rpcUrl, this.getEthRpc());
    const id = input.id ?? 1;

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "cybara-wallet/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const reason = await response.text().catch(() => "");
      throw new Error(
        `Validation error: RPC request failed (${response.status})${reason ? `: ${reason}` : ""}`
      );
    }

    const payload = (await response.json()) as {
      id?: string | number;
      result?: unknown;
      error?: unknown;
    };
    return {
      chain,
      rpcUrl,
      method,
      id: payload.id,
      result: payload.result,
      error: payload.error,
    };
  }

  async x402Request(input: WalletX402RequestInput): Promise<WalletX402RequestResult> {
    const urlInput = String(input.url || "").trim();
    if (!urlInput) {
      throw new Error("Validation error: x402 url is required");
    }
    this.validateHttpUrl(urlInput, "x402 URL");
    assertPublicHttpUrl(urlInput, "x402 URL");
    const url = new URL(urlInput);
    const method = normalizeHttpMethod(input.method);
    const timeoutMs =
      typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? Math.min(60_000, Math.max(1_000, Math.floor(input.timeoutMs)))
        : 20_000;
    const parseJsonResponse = input.parseJsonResponse !== false;

    const headers = new Headers();
    headers.set("user-agent", "cybara-wallet/1.0");
    for (const [key, value] of Object.entries(input.headers || {})) {
      if (!key || typeof value !== "string") continue;
      headers.set(key, value);
    }

    let bodyPayload: RequestInit["body"] | undefined;
    if (input.body !== undefined && method !== "GET" && method !== "HEAD") {
      if (typeof input.body === "string") {
        bodyPayload = input.body;
      } else if (input.body instanceof Uint8Array || input.body instanceof ArrayBuffer) {
        bodyPayload = input.body as RequestInit["body"];
      } else {
        bodyPayload = JSON.stringify(input.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
    }

    const baseRequest = {
      method,
      headers,
      body: bodyPayload,
      signal: AbortSignal.timeout(timeoutMs),
    } satisfies RequestInit;

    const firstResponse = await fetch(url.toString(), baseRequest);
    if (firstResponse.status !== 402) {
      return await this.buildX402Result({
        response: firstResponse,
        url: url.toString(),
        method,
        paid: false,
        attemptedPayment: false,
        paymentRequirement: undefined,
        settlement: this.decodeX402SettlementResponse(firstResponse.headers),
        parseJsonResponse,
      });
    }

    const required = await this.decodeX402PaymentRequired(firstResponse);
    const selectedRequirement = this.selectX402Requirement(required, input.network);
    const maxAmountAtomic =
      typeof input.maxAmountAtomic === "string" && input.maxAmountAtomic.trim()
        ? input.maxAmountAtomic.trim()
        : X402_AGENT_MAX_DEFAULT_ATOMIC;
    const maxAllowed = parsePositiveAtomicAmount(maxAmountAtomic, "maxAmountAtomic");
    const requirementAmount = parsePositiveAtomicAmount(
      selectedRequirement.amount,
      "x402 payment amount"
    );
    if (requirementAmount > maxAllowed) {
      throw new Error(
        `Validation error: x402 required amount (${selectedRequirement.amount}) exceeds maxAmountAtomic (${maxAmountAtomic})`
      );
    }

    if (input.dryRun === true) {
      return {
        url: url.toString(),
        method,
        status: 402,
        paid: false,
        attemptedPayment: false,
        paymentRequirement: selectedRequirement,
        responseHeaders: this.serializeResponseHeaders(firstResponse.headers),
        body: undefined,
      };
    }

    const paymentHeader = await this.createX402PaymentHeader({
      required,
      requirement: selectedRequirement,
      index: normalizeStartIndex(input.index),
      requestUrl: url.toString(),
    });

    const retryHeaders = new Headers(headers);
    retryHeaders.set(paymentHeader.name, paymentHeader.value);
    const secondResponse = await fetch(url.toString(), {
      method,
      headers: retryHeaders,
      body: bodyPayload,
      signal: AbortSignal.timeout(timeoutMs),
    });

    return await this.buildX402Result({
      response: secondResponse,
      url: url.toString(),
      method,
      paid: secondResponse.status < 400,
      attemptedPayment: true,
      paymentHeaderUsed: paymentHeader.name,
      paymentRequirement: selectedRequirement,
      settlement: this.decodeX402SettlementResponse(secondResponse.headers),
      parseJsonResponse,
    });
  }

  async executeDapp(input: WalletDappCallInput): Promise<unknown> {
    const adapter = this.normalizeDappAdapter(input.adapter);
    const payload = input.payload || {};

    switch (adapter) {
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
      case "eth_contract_call":
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
          readOnly: payload.readOnly === true,
          rpcUrl: typeof payload.rpcUrl === "string" ? payload.rpcUrl : undefined,
        });
      case "sol_program_instruction":
        return await this.sendSolProgramInstruction({
          programId: String(payload.programId || ""),
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
      case "swap":
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
          dryRun: payload.dryRun !== false,
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
      case "x402_http":
        return await this.x402Request({
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
      default:
        throw new Error(
          `Validation error: Unsupported dapp adapter '${String(input.adapter || "")}'`
        );
    }
  }

  private async sendEth(input: {
    mnemonic: string;
    to: string;
    amount: string;
    index: number;
    memo?: string;
    rpcUrl?: string;
  }): Promise<WalletSendResult> {
    if (!isEvmAddress(input.to)) {
      throw new Error("Validation error: Invalid ETH destination address");
    }

    const provider = new JsonRpcProvider(this.resolveRpcUrl(input.rpcUrl, this.getEthRpc()));
    const account = this.deriveEthWallet(input.mnemonic, input.index);
    const signer = account.wallet.connect(provider);

    const tx = await signer.sendTransaction({
      to: input.to,
      value: parseEther(input.amount),
      data: input.memo?.trim()
        ? `0x${Buffer.from(input.memo.trim(), "utf8").toString("hex")}`
        : undefined,
    });

    return {
      chain: "eth",
      txid: tx.hash,
      explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
    };
  }

  private async sendEthToken(input: {
    mnemonic: string;
    tokenAddress: string;
    to: string;
    amount: string;
    index: number;
    decimals?: number;
    rpcUrl?: string;
  }): Promise<WalletSendResult & { tokenAddress: string }> {
    if (!isEvmAddress(input.to)) {
      throw new Error("Validation error: Invalid ETH destination address");
    }
    if (!isEvmAddress(input.tokenAddress)) {
      throw new Error("Validation error: Invalid ERC-20 token address");
    }

    const provider = new JsonRpcProvider(this.resolveRpcUrl(input.rpcUrl, this.getEthRpc()));
    const account = this.deriveEthWallet(input.mnemonic, input.index);
    const signer = account.wallet.connect(provider);

    const abi = [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
    ];
    const contract = new Contract(input.tokenAddress, abi, signer);

    const decimals =
      typeof input.decimals === "number" && Number.isFinite(input.decimals)
        ? Math.max(0, Math.min(36, Math.floor(input.decimals)))
        : Number(await contract.decimals());
    const value = parseAmountToUnits(input.amount, decimals);
    if (value <= 0n) {
      throw new Error("Validation error: Amount must be greater than zero");
    }

    const tx = await contract.transfer(input.to, value);

    return {
      chain: "eth",
      txid: tx.hash,
      explorerUrl: `https://etherscan.io/tx/${tx.hash}`,
      tokenAddress: input.tokenAddress,
    };
  }

  private async sendSol(input: {
    mnemonic: string;
    to: string;
    amount: string;
    index: number;
    memo?: string;
    rpcUrl?: string;
  }): Promise<WalletSendResult> {
    const destination = new PublicKey(input.to);
    const amountLamports = parseAmountToUnits(input.amount, 9);
    if (amountLamports <= 0n) {
      throw new Error("Validation error: Amount must be greater than zero");
    }

    if (amountLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Validation error: SOL transfer amount is too large");
    }

    const connection = new Connection(
      this.resolveRpcUrl(input.rpcUrl, this.getSolRpc()),
      "confirmed"
    );
    const signer = this.deriveSolKeypair(input.mnemonic, input.index);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: destination,
        lamports: Number(amountLamports),
      })
    );

    if (input.memo?.trim()) {
      transaction.add(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(input.memo.trim(), "utf8"),
        })
      );
    }

    const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
      commitment: "confirmed",
    });

    return {
      chain: "sol",
      txid: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
    };
  }

  private async sendSolToken(input: {
    mnemonic: string;
    tokenAddress: string;
    to: string;
    amount: string;
    index: number;
    decimals?: number;
    memo?: string;
    rpcUrl?: string;
  }): Promise<WalletSendResult & { tokenAddress: string }> {
    const mint = new PublicKey(input.tokenAddress);
    const destinationOwner = new PublicKey(input.to);
    const connection = new Connection(
      this.resolveRpcUrl(input.rpcUrl, this.getSolRpc()),
      "confirmed"
    );
    const signer = this.deriveSolKeypair(input.mnemonic, input.index);

    const mintDecimals = await getMintDecimals(connection, mint, "confirmed");
    const decimals =
      typeof input.decimals === "number" && Number.isFinite(input.decimals)
        ? Math.max(0, Math.floor(input.decimals))
        : mintDecimals;

    const amountBaseUnits = parseAmountToUnits(input.amount, decimals);
    if (amountBaseUnits <= 0n) {
      throw new Error("Validation error: Amount must be greater than zero");
    }

    const senderTokenAccount = getAssociatedTokenAddressSync(
      mint,
      signer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const senderTokenAccountInfo = await connection.getAccountInfo(senderTokenAccount, "confirmed");
    if (!senderTokenAccountInfo) {
      throw new Error("Validation error: Source SPL token account not found for this wallet index");
    }

    const destinationTokenAccount = getAssociatedTokenAddressSync(
      mint,
      destinationOwner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const destinationTokenAccountInfo = await connection.getAccountInfo(
      destinationTokenAccount,
      "confirmed"
    );

    const transaction = new Transaction();
    if (!destinationTokenAccountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          signer.publicKey,
          destinationTokenAccount,
          destinationOwner,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    transaction.add(
      createTransferCheckedInstruction(
        senderTokenAccount,
        mint,
        destinationTokenAccount,
        signer.publicKey,
        amountBaseUnits,
        decimals,
        TOKEN_PROGRAM_ID
      )
    );

    if (input.memo?.trim()) {
      transaction.add(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(input.memo.trim(), "utf8"),
        })
      );
    }

    const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
      commitment: "confirmed",
    });

    return {
      chain: "sol",
      txid: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
      tokenAddress: input.tokenAddress,
    };
  }

  private async sendBtc(input: {
    mnemonic: string;
    to: string;
    amount: string;
    index: number;
    feeRate?: number;
  }): Promise<WalletSendResult> {
    if (!bitcoin) {
      throw new Error("BTC operations are unavailable");
    }
    const network = bitcoin.networks.bitcoin;
    try {
      bitcoin.address.toOutputScript(input.to, network);
    } catch {
      throw new Error("Validation error: Invalid BTC destination address");
    }

    const signer = this.deriveBtcSigner(input.mnemonic, input.index);
    const amountSats = parseAmountToUnits(input.amount, 8);
    if (amountSats <= 0n) {
      throw new Error("Validation error: Amount must be greater than zero");
    }

    const apiBase = this.getBtcApiBase();
    const utxos = await fetchJson<BtcUtxo[]>(`${apiBase}/address/${signer.address}/utxo`);
    if (!utxos.length) {
      throw new Error("Validation error: No spendable BTC balance available");
    }

    const feeRate =
      typeof input.feeRate === "number" && Number.isFinite(input.feeRate) && input.feeRate > 0
        ? Math.max(1, Math.round(input.feeRate))
        : await this.getRecommendedBtcFeeRate(apiBase);

    const selected: BtcUtxo[] = [];
    let selectedTotal = 0n;
    let estimatedFee = 0n;

    for (const utxo of [...utxos].sort((a, b) => b.value - a.value)) {
      selected.push(utxo);
      selectedTotal += BigInt(utxo.value);
      estimatedFee = this.estimateBtcFee(selected.length, 2, feeRate);

      if (selectedTotal >= amountSats + estimatedFee) {
        break;
      }
    }

    if (selectedTotal < amountSats + estimatedFee) {
      throw new Error("Validation error: Insufficient BTC balance for amount + fee");
    }

    const dustThreshold = 546n;
    let change = selectedTotal - amountSats - estimatedFee;
    if (change > 0n && change < dustThreshold) {
      change = 0n;
      estimatedFee = this.estimateBtcFee(selected.length, 1, feeRate);
      if (selectedTotal < amountSats + estimatedFee) {
        throw new Error("Validation error: Insufficient BTC balance after fee adjustment");
      }
      change = selectedTotal - amountSats - estimatedFee;
      if (change > 0n && change < dustThreshold) {
        change = 0n;
      }
    }

    const psbt = new bitcoin.Psbt({ network });

    for (const utxo of selected) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: signer.outputScript,
          value: BigInt(utxo.value),
        },
      });
    }

    psbt.addOutput({
      address: input.to,
      value: amountSats,
    });

    if (change > 0n) {
      psbt.addOutput({
        address: signer.address,
        value: change,
      });
    }

    for (let i = 0; i < selected.length; i++) {
      psbt.signInput(i, signer.keyPair);
    }

    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();

    const broadcastResponse = await fetch(`${apiBase}/tx`, {
      method: "POST",
      body: txHex,
      headers: {
        "content-type": "text/plain",
        "user-agent": "cybara-wallet/1.0",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!broadcastResponse.ok) {
      const reason = await broadcastResponse.text();
      throw new Error(`Wallet network request failed: ${broadcastResponse.status} ${reason}`);
    }

    const txid = (await broadcastResponse.text()).trim();
    return {
      chain: "btc",
      txid,
      explorerUrl: `https://mempool.space/tx/${txid}`,
    };
  }

  private async getRecommendedBtcFeeRate(apiBase: string): Promise<number> {
    try {
      const payload = await fetchJson<{
        fastestFee?: number;
        halfHourFee?: number;
        hourFee?: number;
      }>(`${apiBase}/v1/fees/recommended`);
      const candidate = payload.halfHourFee || payload.fastestFee || payload.hourFee || 3;
      return Math.max(1, Math.round(candidate));
    } catch {
      return 3;
    }
  }

  private estimateBtcFee(inputCount: number, outputCount: number, feeRate: number): bigint {
    const vbytes = 10 + inputCount * 68 + outputCount * 31;
    return BigInt(Math.ceil(vbytes * feeRate));
  }

  private deriveAccount(chain: WalletChain, index: number, mnemonic: string): WalletAccount {
    if (chain === "eth") {
      const account = this.deriveEthWallet(mnemonic, index);
      return { chain, index, path: account.path, address: account.address };
    }

    if (chain === "sol") {
      const path = this.getSolPath(index);
      const keypair = this.deriveSolKeypair(mnemonic, index);
      return { chain, index, path, address: keypair.publicKey.toBase58() };
    }

    if (chain === "btc") {
      const signer = this.deriveBtcSigner(mnemonic, index);
      return { chain, index, path: signer.path, address: signer.address };
    }

    throw new Error(`Validation error: Unsupported chain '${String(chain)}'`);
  }

  private getPrimaryAddresses(mnemonic: string): Record<WalletChain, string> {
    let btcAddress = "";
    try {
      btcAddress = this.deriveAccount("btc", 0, mnemonic).address;
    } catch {
      // BTC derivation requires WASM; gracefully degrade
    }
    return {
      eth: this.deriveAccount("eth", 0, mnemonic).address,
      btc: btcAddress,
      sol: this.deriveAccount("sol", 0, mnemonic).address,
    };
  }

  private deriveEthWallet(
    mnemonic: string,
    index: number
  ): { path: string; address: string; wallet: HDNodeWallet } {
    const path = this.getEthPath(index);
    const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return {
      path,
      address: wallet.address,
      wallet,
    };
  }

  private deriveSolKeypair(mnemonic: string, index: number): Keypair {
    const path = this.getSolPath(index);
    const seed = Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex");
    const derived = deriveEd25519Path(path, seed);
    return Keypair.fromSeed(derived.key.slice(0, 32));
  }

  private deriveBtcSigner(
    mnemonic: string,
    index: number
  ): {
    path: string;
    address: string;
    keyPair: ReturnType<NonNullable<typeof ECPair>["fromPrivateKey"]>;
    outputScript: Uint8Array;
  } {
    if (!bip32 || !ECPair || !bitcoin) {
      throw new Error(
        "BTC operations are unavailable: tiny-secp256k1 WASM failed to initialize on this platform"
      );
    }
    const path = this.getBtcPath(index);
    const seed = mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const child = root.derivePath(path);

    if (!child.privateKey) {
      throw new Error("Wallet derivation failed: BTC private key missing");
    }

    const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey), {
      network: bitcoin.networks.bitcoin,
    });

    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keyPair.publicKey),
      network: bitcoin.networks.bitcoin,
    });

    if (!payment.address || !payment.output) {
      throw new Error("Wallet derivation failed: Could not derive BTC address");
    }

    return {
      path,
      address: payment.address,
      keyPair,
      outputScript: payment.output,
    };
  }

  private getEthPath(index: number): string {
    return `m/44'/60'/0'/0/${index}`;
  }

  private getBtcPath(index: number): string {
    return `m/84'/0'/0'/0/${index}`;
  }

  private getSolPath(index: number): string {
    return `m/44'/501'/${index}'/0'`;
  }

  private async quoteUniswapV3ExactInputSingle(input: {
    provider: JsonRpcProvider;
    tokenIn: string;
    tokenOut: string;
    feeTier: number;
    amountIn: bigint;
  }): Promise<bigint> {
    try {
      const quoterV2 = new Contract(
        UNISWAP_V3_QUOTER_V2_ETH,
        [
          "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
        ],
        input.provider
      );
      const quoteMethod = (
        quoterV2 as unknown as Record<
          string,
          { staticCall?: (...args: unknown[]) => Promise<unknown> } | undefined
        >
      ).quoteExactInputSingle;
      const params = {
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amountIn: input.amountIn,
        fee: input.feeTier,
        sqrtPriceLimitX96: 0,
      };
      const quoteValue =
        quoteMethod && typeof quoteMethod.staticCall === "function"
          ? await quoteMethod.staticCall(params)
          : await (
              quoterV2 as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
            ).quoteExactInputSingle(params);

      const amountOut = parseBigIntOrZero(
        Array.isArray(quoteValue)
          ? quoteValue[0]
          : ((quoteValue as { amountOut?: unknown })?.amountOut ?? quoteValue)
      );
      if (amountOut > 0n) {
        return amountOut;
      }
    } catch {
      void 0;
    }

    const legacyQuoter = new Contract(
      UNISWAP_V3_QUOTER_LEGACY_ETH,
      [
        "function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
      ],
      input.provider
    );
    const legacyMethod = (
      legacyQuoter as unknown as Record<
        string,
        { staticCall?: (...args: unknown[]) => Promise<unknown> } | undefined
      >
    ).quoteExactInputSingle;
    const legacyValue =
      legacyMethod && typeof legacyMethod.staticCall === "function"
        ? await legacyMethod.staticCall(
            input.tokenIn,
            input.tokenOut,
            input.feeTier,
            input.amountIn,
            0
          )
        : await (
            legacyQuoter as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
          ).quoteExactInputSingle(input.tokenIn, input.tokenOut, input.feeTier, input.amountIn, 0);
    return parseBigIntOrZero(legacyValue);
  }

  private async resolveChainlinkFeedAddress(input: {
    base: string;
    quote: string;
    provider: JsonRpcProvider;
  }): Promise<string> {
    const rawBase = String(input.base || "").trim();
    const base = normalizeTicker(rawBase);
    const quote = normalizeTicker(input.quote);
    if (quote !== "USD") {
      return "";
    }

    const staticFeed = CHAINLINK_USD_FEEDS[base] || "";
    const baseAsset = isEvmAddress(rawBase) ? rawBase : CHAINLINK_BASE_ASSETS[base];
    if (!baseAsset || !isEvmAddress(baseAsset)) {
      return staticFeed;
    }

    try {
      const registry = new Contract(
        CHAINLINK_FEED_REGISTRY_ETH,
        ["function getFeed(address base, address quote) view returns (address feed)"],
        input.provider
      );
      const registryFeed = String(await registry.getFeed(baseAsset, CHAINLINK_DENOMINATION_USD));
      if (isEvmAddress(registryFeed) && registryFeed.toLowerCase() !== ZERO_EVM_ADDRESS) {
        return registryFeed;
      }
    } catch {
      void 0;
    }

    return staticFeed;
  }

  private resolveSolMint(input: string): string {
    const normalized = input.trim();
    if (isEvmAddress(normalized)) {
      throw new Error("Validation error: Expected a Solana mint, got an EVM address");
    }

    const upper = normalizeTicker(normalized);
    const commonMints: Record<string, string> = {
      SOL: SOL_MINT,
      USDC: USDC_SOL_MINT,
      USDT: "Es9vMFrzaCERmJfr8j7Xw4eE3f7zQht4p59SJ4f5kL7Q",
    };

    const mint = commonMints[upper] || normalized;
    try {
      return new PublicKey(mint).toBase58();
    } catch {
      throw new Error(`Validation error: Invalid Solana mint '${input}'`);
    }
  }

  private async resolvePythFeedId(input: {
    pythFeedId?: string;
    symbol?: string;
    pair?: string;
  }): Promise<string> {
    if (typeof input.pythFeedId === "string" && input.pythFeedId.trim()) {
      return normalizeFeedId(input.pythFeedId);
    }

    const pair = input.pair ? normalizeTicker(input.pair) : "";
    const symbol = input.symbol ? normalizeTicker(input.symbol) : "";
    const query = pair || `${symbol}/USD`;
    if (!query || !query.includes("/")) {
      throw new Error("Validation error: Could not resolve Pyth feed query");
    }

    const searchUrl = `${PYTH_HERMES_API_BASE}/price_feeds?query=${encodeURIComponent(
      query
    )}&asset_type=crypto`;
    const searchResults =
      await fetchJson<
        Array<{ id?: string; attributes?: { display_symbol?: string; symbol?: string } }>
      >(searchUrl);

    const exactMatch = searchResults.find((feed) => {
      const display = normalizeTicker(String(feed.attributes?.display_symbol || ""));
      return display === query;
    });
    const selected = exactMatch || searchResults[0];
    if (!selected?.id || typeof selected.id !== "string") {
      throw new Error(`Validation error: Could not resolve Pyth feed id for '${query}'`);
    }

    return normalizeFeedId(selected.id);
  }

  private formatScaledSignedInteger(rawValue: string, exponent: number): string {
    const trimmed = rawValue.trim();
    if (!trimmed) return "0";

    const isNegative = trimmed.startsWith("-");
    const absValue = BigInt(isNegative ? trimmed.slice(1) : trimmed);
    const sign = isNegative ? "-" : "";

    if (exponent >= 0) {
      return `${sign}${(absValue * 10n ** BigInt(exponent)).toString()}`;
    }

    const decimals = Math.abs(exponent);
    const scale = 10n ** BigInt(decimals);
    const whole = absValue / scale;
    const fraction = (absValue % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
    if (!fraction) {
      return `${sign}${whole.toString()}`;
    }
    return `${sign}${whole.toString()}.${fraction}`;
  }

  private async getSolMintDecimals(connection: Connection, mint: string): Promise<number> {
    const normalizedMint = this.resolveSolMint(mint);
    if (normalizedMint === SOL_MINT) {
      return 9;
    }
    return await getMintDecimals(connection, new PublicKey(normalizedMint), "confirmed");
  }

  private async resolveJupiterAmountRaw(input: {
    connection: Connection;
    owner: PublicKey;
    inputMint: string;
    inputAmount?: string;
    inputAmountRaw?: string;
    inputPercent?: number;
    inputDecimals: number;
  }): Promise<bigint> {
    const amountRawInput =
      typeof input.inputAmountRaw === "string" ? input.inputAmountRaw.trim() : "";
    const amountInput = typeof input.inputAmount === "string" ? input.inputAmount.trim() : "";
    const percent =
      typeof input.inputPercent === "number" && Number.isFinite(input.inputPercent)
        ? input.inputPercent
        : undefined;

    if (!amountRawInput && !amountInput && percent === undefined) {
      throw new Error("Validation error: amount, amountRaw, or percent is required");
    }
    if (
      [Boolean(amountRawInput), Boolean(amountInput), percent !== undefined].filter(Boolean)
        .length > 1
    ) {
      throw new Error("Validation error: Use only one of amount, amountRaw, or percent");
    }

    if (amountRawInput) {
      if (!/^\d+$/.test(amountRawInput)) {
        throw new Error("Validation error: amountRaw must be a positive integer string");
      }
      const parsed = BigInt(amountRawInput);
      if (parsed <= 0n) {
        throw new Error("Validation error: amountRaw must be greater than zero");
      }
      return parsed;
    }

    if (amountInput) {
      const parsed = parseAmountToUnits(amountInput, input.inputDecimals);
      if (parsed <= 0n) {
        throw new Error("Validation error: amount must be greater than zero");
      }
      return parsed;
    }

    const normalizedInputMint = this.resolveSolMint(input.inputMint);
    let balanceRaw = 0n;
    if (normalizedInputMint === SOL_MINT) {
      balanceRaw = BigInt(await input.connection.getBalance(input.owner, "confirmed"));
    } else {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(normalizedInputMint),
        input.owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      try {
        const balance = await input.connection.getTokenAccountBalance(ata, "confirmed");
        balanceRaw = BigInt(balance.value.amount || "0");
      } catch {
        balanceRaw = 0n;
      }
    }

    if (balanceRaw <= 0n) {
      throw new Error("Validation error: Input token balance is zero");
    }

    const safePercent = Math.min(100, Math.max(0, Number(percent)));
    if (safePercent <= 0) {
      throw new Error("Validation error: percent must be greater than zero");
    }
    const scaledPercent = BigInt(Math.round(safePercent * 10_000));
    const amountRaw = (balanceRaw * scaledPercent) / 1_000_000n;
    if (amountRaw <= 0n) {
      throw new Error("Validation error: percent resolves to zero input amount");
    }
    return amountRaw;
  }

  private parseEthContractAbi(abiInput: string | undefined, methodSignature: string): unknown {
    const normalizedAbi = typeof abiInput === "string" ? abiInput.trim() : "";
    if (!normalizedAbi && !methodSignature) {
      throw new Error(
        "Validation error: Contract ABI is required unless methodSignature is provided"
      );
    }

    if (!normalizedAbi) {
      const fragment = methodSignature.startsWith("function ")
        ? methodSignature
        : `function ${methodSignature}`;
      return [fragment];
    }

    try {
      if (normalizedAbi.startsWith("[") || normalizedAbi.startsWith("{")) {
        return JSON.parse(normalizedAbi) as unknown;
      }
      return [normalizedAbi.startsWith("function ") ? normalizedAbi : `function ${normalizedAbi}`];
    } catch {
      throw new Error("Validation error: Invalid contract ABI payload");
    }
  }

  private buildEthContractOverrides(
    input: EthContractCallInput
  ): Record<string, unknown> | undefined {
    const overrides: Record<string, unknown> = {};

    if (typeof input.value === "string" && input.value.trim()) {
      overrides.value = parseEther(input.value.trim());
    }

    if (input.gasLimit !== undefined) {
      const gasLimitRaw =
        typeof input.gasLimit === "number" ? String(Math.floor(input.gasLimit)) : input.gasLimit;
      if (!/^\d+$/.test(gasLimitRaw.trim())) {
        throw new Error("Validation error: gasLimit must be a positive integer");
      }
      const gasLimit = BigInt(gasLimitRaw.trim());
      if (gasLimit <= 0n) {
        throw new Error("Validation error: gasLimit must be greater than zero");
      }
      overrides.gasLimit = gasLimit;
    }

    if (typeof input.gasPriceGwei === "string" && input.gasPriceGwei.trim()) {
      overrides.gasPrice = parseAmountToUnits(input.gasPriceGwei.trim(), 9);
    }

    if (typeof input.maxFeePerGasGwei === "string" && input.maxFeePerGasGwei.trim()) {
      overrides.maxFeePerGas = parseAmountToUnits(input.maxFeePerGasGwei.trim(), 9);
    }

    if (
      typeof input.maxPriorityFeePerGasGwei === "string" &&
      input.maxPriorityFeePerGasGwei.trim()
    ) {
      overrides.maxPriorityFeePerGas = parseAmountToUnits(input.maxPriorityFeePerGasGwei.trim(), 9);
    }

    if (input.nonce !== undefined) {
      const nonce = Math.floor(Number(input.nonce));
      if (!Number.isFinite(nonce) || nonce < 0) {
        throw new Error("Validation error: nonce must be a non-negative integer");
      }
      overrides.nonce = nonce;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  private resolveEthContractMethod(
    contract: Contract,
    method: string,
    methodSignature: string
  ): ((...fnArgs: unknown[]) => Promise<unknown>) & {
    staticCall?: (...fnArgs: unknown[]) => Promise<unknown>;
  } {
    const methodCandidates = [methodSignature, normalizeEthMethodSelector(methodSignature), method]
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const candidate of methodCandidates) {
      const contractWithGetFunction = contract as Contract & {
        getFunction?: (name: string) => unknown;
      };
      if (typeof contractWithGetFunction.getFunction === "function") {
        try {
          const resolved = contractWithGetFunction.getFunction(candidate);
          if (typeof resolved === "function") {
            return resolved as ((...fnArgs: unknown[]) => Promise<unknown>) & {
              staticCall?: (...fnArgs: unknown[]) => Promise<unknown>;
            };
          }
        } catch {
          void 0;
        }
      }

      const methodFn = (contract as unknown as Record<string, unknown>)[candidate];
      if (typeof methodFn === "function") {
        return methodFn as ((...fnArgs: unknown[]) => Promise<unknown>) & {
          staticCall?: (...fnArgs: unknown[]) => Promise<unknown>;
        };
      }
    }

    throw new Error("Validation error: Contract method not found in ABI");
  }

  private getEthRpc(): string {
    const configured = config.get<string>(ETH_RPC_CONFIG_KEY);
    return typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_ETH_RPC;
  }

  private getSolRpc(): string {
    const configured = config.get<string>(SOL_RPC_CONFIG_KEY);
    return typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_SOL_RPC;
  }

  private resolveRpcUrl(userUrl: string | undefined, fallback: string): string {
    const trimmed = typeof userUrl === "string" ? userUrl.trim() : "";
    if (!trimmed) return fallback;
    return assertPublicHttpUrl(trimmed, "RPC URL");
  }

  private getBtcApiBase(): string {
    const configured = config.get<string>(BTC_API_CONFIG_KEY);
    if (typeof configured === "string" && configured.trim()) {
      return this.normalizeBtcApiBase(configured);
    }
    return DEFAULT_BTC_API_BASE;
  }

  private normalizeBtcApiBase(input: string): string {
    return input.trim().replace(/\/+$/, "");
  }

  private validateHttpUrl(url: string, label: string): void {
    const candidate = url.trim();
    if (!candidate) {
      throw new Error(`Validation error: ${label} cannot be empty`);
    }
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      throw new Error(`Validation error: ${label} must be a valid HTTP/HTTPS URL`);
    }
  }

  private getDefaultAgentPolicy(): WalletAgentPolicy {
    return {
      allowNativeSend: false,
      allowTokenSend: false,
      allowEthContractWrite: false,
      allowSolProgramInstruction: false,
      allowEthSwaps: false,
      allowDappInteraction: false,
      allowX402Payments: false,
      allowedEthContracts: [],
      allowedSolPrograms: [],
      allowedDappHosts: [],
      allowedX402Networks: [],
      x402MaxAmountAtomic: X402_AGENT_MAX_DEFAULT_ATOMIC,
      allowedSendRecipients: [],
      maxSendAmount: "",
    };
  }

  private normalizeAgentPolicy(
    input: Partial<WalletAgentPolicy>,
    strict = false
  ): WalletAgentPolicy {
    const defaults = this.getDefaultAgentPolicy();
    const source = input || {};

    const allowNativeSend = source.allowNativeSend === true;
    const allowTokenSend = source.allowTokenSend === true;
    const allowEthContractWrite = source.allowEthContractWrite === true;
    const allowSolProgramInstruction = source.allowSolProgramInstruction === true;
    const allowEthSwaps = source.allowEthSwaps === true;
    const allowDappInteraction = source.allowDappInteraction === true;
    const allowX402Payments = source.allowX402Payments === true;

    const allowedEthContractsRaw = Array.isArray(source.allowedEthContracts)
      ? normalizeAddressList(source.allowedEthContracts)
      : defaults.allowedEthContracts;
    const allowedEthContracts: string[] = [];
    for (const contractAddress of allowedEthContractsRaw) {
      if (isEvmAddress(contractAddress)) {
        allowedEthContracts.push(contractAddress.toLowerCase());
      } else if (strict) {
        throw new Error(`Validation error: Invalid ETH contract address '${contractAddress}'`);
      }
    }

    const allowedSolProgramsRaw = Array.isArray(source.allowedSolPrograms)
      ? normalizeAddressList(source.allowedSolPrograms)
      : defaults.allowedSolPrograms;
    const allowedSolPrograms: string[] = [];
    for (const programId of allowedSolProgramsRaw) {
      try {
        const normalized = new PublicKey(programId).toBase58();
        allowedSolPrograms.push(normalized);
      } catch {
        if (strict) {
          throw new Error(`Validation error: Invalid Solana program id '${programId}'`);
        }
      }
    }

    const allowedDappHostsRaw = Array.isArray(source.allowedDappHosts)
      ? normalizeHostList(source.allowedDappHosts)
      : defaults.allowedDappHosts;
    if (strict && Array.isArray(source.allowedDappHosts)) {
      for (const hostValue of source.allowedDappHosts) {
        if (typeof hostValue !== "string" || !hostValue.trim()) {
          throw new Error("Validation error: Invalid dapp host entry");
        }
      }
    }

    const allowedX402NetworksRaw = Array.isArray(source.allowedX402Networks)
      ? normalizeNetworkList(source.allowedX402Networks)
      : defaults.allowedX402Networks;
    if (strict && Array.isArray(source.allowedX402Networks)) {
      for (const networkValue of source.allowedX402Networks) {
        if (typeof networkValue !== "string" || !networkValue.trim()) {
          throw new Error("Validation error: Invalid x402 network entry");
        }
      }
    }

    let x402MaxAmountAtomic = defaults.x402MaxAmountAtomic;
    if (typeof source.x402MaxAmountAtomic === "string" && source.x402MaxAmountAtomic.trim()) {
      if (!/^\d+$/.test(source.x402MaxAmountAtomic.trim())) {
        if (strict) {
          throw new Error("Validation error: x402MaxAmountAtomic must be a positive integer");
        }
      } else {
        const parsed = BigInt(source.x402MaxAmountAtomic.trim());
        if (parsed <= 0n) {
          if (strict) {
            throw new Error("Validation error: x402MaxAmountAtomic must be greater than zero");
          }
        } else {
          x402MaxAmountAtomic = parsed.toString();
        }
      }
    }

    const allowedSendRecipients = Array.isArray(source.allowedSendRecipients)
      ? [...new Set(normalizeAddressList(source.allowedSendRecipients))]
      : defaults.allowedSendRecipients;

    let maxSendAmount = defaults.maxSendAmount;
    if (typeof source.maxSendAmount === "string" && source.maxSendAmount.trim()) {
      const n = Number(source.maxSendAmount.trim());
      if (!Number.isFinite(n) || n < 0) {
        if (strict) {
          throw new Error("Validation error: maxSendAmount must be a non-negative number");
        }
      } else {
        maxSendAmount = source.maxSendAmount.trim();
      }
    }

    return {
      allowNativeSend,
      allowTokenSend,
      allowEthContractWrite,
      allowSolProgramInstruction,
      allowEthSwaps,
      allowDappInteraction,
      allowX402Payments,
      allowedEthContracts: [...new Set(allowedEthContracts)],
      allowedSolPrograms: [...new Set(allowedSolPrograms)],
      allowedDappHosts: [...new Set(allowedDappHostsRaw)],
      allowedX402Networks: [...new Set(allowedX402NetworksRaw)],
      x402MaxAmountAtomic,
      allowedSendRecipients,
      maxSendAmount,
    };
  }

  private assertAgentUrlAllowedByPolicy(
    urlInput: string,
    policy: WalletAgentPolicy,
    context: "dapp" | "x402"
  ): void {
    this.validateHttpUrl(urlInput, "URL");
    assertPublicHttpUrl(urlInput, "URL");
    if (policy.allowedDappHosts.length === 0) {
      return;
    }
    const parsed = new URL(urlInput);
    const host = parsed.host.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    for (const entry of policy.allowedDappHosts) {
      const allowed = String(entry || "")
        .trim()
        .toLowerCase();
      if (!allowed) continue;
      if (allowed.includes(":")) {
        if (host === allowed) return;
        continue;
      }
      if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
        return;
      }
    }
    throw new Error(
      `Validation error: ${context.toUpperCase()} host '${host}' is not allowlisted by wallet policy`
    );
  }

  private normalizeDappAdapter(adapterInput: string): WalletDappAdapter {
    const adapter = String(adapterInput || "")
      .trim()
      .toLowerCase();
    if (adapter === "rpc_call" || adapter === "rpc" || adapter === "rpc-call") {
      return "rpc_call";
    }
    if (
      adapter === "eth_contract_call" ||
      adapter === "evm_contract" ||
      adapter === "evm_contract_call" ||
      adapter === "contract"
    ) {
      return "eth_contract_call";
    }
    if (
      adapter === "sol_program_instruction" ||
      adapter === "sol_instruction" ||
      adapter === "solana_program_instruction"
    ) {
      return "sol_program_instruction";
    }
    if (adapter === "swap") return "swap";
    if (adapter === "price" || adapter === "price_quote") return "price";
    if (adapter === "x402_http" || adapter === "x402" || adapter === "pay") {
      return "x402_http";
    }
    throw new Error(`Validation error: Unsupported dapp adapter '${adapterInput}'`);
  }

  private async decodeX402PaymentRequired(
    response: Response
  ): Promise<WalletX402PaymentRequiredV2 | WalletX402PaymentRequiredV1> {
    const encoded = response.headers.get(X402_REQUIRED_HEADER);
    if (encoded && encoded.trim()) {
      try {
        const decoded = Buffer.from(encoded.trim(), "base64").toString("utf8");
        const parsed = JSON.parse(decoded) as
          | WalletX402PaymentRequiredV2
          | WalletX402PaymentRequiredV1;
        if (
          parsed &&
          Array.isArray(parsed.accepts) &&
          (parsed.x402Version === 1 || parsed.x402Version === 2)
        ) {
          return parsed;
        }
      } catch {
        throw new Error("Validation error: Invalid PAYMENT-REQUIRED header payload");
      }
    }

    const bodyText = await response.text().catch(() => "");
    if (bodyText.trim()) {
      try {
        const parsed = JSON.parse(bodyText) as
          | WalletX402PaymentRequiredV2
          | WalletX402PaymentRequiredV1;
        if (
          parsed &&
          Array.isArray(parsed.accepts) &&
          (parsed.x402Version === 1 || parsed.x402Version === 2)
        ) {
          return parsed;
        }
      } catch {
        void 0;
      }
    }

    throw new Error("Validation error: Could not decode x402 payment requirements");
  }

  private selectX402Requirement(
    required: WalletX402PaymentRequiredV2 | WalletX402PaymentRequiredV1,
    requestedNetwork?: string
  ): WalletX402SelectedRequirement {
    const requested = requestedNetwork?.trim().toLowerCase();
    const candidates: WalletX402SelectedRequirement[] = [];

    if (required.x402Version === 2) {
      for (const entry of required.accepts || []) {
        const scheme = String(entry.scheme || "").toLowerCase();
        if (!X402_AGENT_SUPPORTED_SCHEMES.has(scheme)) continue;
        const network = String(entry.network || "");
        const networkFamily = parseX402NetworkFamily(network);
        if (!networkFamily) continue;
        candidates.push({
          x402Version: 2,
          scheme,
          network,
          networkFamily,
          amount: String(entry.amount || ""),
          asset: String(entry.asset || ""),
          payTo: String(entry.payTo || ""),
          maxTimeoutSeconds: Number.isFinite(Number(entry.maxTimeoutSeconds))
            ? Math.max(30, Number(entry.maxTimeoutSeconds))
            : 60,
          extra: entry.extra,
          resource: required.resource,
          extensions: required.extensions,
        });
      }
    } else {
      for (const entry of required.accepts || []) {
        const scheme = String(entry.scheme || "").toLowerCase();
        if (!X402_AGENT_SUPPORTED_SCHEMES.has(scheme)) continue;
        const network = String(entry.network || "");
        const networkFamily = parseX402NetworkFamily(network);
        if (!networkFamily) continue;
        candidates.push({
          x402Version: 1,
          scheme,
          network,
          networkFamily,
          amount: String(entry.maxAmountRequired || ""),
          asset: String(entry.asset || ""),
          payTo: String(entry.payTo || ""),
          maxTimeoutSeconds: Number.isFinite(Number(entry.maxTimeoutSeconds))
            ? Math.max(30, Number(entry.maxTimeoutSeconds))
            : 60,
          extra: entry.extra,
        });
      }
    }

    const filtered = requested
      ? candidates.filter((candidate) => candidate.network.toLowerCase() === requested)
      : candidates;
    const selected = filtered[0];
    if (!selected) {
      throw new Error(
        requested
          ? `Validation error: No x402 requirement for network '${requestedNetwork}'`
          : "Validation error: No supported x402 payment requirement found for configured schemes"
      );
    }
    return selected;
  }

  private async createX402PaymentHeader(input: {
    required: WalletX402PaymentRequiredV2 | WalletX402PaymentRequiredV1;
    requirement: WalletX402SelectedRequirement;
    index: number;
    requestUrl: string;
  }): Promise<{ name: string; value: string }> {
    const requirement = input.requirement;
    if (requirement.networkFamily === "evm") {
      if (!isEvmAddress(requirement.asset)) {
        throw new Error("Validation error: x402 payment asset must be an EVM token address");
      }
      if (!isEvmAddress(requirement.payTo)) {
        throw new Error("Validation error: x402 payTo must be a valid EVM address");
      }
    } else {
      try {
        new PublicKey(requirement.asset);
      } catch {
        throw new Error("Validation error: x402 payment asset must be a valid Solana mint address");
      }
      try {
        new PublicKey(requirement.payTo);
      } catch {
        throw new Error("Validation error: x402 payTo must be a valid Solana address");
      }
    }

    const unlocked = this.requireUnlocked();
    const index = normalizeStartIndex(input.index);
    const evmWallet = this.deriveEthWallet(unlocked.mnemonic, index).wallet;
    const solKeypair = this.deriveSolKeypair(unlocked.mnemonic, index);
    const solSigner = await createKeyPairSignerFromBytes(solKeypair.secretKey);

    const evmSigner = toClientEvmSigner({
      address: evmWallet.address as `0x${string}`,
      signTypedData: async ({ domain, types, message }) => {
        const signature = await evmWallet.signTypedData(
          domain as TypedDataDomain,
          (types || {}) as Record<string, Array<{ name: string; type: string }>>,
          message as Record<string, unknown>
        );
        return signature as `0x${string}`;
      },
    });

    const selector: X402SelectPaymentRequirements = (_x402Version, paymentRequirements) => {
      const selected = paymentRequirements.find((entry) => {
        const candidate = entry as Record<string, unknown>;
        const candidateAmount =
          typeof candidate.amount === "string"
            ? candidate.amount
            : typeof candidate.maxAmountRequired === "string"
              ? candidate.maxAmountRequired
              : "";
        return (
          String(candidate.scheme || "").toLowerCase() === requirement.scheme.toLowerCase() &&
          String(candidate.network || "").toLowerCase() === requirement.network.toLowerCase() &&
          String(candidateAmount) === requirement.amount
        );
      });
      if (!selected) {
        throw new Error(
          `Validation error: Could not select x402 requirement for ${requirement.network} ${requirement.scheme}`
        );
      }
      return selected;
    };

    const evmScheme = new ExactEvmScheme(evmSigner);
    const evmSchemeV1 = new ExactEvmSchemeV1(evmSigner);
    const svmScheme = new ExactSvmScheme(toClientSvmSigner(solSigner), {
      rpcUrl: this.getSolRpc(),
    });
    const svmSchemeV1 = new ExactSvmSchemeV1(toClientSvmSigner(solSigner), {
      rpcUrl: this.getSolRpc(),
    });
    const x402Client = new X402Client(selector)
      .register("eip155:*", evmScheme)
      .register("solana:*", svmScheme);

    for (const network of Object.keys(X402_V1_EVM_NETWORK_CHAIN_IDS)) {
      x402Client.registerV1(network, evmSchemeV1);
    }
    for (const network of X402_V1_SOLANA_NETWORKS) {
      x402Client.registerV1(network, svmSchemeV1);
    }

    const paymentClient = new X402HttpClient(x402Client);
    const paymentRequiredPayload =
      input.required.x402Version === 2
        ? {
            x402Version: 2 as const,
            error: input.required.error,
            resource: input.required.resource || {
              url: input.requestUrl,
              description: "x402 protected resource",
              mimeType: "application/json",
            },
            accepts: (input.required.accepts || []).map((entry) => ({
              scheme: String(entry.scheme || ""),
              network: String(entry.network || ""),
              amount: String(entry.amount || ""),
              asset: String(entry.asset || ""),
              payTo: String(entry.payTo || ""),
              maxTimeoutSeconds: Number.isFinite(Number(entry.maxTimeoutSeconds))
                ? Math.max(30, Number(entry.maxTimeoutSeconds))
                : 60,
              extra: (entry.extra || {}) as Record<string, unknown>,
            })),
            extensions: input.required.extensions || {},
          }
        : {
            x402Version: 1 as const,
            error: input.required.error,
            accepts: (input.required.accepts || []).map((entry) => ({
              scheme: String(entry.scheme || ""),
              network: String(entry.network || ""),
              maxAmountRequired: String(entry.maxAmountRequired || ""),
              resource: input.requestUrl,
              description: "x402 protected resource",
              mimeType: "application/json",
              outputSchema: {},
              payTo: String(entry.payTo || ""),
              maxTimeoutSeconds: Number.isFinite(Number(entry.maxTimeoutSeconds))
                ? Math.max(30, Number(entry.maxTimeoutSeconds))
                : 60,
              asset: String(entry.asset || ""),
              extra: (entry.extra || {}) as Record<string, unknown>,
            })),
          };

    const paymentPayload = await paymentClient.createPaymentPayload(
      paymentRequiredPayload as never
    );
    const paymentHeaders = paymentClient.encodePaymentSignatureHeader(paymentPayload);
    const [name, value] = Object.entries(paymentHeaders)[0] || [];
    if (!name || typeof value !== "string" || !value.trim()) {
      throw new Error("Validation error: Failed to create x402 payment signature header");
    }
    return { name, value };
  }

  private decodeX402SettlementResponse(headers: Headers): WalletX402SettlementResponse | undefined {
    const encoded =
      headers.get(X402_RESPONSE_HEADER) || headers.get(X402_LEGACY_RESPONSE_HEADER) || "";
    if (!encoded.trim()) {
      return undefined;
    }
    try {
      const decoded = Buffer.from(encoded.trim(), "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as WalletX402SettlementResponse;
      return parsed;
    } catch {
      return { success: false, errorReason: "invalid_settlement_response" };
    }
  }

  private serializeResponseHeaders(headers: Headers): Record<string, string> {
    const collected: Record<string, string> = {};
    for (const [name, value] of headers.entries()) {
      collected[name] = value;
    }
    return collected;
  }

  private async buildX402Result(input: {
    response: Response;
    url: string;
    method: string;
    paid: boolean;
    attemptedPayment: boolean;
    paymentHeaderUsed?: string;
    paymentRequirement?: WalletX402SelectedRequirement;
    settlement?: WalletX402SettlementResponse;
    parseJsonResponse: boolean;
  }): Promise<WalletX402RequestResult> {
    const contentType = input.response.headers.get("content-type") || "";
    const bodyText = await input.response.text().catch(() => "");
    let body: unknown = bodyText;
    if (input.parseJsonResponse && bodyText && contentType.includes("application/json")) {
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        body = bodyText;
      }
    }

    return {
      url: input.url,
      method: input.method,
      status: input.response.status,
      paid: input.paid,
      attemptedPayment: input.attemptedPayment,
      paymentHeaderUsed: input.paymentHeaderUsed,
      paymentRequirement: input.paymentRequirement
        ? {
            x402Version: input.paymentRequirement.x402Version,
            scheme: input.paymentRequirement.scheme,
            network: input.paymentRequirement.network,
            amount: input.paymentRequirement.amount,
            asset: input.paymentRequirement.asset,
            payTo: input.paymentRequirement.payTo,
            maxTimeoutSeconds: input.paymentRequirement.maxTimeoutSeconds,
            extra: input.paymentRequirement.extra,
          }
        : undefined,
      settlement: input.settlement,
      responseHeaders: this.serializeResponseHeaders(input.response.headers),
      body,
    };
  }

  private async checkEthRpc(endpoint: string): Promise<WalletRpcServiceStatus> {
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint, {
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
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { result?: string; error?: { message?: string } };
      if (payload.error) {
        throw new Error(payload.error.message || "RPC error");
      }
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
        error: (error as Error).message,
      };
    }
  }

  private async checkSolRpc(endpoint: string): Promise<WalletRpcServiceStatus> {
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint, {
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
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        result?: number;
        error?: { message?: string };
      };
      if (payload.error) {
        throw new Error(payload.error.message || "RPC error");
      }
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
        error: (error as Error).message,
      };
    }
  }

  private async checkBtcApi(endpoint: string): Promise<WalletRpcServiceStatus> {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${this.normalizeBtcApiBase(endpoint)}/blocks/tip/height`, {
        headers: { "user-agent": "cybara-wallet/1.0" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const height = (await response.text()).trim();
      if (!height) {
        throw new Error("Empty height response");
      }
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
        error: (error as Error).message,
      };
    }
  }

  private async resolveEthTokenTarget(
    tokenOut: string,
    provider: JsonRpcProvider
  ): Promise<{ address: string; symbol: string; name?: string; decimals: number }> {
    const tokenOutValue = String(tokenOut || "");
    const tokenOutIsAddress = isValidEvmAddress(tokenOutValue);
    if (tokenOutIsAddress) {
      return await this.readEthTokenMetadata(tokenOutValue, provider);
    }

    const symbol = tokenOutValue.trim().toUpperCase();
    if (!symbol) {
      throw new Error("Validation error: tokenOut symbol is required");
    }

    const commonTokenBySymbol: Record<string, string> = {
      WETH: WETH_MAINNET,
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
      UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    };

    let address = commonTokenBySymbol[symbol];
    if (!address) {
      const tokenList = await this.getUniswapTokenList();
      const match = tokenList.find((token) => token.symbol.toUpperCase() === symbol);
      if (!match) {
        throw new Error(`Validation error: Could not resolve ETH token symbol '${symbol}'`);
      }
      address = match.address;
    }

    return await this.readEthTokenMetadata(address, provider);
  }

  private async readEthTokenMetadata(
    tokenAddress: string,
    provider: JsonRpcProvider
  ): Promise<{ address: string; symbol: string; name?: string; decimals: number }> {
    const contract = new Contract(
      tokenAddress,
      [
        "function symbol() view returns (string)",
        "function name() view returns (string)",
        "function decimals() view returns (uint8)",
      ],
      provider
    );

    const [symbol, name, decimalsRaw] = await Promise.all([
      contract
        .symbol()
        .then((value: string) => String(value || "").trim())
        .catch(() => "ERC20"),
      contract
        .name()
        .then((value: string) => String(value || "").trim())
        .catch(() => undefined),
      contract
        .decimals()
        .then((value: number) => Number(value))
        .catch(() => 18),
    ]);

    return {
      address: tokenAddress,
      symbol: symbol || "ERC20",
      name,
      decimals: Number.isFinite(decimalsRaw) ? Math.max(0, Math.min(36, decimalsRaw)) : 18,
    };
  }

  private async getUniswapTokenList(): Promise<
    Array<{ address: string; symbol: string; name?: string; decimals: number; chainId: number }>
  > {
    const cached = this.uniswapTokenListCache;
    if (cached && Date.now() - cached.loadedAtMs < 10 * 60_000) {
      return cached.tokens;
    }

    const payload = await fetchJson<{
      tokens?: Array<{
        address?: string;
        symbol?: string;
        name?: string;
        decimals?: number;
        chainId?: number;
      }>;
    }>(UNISWAP_TOKEN_LIST_URL);

    const tokens = (payload.tokens || [])
      .filter((token) => token.chainId === 1 && typeof token.address === "string")
      .filter((token) => isEvmAddress(String(token.address)))
      .map((token) => ({
        address: String(token.address),
        symbol: String(token.symbol || "").trim(),
        name: token.name ? String(token.name) : undefined,
        decimals: Number.isFinite(token.decimals || 0) ? Number(token.decimals) : 18,
        chainId: 1,
      }))
      .filter((token) => token.symbol);

    this.uniswapTokenListCache = { loadedAtMs: Date.now(), tokens };
    return tokens;
  }

  private async getJupiterProgramLabels(): Promise<Record<string, string>> {
    const cached = this.jupiterProgramLabelsCache;
    if (cached && Date.now() - cached.loadedAtMs < 5 * 60_000) {
      return cached.labels;
    }

    try {
      const payload = await fetchJson<Record<string, string>>(JUPITER_PROGRAM_LABELS_API);
      const labels = Object.fromEntries(
        Object.entries(payload).filter(
          ([programId, label]) =>
            Boolean(programId) && typeof label === "string" && Boolean(label.trim())
        )
      );
      this.jupiterProgramLabelsCache = { loadedAtMs: Date.now(), labels };
      return labels;
    } catch {
      return cached?.labels || {};
    }
  }

  private async storeMnemonic(
    mnemonic: string,
    password: string
  ): Promise<{
    success: boolean;
    mnemonic: string;
    address: string;
    primaryAddresses: Record<WalletChain, string>;
  }> {
    this.validateMnemonic(mnemonic);

    const primaryAddresses = this.getPrimaryAddresses(mnemonic);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(mnemonic)
    );

    const now = new Date().toISOString();
    const vault: WalletVault = {
      version: WALLET_VERSION,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        salt: encodeBase64(salt),
      },
      cipher: {
        name: "AES-GCM",
        iv: encodeBase64(iv),
      },
      ciphertext: encodeBase64(ciphertext),
      address: primaryAddresses.eth,
      primaryAddresses,
      wordCount: mnemonic.split(/\s+/).length,
      createdAt: now,
      updatedAt: now,
    };

    this.writeVault(vault);
    this.unlockedState = {
      mnemonic,
      primaryAddresses,
      expiresAtMs: Date.now() + UNLOCK_TTL_MS,
    };

    return {
      success: true,
      mnemonic,
      address: primaryAddresses.eth,
      primaryAddresses,
    };
  }

  private validateMnemonic(mnemonic: string): void {
    const words = mnemonic.split(/\s+/).filter(Boolean);
    if (words.length !== 24) {
      throw new Error("Validation error: Seed phrase must contain exactly 24 words");
    }
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error("Validation error: Invalid BIP39 seed phrase");
    }
  }

  private validatePassword(password: string): void {
    if (typeof password !== "string" || password.trim().length < 8) {
      throw new Error("Validation error: Password must be at least 8 characters");
    }
  }

  private assertAgentAccessEnabled(): void {
    if (!this.isAgentAccessEnabled()) {
      throw new Error("Validation error: Wallet agent access is disabled");
    }
  }

  private requireUnlocked(): UnlockedWalletState {
    const unlocked = this.getUnlockedState();
    if (!unlocked) {
      throw new Error("Validation error: Wallet is locked");
    }

    unlocked.expiresAtMs = Date.now() + UNLOCK_TTL_MS;
    return unlocked;
  }

  private getUnlockedState(): UnlockedWalletState | null {
    if (!this.unlockedState) return null;
    if (Date.now() > this.unlockedState.expiresAtMs) {
      this.unlockedState = null;
      return null;
    }
    return this.unlockedState;
  }

  private readVault(): WalletVault | null {
    if (!existsSync(WALLET_FILE)) return null;

    try {
      const parsed = JSON.parse(readFileSync(WALLET_FILE, "utf8")) as Partial<WalletVault>;
      if (
        !parsed ||
        parsed.version !== WALLET_VERSION ||
        parsed.kdf?.name !== "PBKDF2" ||
        parsed.cipher?.name !== "AES-GCM" ||
        typeof parsed.ciphertext !== "string"
      ) {
        return null;
      }

      const fallbackEth = typeof parsed.address === "string" ? parsed.address : "";
      const primaryAddresses = {
        eth: parsed.primaryAddresses?.eth || fallbackEth,
        btc: parsed.primaryAddresses?.btc || "",
        sol: parsed.primaryAddresses?.sol || "",
      };

      return {
        version: WALLET_VERSION,
        kdf: {
          name: "PBKDF2",
          hash: "SHA-256",
          iterations: parsed.kdf.iterations || PBKDF2_ITERATIONS,
          salt: parsed.kdf.salt || "",
        },
        cipher: {
          name: "AES-GCM",
          iv: parsed.cipher.iv || "",
        },
        ciphertext: parsed.ciphertext,
        address: fallbackEth || primaryAddresses.eth,
        primaryAddresses,
        wordCount: parsed.wordCount || 24,
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private writeVault(vault: WalletVault): void {
    mkdirSync(secureDir, { recursive: true });
    writeFileSync(WALLET_FILE, JSON.stringify(vault, null, 2), "utf8");
    try {
      chmodSync(WALLET_FILE, 0o600);
    } catch {
      // chmod may fail on some platforms; ignore.
    }
  }

  private async decryptMnemonic(vault: WalletVault, password: string): Promise<string> {
    try {
      const salt = decodeBase64(vault.kdf.salt);
      const iv = decodeBase64(vault.cipher.iv);
      const ciphertext = decodeBase64(vault.ciphertext);
      const key = await deriveAesKey(password, salt, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      const mnemonic = normalizeMnemonic(decoder.decode(plaintext));
      this.validateMnemonic(mnemonic);
      return mnemonic;
    } catch {
      throw new Error("Validation error: Invalid wallet password");
    }
  }
}

export const walletManager = new WalletManager();
export type {
  WalletChain,
  WalletTokenChain,
  WalletAccount,
  WalletBalance,
  WalletTokenBalance,
  WalletTokenTransaction,
  WalletTransaction,
  WalletSendInput,
  WalletSendTokenInput,
  WalletStatus,
  TokenTransactionsQuery,
  WalletRpcServiceStatus,
  WalletRpcStatus,
  WalletAgentPolicy,
  EthContractCallInput,
  SolInstructionAccountMeta,
  SolProgramInstructionInput,
  WalletSwapEthUniswapInput,
  WalletSwapEthUniswapResult,
  WalletPriceSource,
  WalletPriceQuoteInput,
  WalletPriceQuoteResult,
  WalletSwapVenue,
  WalletSwapInput,
  WalletSwapResult,
  WalletEndpointDirectory,
  WalletSendResult,
  WalletRpcCallInput,
  WalletRpcCallResult,
  WalletDappAdapter,
  WalletDappAdapterCapability,
  WalletDappCallInput,
  WalletDappDirectory,
  WalletX402RequestInput,
  WalletX402RequestResult,
};
