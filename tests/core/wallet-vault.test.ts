import { describe, expect, test } from "bun:test";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { validateWalletMnemonic, validateWalletPassword } from "../../src/core/wallet-vault";

describe("wallet vault validation", () => {
  test("accepts strong passwords and valid 24-word seed phrases", () => {
    const mnemonic = generateMnemonic(wordlist, 256);
    expect(() => validateWalletPassword("correct horse battery staple")).not.toThrow();
    expect(() => validateWalletMnemonic(mnemonic)).not.toThrow();
  });

  test("rejects short passwords and malformed seed phrases", () => {
    expect(() => validateWalletPassword("short")).toThrow("Password must be at least 8 characters");
    expect(() => validateWalletMnemonic("abandon ".repeat(12).trim())).toThrow(
      "Seed phrase must contain exactly 24 words"
    );
    expect(() => validateWalletMnemonic("invalid ".repeat(24).trim())).toThrow(
      "Invalid BIP39 seed phrase"
    );
  });
});
