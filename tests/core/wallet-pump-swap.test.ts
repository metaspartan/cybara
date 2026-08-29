import { describe, expect, mock, test } from "bun:test";
import { buildPumpSwapTransaction } from "../../src/core/pump-swap";
import { assertAgentSwapVenueAllowed } from "../../src/core/wallet-policy";
import { CYB_SOL_MINT } from "../../src/core/wallet-token-catalog";
import { SOL_MINT } from "../../src/core/wallet-base";

describe("wallet Pump swaps", () => {
  test("builds a base64 transaction quote through the Pump API", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = mock(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        requests.push({ url: String(input), body });
        return Response.json({
          transaction: "dGVzdA==",
          pumpMintInfo: { hasGraduated: true, expectedOutAmount: "1250000" },
        });
      }
    );

    const quote = await buildPumpSwapTransaction(
      {
        inputMint: SOL_MINT,
        outputMint: CYB_SOL_MINT,
        amountRaw: "1000000",
        user: "8jA1Hb78e1V7QWmDEWprShB38pY8LJ4R6ZmcyDBLXhZ6",
        slippageBps: 200,
        frontRunningProtection: false,
        tipAmount: 0,
      },
      fetchMock as typeof fetch
    );

    expect(quote).toEqual({
      transaction: "dGVzdA==",
      hasGraduated: true,
      expectedOutAmount: "1250000",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://fun-block.pump.fun/agents/swap");
    expect(requests[0]?.body).toMatchObject({
      inputMint: SOL_MINT,
      outputMint: CYB_SOL_MINT,
      amount: "1000000",
      slippagePct: 2,
      encoding: "base64",
    });
  });

  test("rejects malformed quote responses", async () => {
    const fetchMock = mock(async (): Promise<Response> => Response.json({ transaction: "" }));
    await expect(
      buildPumpSwapTransaction(
        {
          inputMint: SOL_MINT,
          outputMint: CYB_SOL_MINT,
          amountRaw: "1000000",
          user: "8jA1Hb78e1V7QWmDEWprShB38pY8LJ4R6ZmcyDBLXhZ6",
          slippageBps: 200,
          frontRunningProtection: false,
          tipAmount: 0,
        },
        fetchMock as typeof fetch
      )
    ).rejects.toThrow("usable transaction quote");
  });

  test("uses separate agent permissions for Ethereum and Solana venues", () => {
    expect(() =>
      assertAgentSwapVenueAllowed("pump_swap", {
        allowEthSwaps: true,
        allowSolSwaps: false,
      })
    ).toThrow("Agent Solana swaps are disabled");
    expect(() =>
      assertAgentSwapVenueAllowed("uniswap_v3", {
        allowEthSwaps: false,
        allowSolSwaps: true,
      })
    ).toThrow("Agent Ethereum swaps are disabled");
    expect(() =>
      assertAgentSwapVenueAllowed("jupiter", {
        allowEthSwaps: false,
        allowSolSwaps: true,
      })
    ).not.toThrow();
  });
});
