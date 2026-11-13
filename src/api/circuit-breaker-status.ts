import { providerManager } from "../core/providers";
import { getCircuitState } from "../core/tools/runtime-guards";

export function getCircuitBreakersStatus(): Record<
  string,
  { state: string; failureCount?: number }
> {
  const breakers: Record<string, { state: string; failureCount?: number }> = {};

  const providers = providerManager.list();
  for (const provider of providers) {
    const state = getCircuitState(`llm:${provider.id}`);
    if (state) {
      breakers[`llm:${provider.id}`] = {
        state: state.state,
        failureCount: state.failureCount,
      };
    }
  }

  return breakers;
}
