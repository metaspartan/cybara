import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import { verifyNpmPackageIntegrity } from "../../src/core/plugins/install";

describe("plugin package integrity", () => {
  test("accepts matching npm SRI metadata", () => {
    const payload = new TextEncoder().encode("trusted plugin archive");
    const integrity = `sha512-${createHash("sha512").update(payload).digest("base64")}`;
    expect(verifyNpmPackageIntegrity(payload, { integrity })).toBe(true);
  });

  test("rejects modified archives and missing metadata", () => {
    const payload = new TextEncoder().encode("trusted plugin archive");
    const integrity = `sha512-${createHash("sha512").update(payload).digest("base64")}`;
    const modified = new TextEncoder().encode("modified plugin archive");
    expect(verifyNpmPackageIntegrity(modified, { integrity })).toBe(false);
    expect(verifyNpmPackageIntegrity(payload, {})).toBe(false);
  });

  test("accepts matching npm shasum fallback", () => {
    const payload = new TextEncoder().encode("legacy plugin archive");
    const shasum = createHash("sha1").update(payload).digest("hex");
    expect(verifyNpmPackageIntegrity(payload, { shasum })).toBe(true);
  });
});
