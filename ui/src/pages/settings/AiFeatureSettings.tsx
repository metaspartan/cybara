import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { extractApiError, settingsApi } from "@/lib/api";
import { useAgentSummaries } from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export function AiFeatureSettings() {
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [backgroundAgentId, setBackgroundAgentId] = useState("");
  const [selfImprovingSkills, setSelfImprovingSkills] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [toonStructuredDataEnabled, setToonStructuredDataEnabled] = useState(true);
  const [savingReasoningEffort, setSavingReasoningEffort] = useState(false);
  const [savingTokenOptimization, setSavingTokenOptimization] = useState(false);
  const [loading, setLoading] = useState(true);
  const { data: agents } = useAgentSummaries();
  const { addToast } = useUIStore();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted) return;
        const data = result.success ? result.data : undefined;
        setDefaultAgentId(typeof data?.default_agent_id === "string" ? data.default_agent_id : "");
        setBackgroundAgentId(
          typeof data?.background_agent_id === "string" ? data.background_agent_id : ""
        );
        setSelfImprovingSkills(data?.self_improving_skills_enabled !== false);
        setReasoningEffort(typeof data?.reasoning_effort === "string" ? data.reasoning_effort : "");
        const tokenOptimization = data?.token_optimization as
          | { toonStructuredDataEnabled?: boolean; toon_structured_data_enabled?: boolean }
          | undefined;
        setToonStructuredDataEnabled(
          tokenOptimization?.toonStructuredDataEnabled ??
            tokenOptimization?.toon_structured_data_enabled ??
            true
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const saveDefaultAgent = async (agentId: string) => {
    const previous = defaultAgentId;
    setDefaultAgentId(agentId);
    try {
      const result = await settingsApi.updateConfig({ default_agent_id: agentId });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Config update failed"));
      }
      addToast("success", agentId ? "Default agent updated" : "Default agent cleared");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update default agent");
      setDefaultAgentId(previous);
    }
  };

  const saveBackgroundAgent = async (agentId: string) => {
    const previous = backgroundAgentId;
    setBackgroundAgentId(agentId);
    try {
      const result = await settingsApi.updateConfig({ background_agent_id: agentId });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Config update failed"));
      }
      addToast(
        "success",
        agentId ? "Background model updated" : "Background model reset to default"
      );
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to update background model"
      );
      setBackgroundAgentId(previous);
    }
  };

  const toggleSelfImprovingSkills = async (enabled: boolean) => {
    setSelfImprovingSkills(enabled);
    try {
      const result = await settingsApi.updateConfig({ self_improving_skills_enabled: enabled });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast("success", `Self-improving skills ${enabled ? "enabled" : "disabled"}`);
    } catch {
      addToast("error", "Failed to update self-improving skills setting");
      setSelfImprovingSkills(!enabled);
    }
  };

  const updateReasoningEffort = async (next: string) => {
    const previous = reasoningEffort;
    setReasoningEffort(next);
    setSavingReasoningEffort(true);
    try {
      const result = await settingsApi.updateConfig({ reasoning_effort: next });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        next ? `Reasoning effort set to ${next}` : "Reasoning effort set to default"
      );
    } catch {
      setReasoningEffort(previous);
      addToast("error", "Failed to update reasoning effort");
    } finally {
      setSavingReasoningEffort(false);
    }
  };

  const toggleToonStructuredData = async (enabled: boolean) => {
    setToonStructuredDataEnabled(enabled);
    setSavingTokenOptimization(true);
    try {
      const result = await settingsApi.updateConfig({
        token_optimization: { toonStructuredDataEnabled: enabled },
      });
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Config update failed");
      }
      addToast(
        "success",
        enabled ? "Structured tool results use adaptive TOON" : "Structured tool results use JSON"
      );
    } catch {
      setToonStructuredDataEnabled(!enabled);
      addToast("error", "Failed to update token optimization");
    } finally {
      setSavingTokenOptimization(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          AI Behavior
        </CardTitle>
        <CardDescription>Model defaults and agent behavior for this gateway</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="py-3 border-b border-white/10">
          <p className="text-sm text-white font-medium">Default agent</p>
          <p className="text-xs text-gray-400 mt-0.5 mb-2">
            The agent used when a channel or request does not specify one. New chats and connected
            channels fall back to this gateway default.
          </p>
          <select
            value={defaultAgentId}
            disabled={loading}
            onChange={(e) => void saveDefaultAgent(e.target.value)}
            className="w-full sm:w-72 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <option value="">First available agent (default)</option>
            {(agents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.model ? ` — ${agent.model}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="py-3 border-b border-white/10">
          <p className="text-sm text-white font-medium">Background self-improvement model</p>
          <p className="text-xs text-gray-400 mt-0.5 mb-2">
            Memory and skill review run silently in the background after most turns. Point them at a
            cheaper agent to cut cost over time. Defaults to the agent that handled the turn.
          </p>
          <select
            value={backgroundAgentId}
            disabled={loading}
            onChange={(e) => void saveBackgroundAgent(e.target.value)}
            className="w-full sm:w-72 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <option value="">Same agent as the turn (default)</option>
            {(agents ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.model ? ` — ${agent.model}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="py-3 border-b border-white/10">
          <p className="text-sm text-white font-medium">Reasoning Effort</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Default thinking depth for reasoning-capable models. Applied when an agent does not set
            its own reasoning effort. Ignored by models without reasoning support.
          </p>
          <div className="mt-3 max-w-xs">
            <Select
              value={reasoningEffort}
              onChange={(value) => void updateReasoningEffort(value)}
              options={[
                { value: "", label: "Default (provider setting)" },
                { value: "minimal", label: "Minimal" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "xhigh", label: "Extra High" },
                { value: "max", label: "Max" },
              ]}
              disabled={loading || savingReasoningEffort}
            />
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-white/10">
          <div className="min-w-0 pr-3">
            <p className="text-sm text-white font-medium">Self-Improving Skills</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Let agents save reusable skills with{" "}
              <code className="text-indigo-400">skill_save</code> after completing complex tasks, so
              future sessions can reuse the procedure. When off, the tool is withheld.
            </p>
          </div>
          <Switch
            checked={selfImprovingSkills}
            disabled={loading}
            onChange={(next) => void toggleSelfImprovingSkills(next)}
          />
        </div>

        <div className="flex items-center justify-between py-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm text-white font-medium">Compact Structured Tool Results</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Use TOON for model-visible tool data when it is smaller than JSON.
            </p>
          </div>
          <Switch
            checked={toonStructuredDataEnabled}
            disabled={loading || savingTokenOptimization}
            onChange={(next) => void toggleToonStructuredData(next)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
