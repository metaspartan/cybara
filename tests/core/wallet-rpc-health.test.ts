import { describe, expect, test } from "bun:test";
import { checkWalletRpcStatus, type WalletRpcFetch } from "../../src/core/wallet-rpc-health";

const endpoints = {
  btcApi: "https://btc.example/api/",
  ethRpc: "https://eth.example/rpc",
  solRpc: "https://sol.example/rpc",
};

describe("wallet RPC health", () => {
  test("returns chain heights from healthy services", async () => {
    const fetcher: WalletRpcFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("btc.example")) return new Response("840000");
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === "eth_blockNumber") {
        return Response.json({ result: "0x10" });
      }
      return Response.json({ result: 250 });
    };

    const result = await checkWalletRpcStatus(endpoints, fetcher);

    expect(result.services.map((service) => service.chain)).toEqual(["eth", "sol", "btc"]);
    expect(result.services.map((service) => service.latestHeight)).toEqual(["16", "250", "840000"]);
    expect(result.services.every((service) => service.healthy)).toBe(true);
  });

  test("isolates service failures and normalizes the Bitcoin endpoint", async () => {
    const requestedUrls: string[] = [];
    const fetcher: WalletRpcFetch = async (input) => {
      requestedUrls.push(String(input));
      throw new Error("offline");
    };

    const result = await checkWalletRpcStatus(endpoints, fetcher);

    expect(result.services.every((service) => !service.healthy)).toBe(true);
    expect(result.services.every((service) => service.error === "offline")).toBe(true);
    expect(requestedUrls).toContain("https://btc.example/api/blocks/tip/height");
  });
});
