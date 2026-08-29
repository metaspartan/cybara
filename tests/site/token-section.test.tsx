import { describe, expect, test } from "bun:test";
import { CYB_TOKEN, DISCORD_URL } from "../../site/src/content";

describe("site token section", () => {
  test("uses the verified CYB contract and official market link", () => {
    expect(CYB_TOKEN).toEqual({
      symbol: "CYB",
      network: "Solana",
      address: "J2hyZSVokSTuy3bG85A5xfs3umCeGtqZZEdKtGTTpump",
      url: "https://pump.fun/coin/J2hyZSVokSTuy3bG85A5xfs3umCeGtqZZEdKtGTTpump",
    });
  });

  test("places the token section immediately before the landing FAQ", async () => {
    const appSource = await Bun.file(
      new URL("../../site/src/App.tsx", import.meta.url)
    ).text();
    expect(appSource).toContain("<Token />\n        <Faq />");
  });

  test("links the official Discord from the footer with a Discord icon", async () => {
    expect(DISCORD_URL).toBe("https://discord.gg/zqz3nZj2pJ");
    const footerSource = await Bun.file(
      new URL("../../site/src/components/Footer.tsx", import.meta.url)
    ).text();
    expect(footerSource).toContain('href={DISCORD_URL}');
    expect(footerSource).toContain('name="discord"');
  });

  test("documents the meme-token contract and volatility warning", async () => {
    const readme = await Bun.file(new URL("../../README.md", import.meta.url)).text();
    const tokenSource = await Bun.file(
      new URL("../../site/src/components/Token.tsx", import.meta.url)
    ).text();
    expect(readme).toContain(CYB_TOKEN.address);
    expect(readme).toContain("community meme token");
    expect(readme).toContain("Trading fees support the continued development");
    expect(readme).toContain("highly volatile and speculative");
    expect(readme).toContain("trade responsibly");
    expect(tokenSource).toContain("Trading fees support the continued development");
  });
});
