import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  assertPublicHttpUrl,
  assertResolvedPublicHttpUrl,
  checkPublicHttpUrl,
} from "../../src/core/wallet-url-guard";

afterEach(() => {
  mock.restore();
});

describe("checkPublicHttpUrl", () => {
  test("allows public https RPC endpoints", () => {
    expect(checkPublicHttpUrl("https://eth-mainnet.g.alchemy.com/v2/key").ok).toBe(true);
    expect(checkPublicHttpUrl("https://api.mainnet-beta.solana.com").ok).toBe(true);
    expect(checkPublicHttpUrl("http://1.2.3.4:8545").ok).toBe(true);
  });

  test("rejects non-http schemes", () => {
    expect(checkPublicHttpUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkPublicHttpUrl("ftp://example.com").ok).toBe(false);
    expect(checkPublicHttpUrl("gopher://1.2.3.4").ok).toBe(false);
  });

  test("rejects empty or malformed", () => {
    expect(checkPublicHttpUrl("").ok).toBe(false);
    expect(checkPublicHttpUrl("   ").ok).toBe(false);
    expect(checkPublicHttpUrl("not a url").ok).toBe(false);
  });

  test("blocks loopback and localhost", () => {
    expect(checkPublicHttpUrl("http://localhost:8545").ok).toBe(false);
    expect(checkPublicHttpUrl("http://127.0.0.1:8545").ok).toBe(false);
    expect(checkPublicHttpUrl("http://127.1.2.3").ok).toBe(false);
    expect(checkPublicHttpUrl("http://[::1]:8545").ok).toBe(false);
    expect(checkPublicHttpUrl("http://api.localhost").ok).toBe(false);
  });

  test("blocks cloud metadata endpoints", () => {
    expect(checkPublicHttpUrl("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
    expect(checkPublicHttpUrl("http://metadata.google.internal/").ok).toBe(false);
  });

  test("blocks RFC1918 private ranges", () => {
    expect(checkPublicHttpUrl("http://10.0.0.1").ok).toBe(false);
    expect(checkPublicHttpUrl("http://10.255.255.255").ok).toBe(false);
    expect(checkPublicHttpUrl("http://172.16.0.1").ok).toBe(false);
    expect(checkPublicHttpUrl("http://172.31.255.1").ok).toBe(false);
    expect(checkPublicHttpUrl("http://192.168.1.1").ok).toBe(false);
    expect(checkPublicHttpUrl("http://100.64.0.1").ok).toBe(false);
  });

  test("allows public IPs adjacent to private ranges", () => {
    expect(checkPublicHttpUrl("http://172.32.0.1").ok).toBe(true);
    expect(checkPublicHttpUrl("http://172.15.0.1").ok).toBe(true);
    expect(checkPublicHttpUrl("http://11.0.0.1").ok).toBe(true);
    expect(checkPublicHttpUrl("http://100.128.0.1").ok).toBe(true);
  });

  test("blocks 0.0.0.0 and multicast", () => {
    expect(checkPublicHttpUrl("http://0.0.0.0").ok).toBe(false);
    expect(checkPublicHttpUrl("http://224.0.0.1").ok).toBe(false);
  });

  test("blocks internal-suffix hostnames", () => {
    expect(checkPublicHttpUrl("http://db.internal").ok).toBe(false);
    expect(checkPublicHttpUrl("http://printer.local").ok).toBe(false);
    expect(checkPublicHttpUrl("http://box.lan").ok).toBe(false);
  });

  test("blocks unique-local and link-local IPv6", () => {
    expect(checkPublicHttpUrl("http://[fc00::1]").ok).toBe(false);
    expect(checkPublicHttpUrl("http://[fd12:3456::1]").ok).toBe(false);
    expect(checkPublicHttpUrl("http://[fe80::1]").ok).toBe(false);
  });

  test("blocks IPv4-mapped IPv6 pointing to private space", () => {
    expect(checkPublicHttpUrl("http://[::ffff:127.0.0.1]").ok).toBe(false);
    expect(checkPublicHttpUrl("http://[::ffff:10.0.0.1]").ok).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  test("returns trimmed url when safe", () => {
    expect(assertPublicHttpUrl("  https://rpc.example.com  ")).toBe("https://rpc.example.com");
  });

  test("throws with label on unsafe url", () => {
    expect(() => assertPublicHttpUrl("http://169.254.169.254", "RPC URL")).toThrow(/RPC URL/);
    expect(() => assertPublicHttpUrl("http://localhost")).toThrow(/Validation error/);
  });

  test("rejects public hostnames that resolve to private addresses", async () => {
    spyOn(Bun.dns, "lookup").mockResolvedValue([
      { address: "169.254.169.254", family: 4, ttl: 60 },
    ]);

    await expect(assertResolvedPublicHttpUrl("https://wallet.example", "RPC URL")).rejects.toThrow(
      "Blocked resolved address"
    );
  });
});
