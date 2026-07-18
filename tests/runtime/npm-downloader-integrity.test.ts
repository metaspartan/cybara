import { createHash } from "crypto";
import { createRequire } from "module";
import { describe, expect, test } from "bun:test";

interface NpmDownloaderModule {
  verifyChecksum(payload: Buffer, sidecar: string, asset: string): void;
}

const require = createRequire(import.meta.url);
const downloader = require("../../packaging/npm/scripts/download.cjs") as NpmDownloaderModule;

describe("npm downloader integrity", () => {
  const payload = Buffer.from("verified release payload");
  const checksum = createHash("sha256").update(payload).digest("hex");

  test("accepts a matching release checksum sidecar", () => {
    expect(() => downloader.verifyChecksum(payload, `${checksum}  cybara`, "cybara")).not.toThrow();
  });

  test("rejects malformed checksum sidecars", () => {
    expect(() => downloader.verifyChecksum(payload, "missing", "cybara")).toThrow(
      "invalid checksum sidecar"
    );
  });

  test("rejects payloads that do not match the release checksum", () => {
    const different = createHash("sha256").update("different").digest("hex");
    expect(() => downloader.verifyChecksum(payload, different, "cybara")).toThrow(
      "checksum mismatch"
    );
  });
});
