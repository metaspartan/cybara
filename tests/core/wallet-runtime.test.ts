import { describe, expect, test } from "bun:test";
import {
  decodeWalletInstructionData,
  deriveWalletAesKey,
  extractWalletEthMethodName,
  normalizeWalletEthMethodSelector,
  normalizeWalletFeedId,
  normalizeWalletHttpMethod,
  normalizeWalletSwapVenue,
  parseWalletEip155ChainId,
  parseWalletX402NetworkFamily,
  resolveWalletPair,
} from "../../src/core/wallet-runtime";

describe("wallet runtime normalization", () => {
  test("resolves symbols, pairs, and EVM token addresses", () => {
    expect(resolveWalletPair({ pair: "eth/usd" })).toEqual({ base: "ETH", quote: "USD" });
    expect(resolveWalletPair({ symbol: "sol" })).toEqual({ base: "SOL", quote: "USD" });
    expect(resolveWalletPair({ symbol: "0x0000000000000000000000000000000000000001" })).toEqual({
      base: "0x0000000000000000000000000000000000000001",
      quote: "USD",
    });
    expect(() => resolveWalletPair({})).toThrow("symbol or pair is required");
  });

  test("normalizes supported swap venue aliases", () => {
    expect(normalizeWalletSwapVenue("v2")).toBe("uniswap_v2");
    expect(normalizeWalletSwapVenue("uniswap")).toBe("uniswap_v3");
    expect(normalizeWalletSwapVenue("jup")).toBe("jupiter");
    expect(() => normalizeWalletSwapVenue("unknown")).toThrow("Unsupported swap venue");
  });

  test("normalizes HTTP methods and x402 networks", () => {
    expect(normalizeWalletHttpMethod()).toBe("GET");
    expect(normalizeWalletHttpMethod(" post ")).toBe("POST");
    expect(parseWalletEip155ChainId("eip155:8453")).toBe(8453);
    expect(parseWalletX402NetworkFamily("eip155:1")).toBe("evm");
    expect(parseWalletX402NetworkFamily("solana:mainnet")).toBe("solana");
    expect(parseWalletX402NetworkFamily("invalid")).toBeUndefined();
  });

  test("normalizes feed ids and EVM method signatures", () => {
    expect(normalizeWalletFeedId("ABC123")).toBe("0xabc123");
    expect(() => normalizeWalletFeedId(" ")).toThrow("feed id is required");
    expect(
      normalizeWalletEthMethodSelector("function transfer(address,uint256) returns (bool)")
    ).toBe("transfer(address,uint256)");
    expect(extractWalletEthMethodName("transfer(address,uint256)")).toBe("transfer");
  });
});

describe("wallet runtime encoding", () => {
  test("decodes one supported instruction encoding", () => {
    expect(decodeWalletInstructionData({ dataUtf8: "hello" }).toString("utf8")).toBe("hello");
    expect(decodeWalletInstructionData({ dataHex: "0x6869" }).toString("utf8")).toBe("hi");
    expect(decodeWalletInstructionData({ dataBase64: "aGk=" }).toString("utf8")).toBe("hi");
    expect(decodeWalletInstructionData({})).toEqual(Buffer.alloc(0));
    expect(() => decodeWalletInstructionData({ dataHex: "abc" })).toThrow(
      "Invalid hex instruction data"
    );
    expect(() => decodeWalletInstructionData({ dataUtf8: "hello", dataHex: "6869" })).toThrow(
      "only one instruction data encoding"
    );
  });

  test("derives compatible encryption and decryption keys", async () => {
    const salt = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(12).fill(3);
    const plaintext = new TextEncoder().encode("wallet-secret");
    const encryptionKey = await deriveWalletAesKey("correct horse battery staple", salt, [
      "encrypt",
    ]);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      encryptionKey,
      plaintext
    );
    const decryptionKey = await deriveWalletAesKey("correct horse battery staple", salt, [
      "decrypt",
    ]);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      decryptionKey,
      ciphertext
    );
    expect(new TextDecoder().decode(decrypted)).toBe("wallet-secret");
  });
});
