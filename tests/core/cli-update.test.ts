import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  downloadResponseToFile,
  formatByteSize,
  formatDownloadProgress,
  resolveUpdateVersionStatus,
  type DownloadProgress,
} from "../../src/cli/commands/update";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI update progress", () => {
  test("formats binary sizes for readable updater output", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1536)).toBe("1.50 KB");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  test("formats known and unknown download totals", () => {
    expect(formatDownloadProgress({ downloadedBytes: 512, totalBytes: 1024 })).toBe(
      "50.0% · 512 B / 1.00 KB"
    );
    expect(formatDownloadProgress({ downloadedBytes: 1536, totalBytes: null })).toBe(
      "1.50 KB downloaded"
    );
  });

  test("distinguishes current, stale, and ahead-of-release builds", () => {
    expect(resolveUpdateVersionStatus("1.0.1200", "1.0.1201")).toBe("available");
    expect(resolveUpdateVersionStatus("1.0.1201", "1.0.1201")).toBe("current");
    expect(resolveUpdateVersionStatus("1.0.1204", "1.0.1201")).toBe("ahead");
    expect(resolveUpdateVersionStatus("1.0.1201", "")).toBe("unknown");
  });

  test("streams response chunks to disk while reporting cumulative progress", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-cli-update-"));
    temporaryDirectories.push(directory);
    const destination = join(directory, "cybara-update");
    const chunks = [new TextEncoder().encode("cybara-"), new TextEncoder().encode("release")];
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      })
    );
    const reports: Array<{ progress: DownloadProgress; complete: boolean }> = [];

    const downloaded = await downloadResponseToFile(
      response,
      destination,
      14,
      (progress, complete = false) => reports.push({ progress, complete })
    );

    expect(downloaded).toBe(14);
    expect(await Bun.file(destination).text()).toBe("cybara-release");
    expect(reports.map((report) => report.progress.downloadedBytes)).toEqual([7, 14, 14]);
    expect(reports.at(-1)).toEqual({
      progress: { downloadedBytes: 14, totalBytes: 14 },
      complete: true,
    });
  });

  test("rejects downloads that do not match the published asset size", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-cli-update-size-"));
    temporaryDirectories.push(directory);
    const destination = join(directory, "cybara-update");

    await expect(
      downloadResponseToFile(new Response("short"), destination, 10, () => undefined)
    ).rejects.toThrow("expected 10 B, received 5 B");
  });
});
