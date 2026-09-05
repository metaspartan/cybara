import { describe, expect, test } from "bun:test";
import { providers, resolveProviderType } from "../../src/core/providers";
import {
  buildCommandCodeUsage,
  commandCodePlan,
  parseCommandCodeCredits,
  parseCommandCodeSubscription,
} from "../../src/core/provider-commandcode-usage";

describe("command code provider registration", () => {
  test("is registered as an OpenAI-compatible api-key coding provider", () => {
    const provider = providers.commandcode;
    expect(provider).toBeDefined();
    expect(provider.baseUrl).toBe("https://api.commandcode.ai/provider/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.authType).toBe("api_key");
    expect(provider.models.length).toBe(59);
  });

  test("routes Claude models through the Anthropic messages endpoint", () => {
    const claude = providers.commandcode.models.filter((model) => model.id.startsWith("claude"));
    expect(claude.length).toBeGreaterThanOrEqual(7);
    for (const model of claude) {
      expect(`${model.id}:${model.api}`).toBe(`${model.id}:anthropic-messages`);
    }
  });

  test("carries the flagship families from the Command Code model list", () => {
    const ids = new Set(providers.commandcode.models.map((model) => model.id));
    for (const id of [
      "claude-opus-5",
      "gpt-5.6-luna",
      "zai-org/GLM-5.2",
      "moonshotai/Kimi-K3",
      "MiniMaxAI/MiniMax-M3",
      "xai/grok-4.5",
      "google/gemini-3.6-flash",
    ]) {
      expect(`${id}:${ids.has(id)}`).toBe(`${id}:true`);
    }
  });

  test("resolves the common aliases", () => {
    expect(resolveProviderType("commandcode")).toBe("commandcode");
    expect(resolveProviderType("command-code")).toBe("commandcode");
    expect(resolveProviderType("cmdcode")).toBe("commandcode");
    expect(resolveProviderType("CommandCode")).toBe("commandcode");
  });

  test("its base url supports the shared /v1 model discovery path", () => {
    expect(providers.commandcode.baseUrl.endsWith("/v1")).toBe(true);
  });
});

describe("command code billing parsing", () => {
  test("reads monthly credits from the nested credits object", () => {
    const credits = parseCommandCodeCredits({
      credits: {
        monthlyCredits: 22.5,
        purchasedCredits: 5,
        premiumMonthlyCredits: 0,
        opensourceMonthlyCredits: 1,
      },
    });
    expect(credits?.monthlyCredits).toBe(22.5);
    expect(credits?.purchasedCredits).toBe(5);
  });

  test("also accepts a flat credits payload and coerces numeric strings", () => {
    const credits = parseCommandCodeCredits({ monthlyCredits: "12.0" });
    expect(credits?.monthlyCredits).toBe(12);
  });

  test("rejects payloads without a monthly credit figure", () => {
    expect(parseCommandCodeCredits({ credits: {} })).toBeNull();
    expect(parseCommandCodeCredits("nope")).toBeNull();
    expect(parseCommandCodeCredits(null)).toBeNull();
  });

  test("reads the plan id from the subscription envelope and the free-tier null", () => {
    expect(
      parseCommandCodeSubscription({
        data: { planId: "individual-pro", status: "active", currentPeriodEnd: "2026-09-01" },
      })?.planId
    ).toBe("individual-pro");
    expect(parseCommandCodeSubscription({ success: true, data: null })).toBeNull();
  });

  test("maps plan ids to their documented monthly allowance", () => {
    expect(commandCodePlan("individual-go")?.monthlyCreditsUsd).toBe(10);
    expect(commandCodePlan("individual-ultra")?.displayName).toBe("Ultra");
    expect(commandCodePlan("unknown-plan")).toBeNull();
  });
});

describe("command code usage window", () => {
  test("computes used percent from allowance minus remaining", () => {
    const usage = buildCommandCodeUsage(
      {
        monthlyCredits: 12,
        purchasedCredits: 0,
        premiumMonthlyCredits: 0,
        opensourceMonthlyCredits: 0,
      },
      { planId: "individual-pro", status: "active", currentPeriodEnd: "2026-09-01" }
    );
    expect(usage?.planLabel).toBe("Command Code Pro");
    expect(usage?.monthly.usedPercent).toBe(60);
    expect(usage?.monthly.resetsAt).toBe("2026-09-01");
  });

  test("marks usage unlimited when the plan is unknown", () => {
    const usage = buildCommandCodeUsage(
      {
        monthlyCredits: 3,
        purchasedCredits: 0,
        premiumMonthlyCredits: 0,
        opensourceMonthlyCredits: 0,
      },
      null
    );
    expect(usage?.monthly.unlimited).toBe(true);
    expect(usage?.planLabel).toBe("Command Code");
  });

  test("clamps a depleted balance to 100 percent used", () => {
    const usage = buildCommandCodeUsage(
      {
        monthlyCredits: 0,
        purchasedCredits: 0,
        premiumMonthlyCredits: 0,
        opensourceMonthlyCredits: 0,
      },
      { planId: "individual-go", status: "active" }
    );
    expect(usage?.monthly.usedPercent).toBe(100);
  });
});
