import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowUpRight, Bot, Trash2, Edit2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProviderIcon, hasProviderIcon } from "@/components/ProviderIcon";
import { Select } from "@/components/ui/Input";
import { PageLayout } from "@/components/layout";
import {
  useAgent,
  useAgentSummaries,
  useProviders,
  useProviderModels,
  useCreateAgent,
  useCreateDefaultAgent,
  useUpdateAgent,
  useDeleteAgent,
} from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { settingsApi } from "@/lib/api";
import {
  parseAgentConfig,
  readAgentReasoningEffort,
  reasoningEffortLabel,
  supportedReasoningOptions,
} from "@/lib/reasoning";
import { buildAgentChatPath } from "./chat/chatRoute";
import type { Agent, AgentSummary } from "@/types";

const agentTypes = [
  { value: "main", label: "Main Assistant" },
  { value: "research", label: "Research" },
  { value: "coder", label: "Coder" },
  { value: "planner", label: "Planner" },
  { value: "ops", label: "Operations" },
  { value: "worker", label: "Worker" },
];

const toolProfiles = [
  { value: "full", label: "Full" },
  { value: "coding", label: "Coding" },
  { value: "research", label: "Research" },
  { value: "safe", label: "Read only" },
];

function agentToolProfile(agent: Pick<Agent, "config">): string {
  const value = parseAgentConfig(agent.config).tool_profile;
  return typeof value === "string" && value ? value : "full";
}

function agentReasoningLabel(agent: AgentSummary): string {
  return reasoningEffortLabel(
    agent.reasoning_effort ?? null,
    agent.provider_type ?? agent.provider,
    agent.model ?? ""
  );
}

function buildConfig(formData: FormData, existing?: unknown): Record<string, unknown> {
  const config: Record<string, unknown> = { ...parseAgentConfig(existing) };
  const modelParams: Record<string, unknown> = {
    ...((config.model_params as Record<string, unknown>) || {}),
  };
  const effort = (formData.get("reasoning_effort") as string) || "";
  if (effort) {
    modelParams.reasoning_effort = effort;
  } else {
    delete modelParams.reasoning_effort;
  }
  if (Object.keys(modelParams).length > 0) {
    config.model_params = modelParams;
  } else {
    delete config.model_params;
  }
  config.tool_profile = (formData.get("tool_profile") as string) || "full";
  return config;
}

export function Agents() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<AgentSummary | null>(null);

  const { data: agents, isLoading } = useAgentSummaries();
  const { data: editingAgent } = useAgent(editingAgentId);
  const { data: providers } = useProviders();
  const { addToast } = useUIStore();

  const createAgent = useCreateAgent();
  const createDefaultAgent = useCreateDefaultAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const [defaultModel, setDefaultModel] = useState("");
  const [savingDefaultModel, setSavingDefaultModel] = useState(false);

  useEffect(() => {
    let mounted = true;
    void settingsApi.getConfig().then((res) => {
      if (mounted && res.success && typeof res.data?.default_model === "string") {
        setDefaultModel(res.data.default_model as string);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const availableModels = Array.from(
    new Set((providers ?? []).flatMap((p) => (Array.isArray(p.models) ? p.models : [])))
  ).sort();

  const saveDefaultModel = async (next: string) => {
    const previous = defaultModel;
    setDefaultModel(next);
    setSavingDefaultModel(true);
    try {
      const res = await settingsApi.updateConfig({ default_model: next });
      if (!res.success || !res.data?.success) throw new Error("save failed");
      addToast("success", next ? `Default model set to ${next}` : "Default model set to auto");
    } catch {
      setDefaultModel(previous);
      addToast("error", "Failed to set default model");
    } finally {
      setSavingDefaultModel(false);
    }
  };

  const filteredAgents = agents?.filter(
    (agent) =>
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (agent.type && agent.type.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleCreate = async (formData: FormData) => {
    try {
      await createAgent.mutateAsync({
        name: formData.get("name") as string,
        type: formData.get("type") as string,
        model: formData.get("model") as string,
        provider_id: formData.get("provider_id") as string,
        system_prompt: formData.get("system_prompt") as string,
        config: buildConfig(formData),
      });
      addToast("success", "Agent created successfully");
      setIsCreateModalOpen(false);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create agent");
    }
  };

  const handleCreateDefault = async () => {
    try {
      await createDefaultAgent.mutateAsync();
      addToast("success", 'Default agent "Mini" created');
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create default agent");
    }
  };

  const handleUpdate = async (formData: FormData) => {
    if (!editingAgentId || !editingAgent) return;
    try {
      await updateAgent.mutateAsync({
        id: editingAgentId,
        data: {
          name: formData.get("name") as string,
          type: formData.get("type") as string,
          model: formData.get("model") as string,
          provider_id: formData.get("provider_id") as string,
          system_prompt: formData.get("system_prompt") as string,
          config: buildConfig(formData, editingAgent.config),
        },
      });
      addToast("success", "Agent updated successfully");
      setEditingAgentId(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update agent");
    }
  };

  const handleDelete = async () => {
    if (!deletingAgent) return;
    try {
      await deleteAgent.mutateAsync(deletingAgent.id);
      addToast("success", "Agent deleted successfully");
      setDeletingAgent(null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to delete agent");
    }
  };

  return (
    <PageLayout title="Agents">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
        <Input
          placeholder="Search agents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2 flex-wrap">
          {availableModels.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 whitespace-nowrap">Default model</span>
              <Select
                value={defaultModel}
                onChange={(val) => void saveDefaultModel(val)}
                disabled={savingDefaultModel}
                options={[
                  { value: "", label: "Auto (provider default)" },
                  ...availableModels.map((m) => ({ value: m, label: m })),
                ]}
              />
            </div>
          )}
          <Button onClick={() => setIsCreateModalOpen(true)}>Create Agent</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-white/10" />
                  <div className="h-5 bg-white/10 rounded w-24" />
                </div>
                <div className="h-4 bg-white/10 rounded w-1/3 mb-2" />
                <div className="h-3 bg-white/10 rounded w-1/2 mb-2" />
                <div className="h-3 bg-white/10 rounded w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredAgents?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bot className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No agents yet</h3>
            <p className="text-gray-400 mb-4">
              Start with a ready-to-go default agent, or build a custom one.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={handleCreateDefault} isLoading={createDefaultAgent.isPending}>
                Create default agent
              </Button>
              <Button variant="ghost" onClick={() => setIsCreateModalOpen(true)}>
                Custom agent
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents?.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={() => setEditingAgentId(agent.id)}
              onDelete={() => setDeletingAgent(agent)}
            />
          ))}
        </div>
      )}

      <AgentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreate}
        title="Create Agent"
        providers={providers || []}
        isLoading={createAgent.isPending}
      />

      <AgentModal
        isOpen={!!editingAgentId}
        onClose={() => setEditingAgentId(null)}
        onSubmit={handleUpdate}
        title="Edit Agent"
        providers={providers || []}
        isLoading={updateAgent.isPending}
        initialData={editingAgent}
      />

      <ConfirmDialog
        isOpen={!!deletingAgent}
        onClose={() => setDeletingAgent(null)}
        onConfirm={handleDelete}
        title="Delete Agent"
        description={`Are you sure you want to delete "${deletingAgent?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteAgent.isPending}
      />
    </PageLayout>
  );
}

function AgentCard({
  agent,
  onEdit,
  onDelete,
}: {
  agent: AgentSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card hover>
      <CardContent>
        <Link
          to={buildAgentChatPath(agent.id)}
          className="group flex items-start justify-between gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-label={`Open ${agent.name} in Chat`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/10 text-white">
              {hasProviderIcon(agent.provider_type ?? agent.provider) ? (
                <ProviderIcon provider={agent.provider_type ?? agent.provider} size={22} />
              ) : (
                <Bot className="h-5 w-5 text-indigo-400" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-medium text-white group-hover:text-indigo-200">
                {agent.name}
              </h3>
              <p className="mt-1 text-xs text-gray-500">Ready on demand</p>
            </div>
          </div>
          <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-gray-500 transition-colors group-hover:text-indigo-300" />
        </Link>

        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Type</span>
            <span className="text-gray-300 capitalize">{agent.type || "main"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Model</span>
            <span className="text-gray-300">{agent.model}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Reasoning</span>
            <span className="text-gray-300">{agentReasoningLabel(agent)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Tools</span>
            <span className="text-gray-300 capitalize">{agent.tool_profile || "full"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Created</span>
            <span className="text-gray-300">
              {agent.created_at ? new Date(agent.created_at).toLocaleDateString() : "Unknown"}
            </span>
          </div>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t border-white/10">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            leftIcon={<Edit2 className="w-4 h-4" />}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300"
            leftIcon={<Trash2 className="w-4 h-4" />}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  providers,
  isLoading,
  initialData,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  title: string;
  providers: Array<{ id: string; name: string; provider?: string }>;
  isLoading: boolean;
  initialData?: Agent;
}) {
  const [selectedProvider, setSelectedProvider] = useState(
    initialData?.provider || providers[0]?.id || ""
  );
  const [selectedModel, setSelectedModel] = useState(initialData?.model || "");
  const [customModel, setCustomModel] = useState("");
  const [useCustomModel, setUseCustomModel] = useState(false);
  const { data: models, isLoading: modelsLoading } = useProviderModels(selectedProvider);

  const providerChangedRef = useRef(false);
  useEffect(() => {
    if (providerChangedRef.current) {
      setSelectedModel("");
      setCustomModel("");
      setUseCustomModel(false);
    }
    providerChangedRef.current = true;
  }, [selectedProvider]);

  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(initialData?.provider || providers[0]?.id || "");
      setSelectedModel(initialData?.model || "");
      setCustomModel("");
      setUseCustomModel(false);
      providerChangedRef.current = false;
    }
  }, [isOpen, initialData, providers]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const modelValue = useCustomModel ? customModel : selectedModel;
    formData.set("model", modelValue);
    formData.set("provider_id", selectedProvider);
    onSubmit(formData);
  };

  const modelOptions =
    models?.map((m: { model_id: string; model_name?: string; context_window?: number }) => ({
      value: m.model_id,
      label: m.model_name
        ? `${m.model_name}${m.context_window ? ` (${Math.round(m.context_window / 1024)}K)` : ""}`
        : m.model_id,
    })) || [];

  const activeFormModel = useCustomModel ? customModel : selectedModel;
  const selectedProviderType =
    providers.find((provider) => provider.id === selectedProvider)?.provider ?? selectedProvider;
  const reasoningEffortOptions = useMemo(
    () => supportedReasoningOptions(selectedProviderType, activeFormModel),
    [selectedProviderType, activeFormModel]
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="p-6">
        <h2 className="text-xl font-semibold text-white mb-6">{title}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            name="name"
            defaultValue={initialData?.name}
            placeholder="My Agent"
            required
          />

          <Select
            label="Type"
            name="type"
            defaultValue={initialData?.type || "main"}
            options={agentTypes}
          />

          <Select
            label="Provider"
            name="provider_id"
            value={selectedProvider}
            onChange={(val) => setSelectedProvider(val)}
            options={providers.map((p) => ({ value: p.id, label: p.name }))}
          />

          <div className="space-y-2">
            {!useCustomModel ? (
              <>
                <Select
                  label="Model"
                  name="model_display"
                  value={selectedModel}
                  onChange={(val) => setSelectedModel(val)}
                  options={
                    modelsLoading
                      ? [{ value: "", label: "Loading models..." }]
                      : modelOptions.length > 0
                        ? [{ value: "", label: "Select a model..." }, ...modelOptions]
                        : [{ value: "", label: "No models found" }]
                  }
                />
                <button
                  type="button"
                  onClick={() => setUseCustomModel(true)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                >
                  or type a custom model name
                </button>
              </>
            ) : (
              <>
                <Input
                  label="Model"
                  name="model_custom"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="model-name-here"
                />
                {modelOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseCustomModel(false);
                      setCustomModel("");
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                  >
                    or select from available models
                  </button>
                )}
              </>
            )}
          </div>

          <input type="hidden" name="model" value={useCustomModel ? customModel : selectedModel} />

          <Select
            label="Reasoning Effort"
            name="reasoning_effort"
            defaultValue={readAgentReasoningEffort(initialData?.config) || ""}
            options={reasoningEffortOptions}
          />

          <Select
            label="Tool Profile"
            name="tool_profile"
            defaultValue={initialData ? agentToolProfile(initialData) : "full"}
            options={toolProfiles}
          />

          <Textarea
            label="System Prompt"
            name="system_prompt"
            defaultValue={initialData?.system_prompt || ""}
            placeholder="You are a helpful AI assistant..."
            rows={6}
          />

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isLoading}>
              {isLoading ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export default Agents;
