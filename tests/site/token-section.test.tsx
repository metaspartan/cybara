import { describe, expect, test } from "bun:test";
import { CYB_TOKEN } from "../../site/src/content";

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
});
