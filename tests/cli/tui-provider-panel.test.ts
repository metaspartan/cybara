import { describe, expect, test } from "bun:test";
import {
  loadTUIProviderPanel,
  loadTUIProviderPanelDetails,
  loadTUIProviders,
  type TUIProviderRequest,
} from "../../src/cli/tui/provider-panel-data";

function providerRequest(responses: Readonly<Record<string, unknown | Error>>): TUIProviderRequest {
  return async <T>(endpoint: string): Promise<T> => {
    const value = responses[endpoint];
    if (value instanceof Error) throw value;
    return value as T;
  };
}

describe("TUI provider panel data", () => {
  test("loads providers without waiting for optional details", async () => {
    let resolveDetails: ((value: { providers: [] }) => void) | undefined;
    const details = new Promise<{ providers: [] }>((resolve) => {
      resolveDetails = resolve;
    });
    const request: TUIProviderRequest = async <T>(endpoint: string): Promise<T> => {
      if (endpoint === "/api/providers") {
        return [
          {
            id: "provider-1",
            name: "Provider One",
            provider: "openai",
            is_default: true,
          },
        ] as T;
      }
      if (endpoint === "/api/provider-plans/status") return details as Promise<T>;
      return [] as T;
    };

    const providers = await loadTUIProviders(request);
    expect(providers).toHaveLength(1);
    resolveDetails?.({ providers: [] });
    await expect(loadTUIProviderPanelDetails(request)).resolves.toEqual({
      plans: { providers: [] },
      pools: [],
      warnings: [],
    });
  });

  test("keeps providers visible when optional usage and pool endpoints fail", async () => {
    const result = await loadTUIProviderPanel(
      providerRequest({
        "/api/providers": [
          {
            id: "provider-1",
            name: "Provider One",
            provider: "openai",
            is_default: true,
          },
        ],
        "/api/provider-plans/status": new Error("usage unavailable"),
        "/api/provider-account-pools": new Error("pools unavailable"),
      })
    );

    expect(result.providers).toHaveLength(1);
    expect(result.plans).toBeNull();
    expect(result.pools).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  test("rejects a failed primary provider request", async () => {
    await expect(
      loadTUIProviderPanel(
        providerRequest({
          "/api/providers": new Error("provider request failed"),
          "/api/provider-plans/status": { providers: [] },
          "/api/provider-account-pools": [],
        })
      )
    ).rejects.toThrow("provider request failed");
  });

  test("rejects a malformed provider response", async () => {
    await expect(
      loadTUIProviderPanel(
        providerRequest({
          "/api/providers": { providers: [] },
          "/api/provider-plans/status": { providers: [] },
          "/api/provider-account-pools": [],
        })
      )
    ).rejects.toThrow("invalid response");
  });
});
