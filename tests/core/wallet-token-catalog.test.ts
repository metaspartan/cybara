import { describe, expect, test } from "bun:test";
import {
  CYB_SOL_MINT,
  DEFAULT_SOLANA_TOKENS,
  getSolanaTokenMetadata,
  resolveSolanaTokenAlias,
} from "../../src/core/wallet-token-catalog";

describe("wallet Solana token catalog", () => {
  test("includes CYB as a six-decimal default asset", () => {
    expect(DEFAULT_SOLANA_TOKENS).toContainEqual({
      mint: CYB_SOL_MINT,
      symbol: "CYB",
      name: "Cybara",
      decimals: 6,
      defaultAsset: true,
    });
    expect(getSolanaTokenMetadata(CYB_SOL_MINT)?.symbol).toBe("CYB");
  });

  test("resolves plain and dollar-prefixed token aliases", () => {
    expect(resolveSolanaTokenAlias("cyb")).toBe(CYB_SOL_MINT);
    expect(resolveSolanaTokenAlias(" $CYB ")).toBe(CYB_SOL_MINT);
    expect(resolveSolanaTokenAlias("unknown")).toBeUndefined();
  });
});
