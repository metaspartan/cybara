import { ChevronDown, Loader2 } from "lucide-react";
import type { AgentSummary, ProviderPlanSnapshot, SessionContextUsage } from "@/types";
import { ContextUsageRing } from "./ContextUsageRing";

export const MODEL_ROUTER_SELECTOR_VALUE = "__model_router__";

export function ChatAgentControls({
  agents,
  selectedAgentId,
  modelRouterEnabled,
  useModelRouter,
  contextUsage,
  providerPlan,
  onSelectAgent,
  updating,
}: {
  agents: AgentSummary[];
  selectedAgentId?: string;
  modelRouterEnabled?: boolean;
  useModelRouter?: boolean;
  contextUsage?: SessionContextUsage | null;
  providerPlan?: ProviderPlanSnapshot | null;
  onSelectAgent: (agentId?: string) => void;
  updating?: boolean;
}) {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const routeLabel = useModelRouter
    ? "Model Router"
    : selectedAgent?.model || selectedAgent?.name || "Gateway default";
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <ContextUsageRing usage={contextUsage} providerPlan={providerPlan} />
      <label className="sr-only" htmlFor="chat-agent-selector">
        Chat agent
      </label>
      <div className="relative min-w-0">
        <select
          id="chat-agent-selector"
          value={useModelRouter ? MODEL_ROUTER_SELECTOR_VALUE : selectedAgentId || ""}
          disabled={updating}
          onChange={(event) => onSelectAgent(event.target.value || undefined)}
          title={routeLabel}
          className="h-7 min-w-[104px] max-w-[196px] appearance-none truncate rounded-full border border-transparent bg-transparent py-1 pl-2 pr-6 text-[11px] font-medium text-gray-300 outline-none transition-colors [color-scheme:dark] hover:bg-white/[0.06] hover:text-white focus:border-white/15 focus:bg-white/[0.06] disabled:opacity-60"
        >
          {modelRouterEnabled ? (
            <option value={MODEL_ROUTER_SELECTOR_VALUE} className="bg-[#11131c] text-white">
              Model Router
            </option>
          ) : (
            <option value="" className="bg-[#11131c] text-white">
              Gateway default
            </option>
          )}
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id} className="bg-[#11131c] text-white">
              {agent.model ? `${agent.name} - ${agent.model}` : agent.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
      </div>
      {updating ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" /> : null}
    </div>
  );
}
