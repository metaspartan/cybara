import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Plus,
  Play,
  Square,
  Trash2,
  Edit2,
  Search,
  RefreshCw,
  MessageSquare,
  Clock,
  Hash,
  Send,
  X,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Input";
import { PageLayout } from "@/components/layout";
import {
  useAgents,
  useProviders,
  useProviderModels,
  useCreateAgent,
  useCreateDefaultAgent,
  useUpdateAgent,
  useDeleteAgent,
  useStartAgent,
  useStopAgent,
  useAgentMessage,
  useClearAgentHistory,
  useAgentState,
} from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { settingsApi } from "@/lib/api";
import type { Agent, AgentMessage } from "@/types";

const agentTypes = [
  { value: "main", label: "Main Assistant" },
  { value: "research", label: "Research" },
  { value: "coder", label: "Coder" },
  { value: "planner", label: "Planner" },
  { value: "ops", label: "Operations" },
  { value: "worker", label: "Worker" },
];

const reasoningEffortOptions = [
  { value: "", label: "Default (provider setting)" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
];

function buildConfig(
  formData: FormData,
  existing?: Record<string, unknown>
): Record<string, unknown> {
  const config: Record<string, unknown> = { ...(existing || {}) };
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
  return config;
}

export function Agents() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: agents, isLoading } = useAgents();
  const { data: providers } = useProviders();
  const { addToast } = useUIStore();

  const createAgent = useCreateAgent();
  const createDefaultAgent = useCreateDefaultAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const sendMessage = useAgentMessage();
  const clearHistory = useClearAgentHistory();

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleOpenChat = async (agent: Agent) => {
    setChatAgent(agent);
    setChatMessages([]);
    setChatInput("");
  };

  const handleSendMessage = async () => {
    if (!chatAgent || !chatInput.trim() || sendMessage.isPending) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await sendMessage.mutateAsync({
        id: chatAgent.id,
        message: userMessage,
      });
      setChatMessages((prev) => [...prev, { role: "assistant", content: result.response }]);
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Failed to send message"}`,
        },
      ]);
    }
  };

  const handleClearHistory = async () => {
    if (!chatAgent) return;
    try {
      await clearHistory.mutateAsync(chatAgent.id);
      setChatMessages([]);
      addToast("success", "Conversation cleared");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to clear history");
    }
  };

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
      addToast("success", 'Default agent "Mini" created and started');
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to create default agent");
    }
  };

  const handleToggleAutostart = async (agent: Agent) => {
    const rawConfig =
      typeof agent.config === "string"
        ? (() => {
            try {
              return JSON.parse(agent.config as unknown as string) as Record<string, unknown>;
            } catch {
              return {};
            }
          })()
        : agent.config || {};
    const current = Boolean((rawConfig as { autostart?: boolean }).autostart);
    try {
      await updateAgent.mutateAsync({
        id: agent.id,
        data: { config: { ...rawConfig, autostart: !current } },
      });
      addToast(
        "success",
        !current
          ? `"${agent.name}" will auto-start when Cybara boots`
          : `Auto-start disabled for "${agent.name}"`
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to update auto-start");
    }
  };

  const handleUpdate = async (formData: FormData) => {
    if (!editingAgent) return;
    try {
      await updateAgent.mutateAsync({
        id: editingAgent.id,
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
      setEditingAgent(null);
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

  const handleToggleStatus = async (agent: Agent) => {
    try {
      if (agent.status === "running") {
        await stopAgent.mutateAsync(agent.id);
        addToast("success", `Agent "${agent.name}" stopped`);
      } else {
        await startAgent.mutateAsync(agent.id);
        addToast("success", `Agent "${agent.name}" started`);
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to toggle status");
    }
  };

  const getStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "running":
        return (
          <Badge variant="success" size="sm">
            Running
          </Badge>
        );
      case "stopped":
        return (
          <Badge variant="default" size="sm">
            Stopped
          </Badge>
        );
      default:
        return (
          <Badge variant="default" size="sm">
            {status || "unknown"}
          </Badge>
        );
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
              <Button
                onClick={handleCreateDefault}
                isLoading={createDefaultAgent.isPending}
              >
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
              onToggleStatus={() => handleToggleStatus(agent)}
              onEdit={() => setEditingAgent(agent)}
              onDelete={() => setDeletingAgent(agent)}
              onChat={() => handleOpenChat(agent)}
              onToggleAutostart={() => handleToggleAutostart(agent)}
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
        isOpen={!!editingAgent}
        onClose={() => setEditingAgent(null)}
        onSubmit={handleUpdate}
        title="Edit Agent"
        providers={providers || []}
        isLoading={updateAgent.isPending}
        initialData={editingAgent || undefined}
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

      <ChatModal
        isOpen={!!chatAgent}
        onClose={() => setChatAgent(null)}
        agent={chatAgent}
        messages={chatMessages}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={handleSendMessage}
        onClearHistory={handleClearHistory}
        isLoading={sendMessage.isPending}
        chatEndRef={chatEndRef}
      />
    </PageLayout>
  );
}

function AgentCard({
  agent,
  onToggleStatus,
  onEdit,
  onDelete,
  onChat,
  onToggleAutostart,
}: {
  agent: Agent;
  onToggleStatus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChat: () => void;
  onToggleAutostart: () => void;
}) {
  const { data: state } = useAgentState(agent.status === "running" ? agent.id : null);
  const isRunning = agent.status === "running";
  const rawConfig =
    typeof agent.config === "string"
      ? (() => {
          try {
            return JSON.parse(agent.config as unknown as string) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : agent.config || {};
  const autostart = Boolean((rawConfig as { autostart?: boolean }).autostart);

  return (
    <Card hover>
      <CardContent>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${isRunning ? "bg-green-500/20" : "bg-indigo-500/20"}`}
            >
              <Bot className={`w-5 h-5 ${isRunning ? "text-green-400" : "text-indigo-400"}`} />
            </div>
            <div>
              <h3 className="font-medium text-white">{agent.name}</h3>
              {isRunning && state ? (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="success" size="sm">
                    Running
                  </Badge>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    {state.messageCount || 0}
                  </span>
                </div>
              ) : (
                getStatusBadge(agent.status)
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onToggleStatus}>
            {isRunning ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Type</span>
            <span className="text-gray-300 capitalize">{agent.type || "main"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Model</span>
            <span className="text-gray-300">{agent.model}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Auto-start on boot</span>
            <button
              type="button"
              onClick={onToggleAutostart}
              title="Start this agent automatically when Cybara boots"
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                autostart
                  ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {autostart ? "On" : "Off"}
            </button>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Created</span>
            <span className="text-gray-300">
              {agent.created_at ? new Date(agent.created_at).toLocaleDateString() : "Unknown"}
            </span>
          </div>
          {isRunning && state?.lastActive && (
            <div className="flex justify-between">
              <span className="text-gray-500">Last active</span>
              <span className="text-gray-300 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(state.lastActive).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t border-white/10">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            leftIcon={<MessageSquare className="w-4 h-4" />}
            onClick={onChat}
            disabled={!isRunning}
          >
            Chat
          </Button>
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

function ChatModal({
  isOpen,
  onClose,
  agent,
  messages,
  input,
  onInputChange,
  onSend,
  onClearHistory,
  isLoading,
  chatEndRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  agent: Agent | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClearHistory: () => void;
  isLoading: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
}) {
  if (!isOpen || !agent) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="flex flex-col h-[600px]">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <h3 className="font-medium text-white">{agent.name}</h3>
              <p className="text-xs text-gray-500">Running agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearHistory}
              leftIcon={<RotateCcw className="w-4 h-4" />}
            >
              Clear
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Start a conversation with {agent.name}</p>
              <p className="text-sm mt-1">Messages will appear here</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-2 ${msg.role === "user"
                      ? "bg-indigo-500/20 text-indigo-100"
                      : "bg-white/5 text-gray-200"
                    }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 border-t border-white/10">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="Type your message..."
              className="min-h-[44px] max-h-32 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
            />
            <Button onClick={onSend} disabled={!input.trim() || isLoading} className="shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </Modal>
  );
}

function getStatusBadge(status: string | undefined) {
  switch (status) {
    case "running":
      return (
        <Badge variant="success" size="sm">
          Running
        </Badge>
      );
    case "stopped":
      return (
        <Badge variant="default" size="sm">
          Stopped
        </Badge>
      );
    default:
      return (
        <Badge variant="default" size="sm">
          {status || "unknown"}
        </Badge>
      );
  }
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
  providers: Array<{ id: string; name: string }>;
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
            defaultValue={
              ((initialData?.config as { model_params?: { reasoning_effort?: string } })?.model_params
                ?.reasoning_effort as string) || ""
            }
            options={reasoningEffortOptions}
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
