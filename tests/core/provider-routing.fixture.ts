import { afterEach } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { resetProviderAccountPoolsForTests } from "../../src/core/provider-account-pool";
import { resetRouterForTests } from "../../src/core/router";

interface ProviderRoutingFixture {
  createdAgentIds: string[];
  createdProviderIds: string[];
}

export function createProviderRoutingFixture(): ProviderRoutingFixture {
  const createdAgentIds: string[] = [];
  const createdProviderIds: string[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    config.set("tool_approval_mode", "ask");
    config.set("router", null);
    globalThis.fetch = originalFetch;
    for (const agentId of createdAgentIds.splice(0)) {
      agentManager.delete(agentId);
    }
    for (const providerId of createdProviderIds.splice(0)) {
      providerManager.delete(providerId);
    }
    resetRouterForTests();
    resetProviderAccountPoolsForTests();
  });

  return { createdAgentIds, createdProviderIds };
}
