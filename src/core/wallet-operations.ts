import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Contract,
  formatEther,
  isAddress as isEvmAddress,
  JsonRpcProvider,
  parseEther,
} from "ethers";
import {
  CHAINLINK_BASE_ASSETS,
  CHAINLINK_USD_FEEDS,
  JUPITER_PRICE_API_BASE,
  JUPITER_SWAP_API_BASE,
  PYTH_HERMES_API_BASE,
  SOL_MINT,
  UNISWAP_V2_ROUTER_ETH,
  UNISWAP_V3_ROUTER_ETH,
  WalletBase,
  WETH_MAINNET,
  X402_AGENT_MAX_DEFAULT_ATOMIC,
} from "./wallet-base";
import {
  assertWalletChain,
  assertWalletTokenChain,
  formatUnits,
  normalizeContractResult,
  normalizeStartIndex,
  parseAmountToUnits,
  parseBigIntOrZero,
  parseOptionalNumber,
  parsePositiveAtomicAmount,
} from "./wallet-internal";
import {
  decodeWalletInstructionData,
  extractWalletEthMethodName,
  fetchWalletJson,
  normalizeWalletEthMethodSelector,
  normalizeWalletHttpMethod,
  normalizeWalletSwapVenue,
  resolveWalletPair,
} from "./wallet-runtime";
import {
  type EthContractCallInput,
  type SolInstructionAccountMeta,
  type SolProgramInstructionInput,
  type WalletChain,
  type WalletDappCallInput,
  type WalletPriceQuoteInput,
  type WalletPriceQuoteResult,
  type WalletPriceSource,
  type WalletRpcCallInput,
  type WalletRpcCallResult,
  type WalletSendInput,
  type WalletSendResult,
  type WalletSendTokenInput,
  type WalletSwapEthUniswapInput,
  type WalletSwapEthUniswapResult,
  type WalletSwapInput,
  type WalletSwapResult,
  type WalletX402RequestInput,
  type WalletX402RequestResult,
} from "./wallet-types";
import { assertPublicHttpUrl, assertResolvedPublicHttpUrl } from "./wallet-url-guard";

export abstract class WalletOperations extends WalletBase {
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

    const { base, quote } = resolveWalletPair({
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
      const payload = await fetchWalletJson<{
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
      const payload = await fetchWalletJson<
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
    const venue = normalizeWalletSwapVenue(String(input.venue || ""));
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

    const quoteResponse = await fetchWalletJson<{
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
    const methodSignature = normalizeWalletEthMethodSelector(
      explicitMethodSignature || inferredMethodSignature
    );
    const method =
      methodInput && !methodInput.includes("(")
        ? methodInput
        : extractWalletEthMethodName(methodInput || methodSignature);

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
      data: decodeWalletInstructionData({
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
    await assertResolvedPublicHttpUrl(urlInput, "x402 URL");
    const url = new URL(urlInput);
    const method = normalizeWalletHttpMethod(input.method);
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
}
