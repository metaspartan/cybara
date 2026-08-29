import { mnemonicToSeedSync } from "@scure/bip39";
import { createKeyPairSignerFromBytes } from "@solana/signers";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import {
  x402Client as X402Client,
  x402HTTPClient as X402HttpClient,
  SelectPaymentRequirements as X402SelectPaymentRequirements,
} from "@x402/fetch";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import { ExactSvmSchemeV1 } from "@x402/svm/v1";
import BIP32Factory from "bip32";
import * as bitcoinImport from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import { derivePath as deriveEd25519Path } from "ed25519-hd-key";
import {
  Contract,
  HDNodeWallet,
  isAddress as isEvmAddress,
  JsonRpcProvider,
  parseEther,
  TypedDataDomain,
} from "ethers";
import * as ecc from "tiny-secp256k1";
import { config } from "./config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintDetails,
  getMintDecimals,
  TOKEN_PROGRAM_ID,
} from "./solana-token";
import {
  encodeBase64,
  isValidEvmAddress,
  normalizeAddressList,
  normalizeHostList,
  normalizeNetworkList,
  normalizeStartIndex,
  normalizeTicker,
  parseAmountToUnits,
  parseBigIntOrZero,
} from "./wallet-internal";
import {
  deriveWalletAesKey,
  fetchWalletJson,
  normalizeWalletEthMethodSelector,
  normalizeWalletFeedId,
  parseWalletX402NetworkFamily,
  WALLET_PBKDF2_ITERATIONS,
  WALLET_X402_V1_EVM_NETWORK_CHAIN_IDS,
  WALLET_X402_V1_SOLANA_NETWORKS,
} from "./wallet-runtime";
import {
  type BtcUtxo,
  type EthContractCallInput,
  type UnlockedWalletState,
  type WalletAccount,
  type WalletAgentPolicy,
  type WalletChain,
  type WalletDappAdapter,
  type WalletSendResult,
  type WalletVault,
  type WalletX402PaymentRequiredV1,
  type WalletX402PaymentRequiredV2,
  type WalletX402RequestResult,
  type WalletX402SelectedRequirement,
  type WalletX402SettlementResponse,
} from "./wallet-types";
import { assertPublicHttpUrl } from "./wallet-url-guard";
import { getSolanaTokenMetadata, resolveSolanaTokenAlias } from "./wallet-token-catalog";
import { validateWalletMnemonic, WALLET_VERSION, writeWalletVault } from "./wallet-vault";

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

export const UNLOCK_TTL_MS = 15 * 60 * 1000;
export const AGENT_ACCESS_CONFIG_KEY = "wallet_agent_access_enabled";
export const AGENT_POLICY_CONFIG_KEY = "wallet_agent_policy";

const DEFAULT_ETH_RPC = "https://ethereum-rpc.publicnode.com";
const DEFAULT_SOL_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_BTC_API_BASE = "https://mempool.space/api";

export const ETH_RPC_CONFIG_KEY = "wallet_rpc_eth";
export const SOL_RPC_CONFIG_KEY = "wallet_rpc_sol";
export const BTC_API_CONFIG_KEY = "wallet_btc_api";

export const UNISWAP_V2_ROUTER_ETH = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
export const UNISWAP_V3_ROUTER_ETH = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
export const UNISWAP_V3_QUOTER_V2_ETH = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
export const UNISWAP_V3_QUOTER_LEGACY_ETH = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
export const UNISWAP_UNIVERSAL_ROUTER_ETH = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
export const UNISWAP_PERMIT2_ETH = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const WETH_MAINNET = "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2";
const UNISWAP_TOKEN_LIST_URL = "https://tokens.uniswap.org";
export const PYTH_HERMES_API_BASE = "https://hermes.pyth.network/v2";
export const JUPITER_PRICE_API_BASE = "https://lite-api.jup.ag/price/v3";
export const JUPITER_SWAP_API_BASE = "https://lite-api.jup.ag/swap/v1";
export const JUPITER_PROGRAM_LABELS_API = "https://lite-api.jup.ag/swap/v1/program-id-to-label";
export const PUMP_SWAP_API_BASE = "https://fun-block.pump.fun";
export const PUMP_SWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const CHAINLINK_FEED_REGISTRY_ETH = "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf";
export const CHAINLINK_DENOMINATION_USD = "0x0000000000000000000000000000000000000348";
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
const X402_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const X402_RESPONSE_HEADER = "PAYMENT-RESPONSE";
const X402_LEGACY_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";
export const X402_AGENT_MAX_DEFAULT_ATOMIC = "1000000";
const X402_AGENT_SUPPORTED_SCHEMES = new Set<string>(["exact"]);
export const CHAINLINK_BASE_ASSETS: Record<string, string> = {
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  BTC: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
};

export const CHAINLINK_USD_FEEDS: Record<string, string> = {
  BTC: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  ETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  SOL: "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  LINK: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
};

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const encoder = new TextEncoder();

export abstract class WalletBase {
  protected unlockedState: UnlockedWalletState | null = null;
  protected uniswapTokenListCache: {
    loadedAtMs: number;
    tokens: Array<{
      address: string;
      symbol: string;
      name?: string;
      decimals: number;
      chainId: number;
    }>;
  } | null = null;
  protected jupiterProgramLabelsCache: {
    loadedAtMs: number;
    labels: Record<string, string>;
  } | null = null;

  abstract isAgentAccessEnabled(): boolean;

  protected async sendEth(input: {
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

  protected async sendEthToken(input: {
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

  protected async sendSol(input: {
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

  protected async sendSolToken(input: {
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

    const mintDetails = await getMintDetails(connection, mint, "confirmed");
    const mintDecimals = mintDetails.decimals;
    const tokenProgramId = mintDetails.programId;
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
      tokenProgramId,
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
      tokenProgramId,
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
          tokenProgramId,
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
        tokenProgramId
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

  protected async sendBtc(input: {
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
    const utxos = await fetchWalletJson<BtcUtxo[]>(`${apiBase}/address/${signer.address}/utxo`);
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

  protected async getRecommendedBtcFeeRate(apiBase: string): Promise<number> {
    try {
      const payload = await fetchWalletJson<{
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

  protected estimateBtcFee(inputCount: number, outputCount: number, feeRate: number): bigint {
    const vbytes = 10 + inputCount * 68 + outputCount * 31;
    return BigInt(Math.ceil(vbytes * feeRate));
  }

  protected deriveAccount(chain: WalletChain, index: number, mnemonic: string): WalletAccount {
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

  protected getPrimaryAddresses(mnemonic: string): Record<WalletChain, string> {
    let btcAddress = "";
    try {
      btcAddress = this.deriveAccount("btc", 0, mnemonic).address;
    } catch {
      void 0;
    }
    return {
      eth: this.deriveAccount("eth", 0, mnemonic).address,
      btc: btcAddress,
      sol: this.deriveAccount("sol", 0, mnemonic).address,
    };
  }

  protected deriveEthWallet(
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

  protected deriveSolKeypair(mnemonic: string, index: number): Keypair {
    const path = this.getSolPath(index);
    const seed = Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex");
    const derived = deriveEd25519Path(path, seed);
    return Keypair.fromSeed(derived.key.slice(0, 32));
  }

  protected deriveBtcSigner(
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

  protected getEthPath(index: number): string {
    return `m/44'/60'/0'/0/${index}`;
  }

  protected getBtcPath(index: number): string {
    return `m/84'/0'/0'/0/${index}`;
  }

  protected getSolPath(index: number): string {
    return `m/44'/501'/${index}'/0'`;
  }

  protected async quoteUniswapV3ExactInputSingle(input: {
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

  protected async resolveChainlinkFeedAddress(input: {
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

  protected resolveSolMint(input: string): string {
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

    const mint = commonMints[upper] || resolveSolanaTokenAlias(normalized) || normalized;
    try {
      return new PublicKey(mint).toBase58();
    } catch {
      throw new Error(`Validation error: Invalid Solana mint '${input}'`);
    }
  }

  protected canResolveSolMint(input: string): boolean {
    try {
      this.resolveSolMint(input);
      return true;
    } catch {
      return false;
    }
  }

  protected async resolvePythFeedId(input: {
    pythFeedId?: string;
    symbol?: string;
    pair?: string;
  }): Promise<string> {
    if (typeof input.pythFeedId === "string" && input.pythFeedId.trim()) {
      return normalizeWalletFeedId(input.pythFeedId);
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
      await fetchWalletJson<
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

    return normalizeWalletFeedId(selected.id);
  }

  protected formatScaledSignedInteger(rawValue: string, exponent: number): string {
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

  protected async getSolMintDecimals(connection: Connection, mint: string): Promise<number> {
    const normalizedMint = this.resolveSolMint(mint);
    if (normalizedMint === SOL_MINT) {
      return 9;
    }
    const metadata = getSolanaTokenMetadata(normalizedMint);
    if (metadata) return metadata.decimals;
    return await getMintDecimals(connection, new PublicKey(normalizedMint), "confirmed");
  }

  protected async resolveJupiterAmountRaw(input: {
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
      const inputMint = new PublicKey(normalizedInputMint);
      const tokenProgramId = (await getMintDetails(input.connection, inputMint, "confirmed"))
        .programId;
      const ata = getAssociatedTokenAddressSync(
        inputMint,
        input.owner,
        false,
        tokenProgramId,
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

  protected parseEthContractAbi(abiInput: string | undefined, methodSignature: string): unknown {
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

  protected buildEthContractOverrides(
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

  protected resolveEthContractMethod(
    contract: Contract,
    method: string,
    methodSignature: string
  ): ((...fnArgs: unknown[]) => Promise<unknown>) & {
    staticCall?: (...fnArgs: unknown[]) => Promise<unknown>;
  } {
    const methodCandidates = [
      methodSignature,
      normalizeWalletEthMethodSelector(methodSignature),
      method,
    ]
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

  protected getEthRpc(): string {
    const configured = config.get<string>(ETH_RPC_CONFIG_KEY);
    return typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_ETH_RPC;
  }

  protected getSolRpc(): string {
    const configured = config.get<string>(SOL_RPC_CONFIG_KEY);
    return typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_SOL_RPC;
  }

  protected resolveRpcUrl(userUrl: string | undefined, fallback: string): string {
    const trimmed = typeof userUrl === "string" ? userUrl.trim() : "";
    if (!trimmed) return fallback;
    return assertPublicHttpUrl(trimmed, "RPC URL");
  }

  protected getBtcApiBase(): string {
    const configured = config.get<string>(BTC_API_CONFIG_KEY);
    if (typeof configured === "string" && configured.trim()) {
      return this.normalizeBtcApiBase(configured);
    }
    return DEFAULT_BTC_API_BASE;
  }

  protected normalizeBtcApiBase(input: string): string {
    return input.trim().replace(/\/+$/, "");
  }

  protected validateHttpUrl(url: string, label: string): void {
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

  protected getDefaultAgentPolicy(): WalletAgentPolicy {
    return {
      allowNativeSend: false,
      allowTokenSend: false,
      allowEthContractWrite: false,
      allowSolProgramInstruction: false,
      allowEthSwaps: false,
      allowSolSwaps: false,
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

  protected normalizeAgentPolicy(
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
    const allowSolSwaps = source.allowSolSwaps === true;
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
      allowSolSwaps,
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

  protected assertAgentUrlAllowedByPolicy(
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

  protected normalizeDappAdapter(adapterInput: string): WalletDappAdapter {
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

  protected async decodeX402PaymentRequired(
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

  protected selectX402Requirement(
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
        const networkFamily = parseWalletX402NetworkFamily(network);
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
        const networkFamily = parseWalletX402NetworkFamily(network);
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

  protected async createX402PaymentHeader(input: {
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

    for (const network of Object.keys(WALLET_X402_V1_EVM_NETWORK_CHAIN_IDS)) {
      x402Client.registerV1(network, evmSchemeV1);
    }
    for (const network of WALLET_X402_V1_SOLANA_NETWORKS) {
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

  protected decodeX402SettlementResponse(
    headers: Headers
  ): WalletX402SettlementResponse | undefined {
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

  protected serializeResponseHeaders(headers: Headers): Record<string, string> {
    const collected: Record<string, string> = {};
    for (const [name, value] of headers.entries()) {
      collected[name] = value;
    }
    return collected;
  }

  protected async buildX402Result(input: {
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

  protected async resolveEthTokenTarget(
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

  protected async readEthTokenMetadata(
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

  protected async getUniswapTokenList(): Promise<
    Array<{ address: string; symbol: string; name?: string; decimals: number; chainId: number }>
  > {
    const cached = this.uniswapTokenListCache;
    if (cached && Date.now() - cached.loadedAtMs < 10 * 60_000) {
      return cached.tokens;
    }

    const payload = await fetchWalletJson<{
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

  protected async getJupiterProgramLabels(): Promise<Record<string, string>> {
    const cached = this.jupiterProgramLabelsCache;
    if (cached && Date.now() - cached.loadedAtMs < 5 * 60_000) {
      return cached.labels;
    }

    try {
      const payload = await fetchWalletJson<Record<string, string>>(JUPITER_PROGRAM_LABELS_API);
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

  protected async storeMnemonic(
    mnemonic: string,
    password: string
  ): Promise<{
    success: boolean;
    mnemonic: string;
    address: string;
    primaryAddresses: Record<WalletChain, string>;
  }> {
    validateWalletMnemonic(mnemonic);

    const primaryAddresses = this.getPrimaryAddresses(mnemonic);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveWalletAesKey(password, salt, ["encrypt"]);
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
        iterations: WALLET_PBKDF2_ITERATIONS,
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

    writeWalletVault(vault);
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

  protected assertAgentAccessEnabled(): void {
    if (!this.isAgentAccessEnabled()) {
      throw new Error("Validation error: Wallet agent access is disabled");
    }
  }

  protected requireUnlocked(): UnlockedWalletState {
    const unlocked = this.getUnlockedState();
    if (!unlocked) {
      throw new Error("Validation error: Wallet is locked");
    }

    unlocked.expiresAtMs = Date.now() + UNLOCK_TTL_MS;
    return unlocked;
  }

  protected getUnlockedState(): UnlockedWalletState | null {
    if (!this.unlockedState) return null;
    if (Date.now() > this.unlockedState.expiresAtMs) {
      this.unlockedState = null;
      return null;
    }
    return this.unlockedState;
  }
}
