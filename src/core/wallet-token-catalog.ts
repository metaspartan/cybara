export interface SolanaTokenMetadata {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  defaultAsset: boolean;
}

export const CYB_SOL_MINT = "J2hyZSVokSTuy3bG85A5xfs3umCeGtqZZEdKtGTTpump";

export const DEFAULT_SOLANA_TOKENS: SolanaTokenMetadata[] = [
  {
    mint: CYB_SOL_MINT,
    symbol: "CYB",
    name: "Cybara",
    decimals: 6,
    defaultAsset: true,
  },
];

const solanaTokenByMint = new Map(DEFAULT_SOLANA_TOKENS.map((token) => [token.mint, token]));
const solanaTokenBySymbol = new Map(
  DEFAULT_SOLANA_TOKENS.map((token) => [token.symbol.toUpperCase(), token])
);

export function getSolanaTokenMetadata(mint: string): SolanaTokenMetadata | undefined {
  return solanaTokenByMint.get(mint.trim());
}

export function resolveSolanaTokenAlias(input: string): string | undefined {
  const symbol = input.trim().replace(/^\$/, "").toUpperCase();
  return solanaTokenBySymbol.get(symbol)?.mint;
}
