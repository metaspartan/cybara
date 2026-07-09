import { isAddress as isEvmAddress } from "ethers";
import {
  SUPPORTED_CHAINS,
  SUPPORTED_TOKEN_CHAINS,
  type WalletChain,
  type WalletTokenChain,
} from "./wallet-types";

export function encodeBase64(bytes: Uint8Array | ArrayBuffer): string {
  const normalized = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return Buffer.from(normalized).toString("base64");
}

export function decodeBase64(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
}

export function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function normalizeCount(input?: number): number {
  const fallback = 1;
  if (typeof input !== "number" || Number.isNaN(input)) return fallback;
  return Math.min(20, Math.max(1, Math.floor(input)));
}

export function normalizeStartIndex(input?: number): number {
  if (typeof input !== "number" || Number.isNaN(input)) return 0;
  return Math.max(0, Math.floor(input));
}

export function parseAmountToUnits(amountInput: string, decimals: number): bigint {
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

export function formatUnits(amount: bigint, decimals: number): string {
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

export function parseBigIntOrZero(value: unknown): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
    return 0n;
  } catch {
    return 0n;
  }
}

export function parseOptionalNumber(value: unknown): number | undefined {
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

export function normalizeAddressList(values: unknown[]): string[] {
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function normalizeStringList(values: unknown[]): string[] {
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function normalizeHostList(values: unknown[]): string[] {
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

export function normalizeNetworkList(values: unknown[]): string[] {
  return normalizeStringList(values).map((value) => value.toLowerCase());
}

export function parsePositiveAtomicAmount(value: string, label: string): bigint {
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

export function assertWalletChain(chain: string): WalletChain {
  if (SUPPORTED_CHAINS.includes(chain as WalletChain)) {
    return chain as WalletChain;
  }
  throw new Error(`Validation error: Unsupported chain '${chain}'`);
}

export function assertWalletTokenChain(chain: string): WalletTokenChain {
  if (SUPPORTED_TOKEN_CHAINS.includes(chain as WalletTokenChain)) {
    return chain as WalletTokenChain;
  }
  throw new Error(
    `Validation error: Unsupported token chain '${chain}'. Use one of: ${SUPPORTED_TOKEN_CHAINS.join(", ")}`
  );
}

export function isValidEvmAddress(value: string): boolean {
  return isEvmAddress(value);
}

export function normalizeContractResult(value: unknown): unknown {
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

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}
