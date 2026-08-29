import { PUMP_SWAP_API_BASE } from "./wallet-base";

export interface PumpSwapBuildInput {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  user: string;
  slippageBps: number;
  frontRunningProtection: boolean;
  tipAmount: number;
}

export interface PumpSwapBuildResult {
  transaction: string;
  hasGraduated: boolean;
  expectedOutAmount: string;
}

export async function buildPumpSwapTransaction(
  input: PumpSwapBuildInput,
  fetchImpl: typeof fetch = fetch
): Promise<PumpSwapBuildResult> {
  const response = await fetchImpl(`${PUMP_SWAP_API_BASE}/agents/swap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "cybara-wallet/1.0",
    },
    body: JSON.stringify({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amountRaw,
      user: input.user,
      feePayer: input.user,
      slippagePct: input.slippageBps / 100,
      frontRunningProtection: input.frontRunningProtection,
      tipAmount: input.tipAmount,
      encoding: "base64",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const reason = await response.text();
    throw new Error(`Validation error: Pump swap request failed (${response.status}): ${reason}`);
  }
  const payload = (await response.json()) as {
    transaction?: string;
    pumpMintInfo?: {
      hasGraduated?: boolean;
      expectedOutAmount?: string;
    };
  };
  const transaction = String(payload.transaction || "");
  const expectedOutAmount = String(payload.pumpMintInfo?.expectedOutAmount || "");
  if (!transaction || !/^\d+$/.test(expectedOutAmount) || BigInt(expectedOutAmount) <= 0n) {
    throw new Error("Validation error: Pump swap did not return a usable transaction quote");
  }
  return {
    transaction,
    hasGraduated: payload.pumpMintInfo?.hasGraduated === true,
    expectedOutAmount,
  };
}
