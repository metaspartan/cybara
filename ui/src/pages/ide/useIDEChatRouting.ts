import { apiFetch } from "@/lib/auth";
import { providerPlansApi } from "@/lib/api";
import type { AgentSummary, ProviderPlanSnapshot, ProviderPlanStatusResponse } from "@/types";
import { useEffect, useMemo, useState } from "react";
import type { IDEChatPanelProps } from "./ideTypes";

interface IDEChatRoutingOptions {
  activeAgentId: string | null;
  agents: IDEChatPanelProps["agents"];
  selectedAgentId: string;
}

export function useIDEChatRouting({
  activeAgentId,
  agents,
  selectedAgentId,
}: IDEChatRoutingOptions) {
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [modelRouterEnabled, setModelRouterEnabled] = useState(false);
  const [useModelRouter, setUseModelRouter] = useState(false);

  const chatAgentOptions = useMemo<AgentSummary[]>(
    () =>
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        model: agent.model || "",
        provider: agent.provider || "",
        provider_id: agent.provider_id,
        fallback_provider_id: agent.fallback_provider_id,
        status: agent.status as AgentSummary["status"],
        reasoning_effort: agent.reasoning_effort ?? null,
      })),
    [agents]
  );

  const activeAgentForPlan = useMemo(
    () => chatAgentOptions.find((agent) => agent.id === (activeAgentId || selectedAgentId)) ?? null,
    [activeAgentId, chatAgentOptions, selectedAgentId]
  );

  const activeProviderPlan = useMemo<ProviderPlanSnapshot | null>(() => {
    if (useModelRouter || !providerPlanStatus || !activeAgentForPlan) return null;
    const keys = new Set(
      [
        activeAgentForPlan.provider_id,
        activeAgentForPlan.provider,
        activeAgentForPlan.fallback_provider_id,
      ].filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    return (
      providerPlanStatus.providers.find((plan) =>
        [plan.configuredProviderId, plan.providerId, plan.providerType].some(
          (key) => typeof key === "string" && keys.has(key)
        )
      ) ?? null
    );
  }, [activeAgentForPlan, providerPlanStatus, useModelRouter]);

  useEffect(() => {
    let active = true;
    const loadRouterConfig = async () => {
      try {
        const response = await apiFetch("/api/router/config");
        if (!active) return;
        const data: unknown = await response.json();
        const enabled =
          typeof data === "object" && data !== null && "enabled" in data && data.enabled === true;
        setModelRouterEnabled(enabled);
        if (!enabled) setUseModelRouter(false);
      } catch {
        if (!active) return;
        setModelRouterEnabled(false);
        setUseModelRouter(false);
      }
    };
    const loadProviderPlans = async () => {
      const response = await providerPlansApi.status();
      if (active) setProviderPlanStatus(response.success ? (response.data ?? null) : null);
    };
    void loadRouterConfig();
    void loadProviderPlans();
    const interval = window.setInterval(loadProviderPlans, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return {
    activeAgentForPlan,
    activeProviderPlan,
    chatAgentOptions,
    modelRouterEnabled,
    setUseModelRouter,
    useModelRouter,
  };
}
