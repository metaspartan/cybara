import { describe, expect, test } from "bun:test";
import { WalletBase } from "../../src/core/wallet-base";
import { CYB_SOL_MINT } from "../../src/core/wallet-token-catalog";

class WalletMintResolver extends WalletBase {
  isAgentAccessEnabled(): boolean {
    return false;
  }

  canResolve(input: string): boolean {
    return this.canResolveSolMint(input);
  }

  resolve(input: string): string {
    return this.resolveSolMint(input);
  }
}

describe("wallet Solana mint resolution", () => {
  const resolver = new WalletMintResolver();

  test("recognizes native, stablecoin, CYB, and raw Solana mints", () => {
    expect(resolver.canResolve("SOL")).toBe(true);
    expect(resolver.canResolve("USDC")).toBe(true);
    expect(resolver.canResolve("$CYB")).toBe(true);
    expect(resolver.canResolve(CYB_SOL_MINT)).toBe(true);
    expect(resolver.resolve("CYB")).toBe(CYB_SOL_MINT);
  });

  test("does not route Ethereum and Bitcoin tickers to Jupiter", () => {
    expect(resolver.canResolve("ETH")).toBe(false);
    expect(resolver.canResolve("BTC")).toBe(false);
  });
});
