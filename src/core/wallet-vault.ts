import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { secureDir } from "./paths";
import { decodeBase64, normalizeMnemonic } from "./wallet-internal";
import { deriveWalletAesKey, WALLET_PBKDF2_ITERATIONS } from "./wallet-runtime";
import type { WalletVault } from "./wallet-types";

export const WALLET_VERSION = 1 as const;
const WALLET_FILE = join(secureDir, "wallet.v1.json");
const decoder = new TextDecoder();

export function validateWalletMnemonic(mnemonic: string): void {
  const words = mnemonic.split(/\s+/).filter(Boolean);
  if (words.length !== 24) {
    throw new Error("Validation error: Seed phrase must contain exactly 24 words");
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error("Validation error: Invalid BIP39 seed phrase");
  }
}

export function validateWalletPassword(password: string): void {
  if (typeof password !== "string" || password.trim().length < 8) {
    throw new Error("Validation error: Password must be at least 8 characters");
  }
}

export function readWalletVault(): WalletVault | null {
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
        iterations: parsed.kdf.iterations || WALLET_PBKDF2_ITERATIONS,
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

export function writeWalletVault(vault: WalletVault): void {
  mkdirSync(secureDir, { recursive: true });
  writeFileSync(WALLET_FILE, JSON.stringify(vault, null, 2), "utf8");
  try {
    chmodSync(WALLET_FILE, 0o600);
  } catch {}
}

export function deleteWalletVault(): void {
  rmSync(WALLET_FILE, { force: true });
}

export async function decryptWalletMnemonic(vault: WalletVault, password: string): Promise<string> {
  try {
    const salt = decodeBase64(vault.kdf.salt);
    const iv = decodeBase64(vault.cipher.iv);
    const ciphertext = decodeBase64(vault.ciphertext);
    const key = await deriveWalletAesKey(password, salt, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const mnemonic = normalizeMnemonic(decoder.decode(plaintext));
    validateWalletMnemonic(mnemonic);
    return mnemonic;
  } catch {
    throw new Error("Validation error: Invalid wallet password");
  }
}
