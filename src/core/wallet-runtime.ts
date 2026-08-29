import { EVM_NETWORK_CHAIN_ID_MAP as X402EvmNetworkChainIdMap } from "@x402/evm/v1";
import { NETWORKS as X402SvmV1Networks } from "@x402/svm/v1";
import { isAddress as isEvmAddress } from "ethers";
import { normalizeTicker } from "./wallet-internal";
import type { AesKeyUsage, WalletSwapVenue } from "./wallet-types";

export const WALLET_PBKDF2_ITERATIONS = 310_000;

export const WALLET_X402_V1_EVM_NETWORK_CHAIN_IDS: Record<string, number> = {
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

export const WALLET_X402_V1_SOLANA_NETWORKS = [
  ...new Set(X402SvmV1Networks.map((network) => network.toLowerCase())),
];

const encoder = new TextEncoder();

export function resolveWalletPair(input: { symbol?: string; pair?: string }): {
  base: string;
  quote: string;
} {
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

export function normalizeWalletSwapVenue(input: string): WalletSwapVenue {
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
  if (
    venue === "pump_swap" ||
    venue === "pump-swap" ||
    venue === "pumpswap" ||
    venue === "pump" ||
    venue === "pump_fun"
  ) {
    return "pump_swap";
  }
  throw new Error(
    "Validation error: Unsupported swap venue. Use uniswap_v2, uniswap_v3, jupiter, or pump_swap"
  );
}

export function normalizeWalletHttpMethod(value?: string): string {
  const method = String(value || "GET")
    .trim()
    .toUpperCase();
  return method || "GET";
}

export function parseWalletEip155ChainId(networkInput: string): number | undefined {
  const network = networkInput.trim().toLowerCase();
  if (!network) return undefined;
  if (network.startsWith("eip155:")) {
    const parsed = Number(network.slice("eip155:".length));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return WALLET_X402_V1_EVM_NETWORK_CHAIN_IDS[network];
}

export function parseWalletX402NetworkFamily(networkInput: string): "evm" | "solana" | undefined {
  const network = networkInput.trim().toLowerCase();
  if (!network) return undefined;
  if (parseWalletEip155ChainId(network)) return "evm";
  if (network.startsWith("solana:") && network.length > "solana:".length) return "solana";
  if (WALLET_X402_V1_SOLANA_NETWORKS.includes(network)) return "solana";
  return undefined;
}

export function normalizeWalletFeedId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Validation error: pyth feed id is required");
  }
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

export function normalizeWalletEthMethodSelector(input: string): string {
  const trimmed = input.trim().replace(/^function\s+/, "");
  const openIndex = trimmed.indexOf("(");
  if (openIndex < 0) return trimmed;

  let depth = 0;
  for (let index = openIndex; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char !== ")") continue;
    depth -= 1;
    if (depth === 0) {
      const name = trimmed.slice(0, openIndex).trim();
      const args = trimmed.slice(openIndex + 1, index).trim();
      return `${name}(${args})`;
    }
  }

  return trimmed;
}

export function extractWalletEthMethodName(input: string): string {
  const selector = normalizeWalletEthMethodSelector(input);
  if (!selector) return "";
  const openIndex = selector.indexOf("(");
  return openIndex < 0 ? selector.trim() : selector.slice(0, openIndex).trim();
}

export function decodeWalletInstructionData(input: {
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
  return utf8 ? Buffer.from(utf8, "utf8") : Buffer.alloc(0);
}

export async function deriveWalletAesKey(
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
      iterations: WALLET_PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

export async function fetchWalletJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "user-agent": "cybara-wallet/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Wallet network request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
