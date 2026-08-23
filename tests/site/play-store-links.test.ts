import { describe, expect, test } from "bun:test";
import { PLAY_STORE_URL } from "../../site/src/content";

const expectedPlayStoreUrl = "https://play.google.com/store/apps/details?id=com.ck.cybara&hl=en_US";

describe("site Google Play links", () => {
  test("uses the official locale-aware Android listing", () => {
    expect(PLAY_STORE_URL).toBe(expectedPlayStoreUrl);
  });

  test("promotes Google Play on the landing and download pages", async () => {
    const downloadsSource = await Bun.file(
      new URL("../../site/src/components/Downloads.tsx", import.meta.url)
    ).text();
    const downloadPageSource = await Bun.file(
      new URL("../../site/src/components/DownloadPage.tsx", import.meta.url)
    ).text();

    expect(downloadsSource).toContain("Get it on Google Play");
    expect(downloadsSource).toContain("href={PLAY_STORE_URL}");
    expect(downloadPageSource).toContain("Android app");
    expect(downloadPageSource).toContain("href={PLAY_STORE_URL}");
  });
});
