import { ChevronDown, Loader2 } from "lucide-react";
import type { AgentSummary, ProviderPlanSnapshot, SessionContextUsage } from "@/types";
import { ChatFastModeToggle } from "./ChatFastModeToggle";
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
  fastMode,
  fastModeUpdating,
  onFastModeChange,
  locked = false,
  controlId = "chat-agent-selector",
}: {
  agents: AgentSummary[];
  selectedAgentId?: string;
  modelRouterEnabled?: boolean;
  useModelRouter?: boolean;
  contextUsage?: SessionContextUsage | null;
  providerPlan?: ProviderPlanSnapshot | null;
  onSelectAgent: (agentId?: string) => void;
  updating?: boolean;
  fastMode?: boolean;
  fastModeUpdating?: boolean;
  onFastModeChange?: (enabled: boolean) => void;
  locked?: boolean;
  controlId?: string;
}) {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const routeLabel = useModelRouter
    ? "Model Router"
    : selectedAgent?.model || selectedAgent?.name || "Gateway default";
  const routeTitle = useModelRouter
    ? "Model Router"
    : selectedAgent?.model
      ? `${selectedAgent.name} - ${selectedAgent.model}`
      : routeLabel;
  return (
    <div className="chat-agent-controls flex min-w-0 items-center gap-0.5">
      <ContextUsageRing usage={contextUsage} providerPlan={providerPlan} />
      {onFastModeChange ? (
        <ChatFastModeToggle
          enabled={fastMode === true}
          provider={
            selectedAgent?.provider_type ?? selectedAgent?.provider ?? selectedAgent?.provider_id
          }
          model={selectedAgent?.model}
          disabled={useModelRouter}
          updating={fastModeUpdating}
          onChange={onFastModeChange}
        />
      ) : null}
      <label className="sr-only" htmlFor={controlId}>
        Chat agent
      </label>
      <div className="chat-agent-selector-shell relative min-w-0">
        <select
          id={controlId}
          value={useModelRouter ? MODEL_ROUTER_SELECTOR_VALUE : selectedAgentId || ""}
          disabled={updating || locked}
          onChange={(event) => onSelectAgent(event.target.value || undefined)}
          title={routeTitle}
          className="chat-agent-selector h-7 min-w-[104px] max-w-[196px] appearance-none truncate border-0 bg-transparent py-1 pl-2 pr-6 text-[11px] font-medium text-gray-300 outline-none ring-0 transition-colors hover:text-white focus:outline-none focus:ring-0 disabled:opacity-60"
        >
          {locked ? null : modelRouterEnabled ? (
            <option value={MODEL_ROUTER_SELECTOR_VALUE} className="chat-select-option">
              Model Router
            </option>
          ) : (
            <option value="" className="chat-select-option">
              Gateway default
            </option>
          )}
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id} className="chat-select-option">
              {agent.model ? `${agent.name} - ${agent.model}` : agent.name}
            </option>
          ))}
        </select>
        <span className="chat-agent-selector-compact-label pointer-events-none absolute inset-y-0 left-2 right-6 hidden items-center truncate text-[11px] font-medium text-gray-300">
          {routeLabel}
        </span>
        {locked ? null : (
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
        )}
      </div>
      {updating ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" /> : null}
    </div>
  );
}
