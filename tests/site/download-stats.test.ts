import { describe, expect, test } from "bun:test";
import {
  formatDownloadTotal,
  isCountedDownloadAsset,
  sumReleaseDownloads,
} from "../../site/downloadStats";

describe("site release download totals", () => {
  test("excludes updater manifests while retaining downloadable release assets", () => {
    expect(isCountedDownloadAsset({ name: "latest.json", download_count: 50_000 })).toBe(false);
    expect(isCountedDownloadAsset({ name: "LATEST.JSON", download_count: 50_000 })).toBe(false);
    expect(isCountedDownloadAsset({ name: "cybara-macos.dmg", download_count: 120 })).toBe(true);
    expect(
      sumReleaseDownloads([
        {
          assets: [
            { name: "latest.json", download_count: 50_000 },
            { name: "cybara-macos.dmg", download_count: 120 },
            { name: "cybara-windows.exe", download_count: 80 },
          ],
        },
      ])
    ).toBe(200);
  });

  test("ignores malformed and negative counts", () => {
    expect(
      sumReleaseDownloads([
        {
          assets: [
            { name: "cybara-linux.deb", download_count: -10 },
            { download_count: 25 },
            { name: "cybara-linux.rpm", download_count: Number.NaN },
          ],
        },
      ])
    ).toBe(0);
  });

  test("formats download totals for the badge and site", () => {
    expect(formatDownloadTotal(999)).toBe("999");
    expect(formatDownloadTotal(1_250)).toBe("1.3k");
    expect(formatDownloadTotal(15_200)).toBe("15k");
    expect(formatDownloadTotal(1_250_000)).toBe("1.3M");
  });
});
