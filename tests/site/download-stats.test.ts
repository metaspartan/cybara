import { describe, expect, test } from "bun:test";
import {
  formatDownloadTotal,
  githubLastPage,
  isCountedDownloadAsset,
  sumReleaseDownloads,
} from "../../site/downloadStats";
import { createDownloadTotalCache } from "../../site/downloadTotalCache";

describe("site release download totals", () => {
  test("excludes updater metadata while retaining downloadable release assets", () => {
    expect(isCountedDownloadAsset({ name: "latest.json", download_count: 50_000 })).toBe(false);
    expect(isCountedDownloadAsset({ name: "LATEST.JSON", download_count: 50_000 })).toBe(false);
    expect(isCountedDownloadAsset({ name: "Cybara.app.tar.gz.sig", download_count: 500 })).toBe(
      false
    );
    expect(isCountedDownloadAsset({ name: "cybara.sha256", download_count: 500 })).toBe(false);
    expect(isCountedDownloadAsset({ name: "checksums.txt", download_count: 500 })).toBe(false);
    expect(isCountedDownloadAsset({ name: "Cybara_aarch64.app.tar.gz", download_count: 500 })).toBe(
      false
    );
    expect(
      isCountedDownloadAsset({ name: "cybara-v1.0.1-linux-x64-cli", download_count: 500 })
    ).toBe(false);
    expect(isCountedDownloadAsset({ name: "cybara-v1.0.1-ios.ipa", download_count: 500 })).toBe(
      false
    );
    expect(
      isCountedDownloadAsset({ name: "CybaraNative-v1.0.1-arm64.zip", download_count: 5 })
    ).toBe(true);
    expect(isCountedDownloadAsset({ name: "cybara-v1.0.1-android.apk", download_count: 5 })).toBe(
      true
    );
    expect(isCountedDownloadAsset({ name: "cybara-macos.dmg", download_count: 120 })).toBe(true);
    const release = {
      assets: [
        { name: "latest.json", download_count: 50_000 },
        { name: "cybara-macos.dmg.sig", download_count: 100 },
        { name: "checksums.txt", download_count: 95 },
        { name: "cybara-macos.dmg", download_count: 120 },
        { name: "cybara-windows.exe", download_count: 80 },
      ],
    };
    expect(sumReleaseDownloads([release])).toBe(20);
  });

  test("does not erase installer downloads with unrelated CLI checksum traffic", () => {
    const release = {
      assets: [
        { name: "cybara-v1.0.1798-linux-x64-cli.sha256", download_count: 14 },
        { name: "Cybara_1.0.1798_x64_en-US.msi", download_count: 2 },
        { name: "Cybara_1.0.1798_x64_en-US.msi.sig", download_count: 1 },
        { name: "Cybara_1.0.1798_x64-setup.exe", download_count: 3 },
        { name: "Cybara_1.0.1798_x64-setup.exe.sig", download_count: 1 },
        { name: "cybara-v1.0.1798-android.apk", download_count: 1 },
        { name: "checksums.txt", download_count: 0 },
      ],
    };
    expect(sumReleaseDownloads([release])).toBe(4);
  });

  test("subtracts matching metadata traffic without counting updater checks", () => {
    const release = {
      assets: [
        { name: "latest.json", download_count: 2_242 },
        { name: "Cybara_1.0.1798_aarch64.dmg", download_count: 3 },
        { name: "Cybara_aarch64.app.tar.gz.sig", download_count: 1 },
        { name: "CybaraNative-v1.0.1798-arm64.zip", download_count: 2 },
        { name: "CybaraNative-v1.0.1798-arm64.sha256", download_count: 1 },
      ],
    };
    expect(sumReleaseDownloads([release])).toBe(3);
  });

  test("uses the checksum manifest for installer assets without companion metadata", () => {
    const release = {
      assets: [
        { name: "checksums.txt", download_count: 57 },
        { name: "cybara-v1.0.593-android.apk", download_count: 56 },
      ],
    };
    expect(sumReleaseDownloads([release])).toBe(0);
  });

  test("prefers a present zero-count companion over unrelated manifest traffic", () => {
    const release = {
      assets: [
        { name: "checksums.txt", download_count: 57 },
        { name: "Cybara_1.0.1798_x64_en-US.msi", download_count: 2 },
        { name: "Cybara_1.0.1798_x64_en-US.msi.sig", download_count: 0 },
      ],
    };
    expect(sumReleaseDownloads([release])).toBe(2);
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

  test("parses paginated release links with bounded fallbacks", () => {
    expect(
      githubLastPage(
        '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=4>; rel="last"'
      )
    ).toBe(4);
    expect(githubLastPage(null)).toBe(1);
    expect(githubLastPage("invalid")).toBe(1);
    expect(githubLastPage('<https://example.com?page=1000>; rel="last"')).toBe(50);
  });

  test("refreshes cached totals after the ttl and coalesces concurrent refreshes", async () => {
    let calls = 0;
    let resolveRefresh: ((value: number) => void) | null = null;
    const cache = createDownloadTotalCache(async () => {
      calls += 1;
      if (calls === 1) return 67;
      return new Promise<number>((resolve) => {
        resolveRefresh = resolve;
      });
    }, 600_000);

    expect(await cache.get(1_000)).toEqual({ total: 67, at: 1_000 });
    expect(await cache.get(601_000)).toEqual({ total: 67, at: 1_000 });
    const first = cache.get(601_001);
    const second = cache.get(601_001);
    expect(calls).toBe(2);
    resolveRefresh?.(71);
    expect(await first).toEqual({ total: 71, at: 601_001 });
    expect(await second).toEqual({ total: 71, at: 601_001 });
  });

  test("serves the last known total when a refresh fails", async () => {
    let fail = false;
    const cache = createDownloadTotalCache(async () => {
      if (fail) throw new Error("offline");
      return 71;
    }, 10);

    expect(await cache.get(100)).toEqual({ total: 71, at: 100 });
    fail = true;
    expect(await cache.get(111)).toEqual({ total: 71, at: 100 });
  });
});
