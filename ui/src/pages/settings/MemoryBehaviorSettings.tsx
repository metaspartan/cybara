import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { memoryApi, settingsApi } from "@/lib/api";
import { openExternal } from "@/utils/openExternal";
import { useUIStore } from "@/stores/uiStore";
import { Activity, Brain, Database, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import {
  asSettingsRecord,
  readBooleanSetting,
  readIntegerSetting,
  readNumberSetting,
} from "./settingsValueReaders";

export type MemoryBehaviorSettingsState = {
  backgroundReviewEnabled: boolean;
  backgroundReviewMinIntervalMs: number;
  backgroundReviewTimeoutSeconds: number;
  memoryFlushEnabled: boolean;
  memoryFlushSoftThresholdTokens: number;
  memoryFlushPrompt: string;
  memoryFlushSystemPrompt: string;
};

type MemoryRecallProvider =
  | "auto"
  | "local"
  | "transformers_js"
  | "openai"
  | "voyage"
  | "gemini"
  | "ollama";

type MemoryRecallSettingsState = {
  enabled: boolean;
  semanticEnabled: boolean;
  includeHidden: boolean;
  autoReindexOnWorkspaceSet: boolean;
  maxFiles: number;
  maxFileSizeMb: number;
  semanticMaxFiles: number;
  semanticMinScore: number;
  embeddingProvider: MemoryRecallProvider;
  embeddingModel: string;
};

const defaultMemoryBehaviorSettings: MemoryBehaviorSettingsState = {
  backgroundReviewEnabled: true,
  backgroundReviewMinIntervalMs: 300000,
  backgroundReviewTimeoutSeconds: 90,
  memoryFlushEnabled: true,
  memoryFlushSoftThresholdTokens: 4000,
  memoryFlushPrompt:
    "Pre-compaction memory flush. Store durable memories now (use memory/YYYY-MM-DD.md via write tool; create memory/ if needed). If nothing to store, reply with [SILENT].",
  memoryFlushSystemPrompt:
    "Pre-compaction memory flush turn. The session is near auto-compaction; capture durable memories to disk. You may reply, but usually [SILENT] is correct.",
};

const defaultMemoryRecallSettings: MemoryRecallSettingsState = {
  enabled: false,
  semanticEnabled: false,
  includeHidden: false,
  autoReindexOnWorkspaceSet: false,
  maxFiles: 25000,
  maxFileSizeMb: 1,
  semanticMaxFiles: 2000,
  semanticMinScore: 0.45,
  embeddingProvider: "auto",
  embeddingModel: "",
};

const memoryRecallProviderOptions: Array<{ value: MemoryRecallProvider; label: string }> = [
  { value: "auto", label: "Auto (best available)" },
  { value: "local", label: "Local database (keyword only, no model)" },
  { value: "transformers_js", label: "Local Transformers.js" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "voyage", label: "Voyage AI" },
  { value: "gemini", label: "Gemini" },
];

const memoryRecallModelSuggestions: Record<MemoryRecallProvider, string[]> = {
  auto: [],
  local: [],
  transformers_js: [
    "Xenova/all-MiniLM-L6-v2",
    "Xenova/e5-small-v2",
    "Xenova/gte-small",
    "Xenova/multilingual-e5-small",
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "Xenova/bge-small-en-v1.5",
    "Xenova/paraphrase-MiniLM-L3-v2",
  ],
  ollama: ["nomic-embed-text", "mxbai-embed-large", "snowflake-arctic-embed2"],
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  voyage: [
    "voyage-3",
    "voyage-3-large",
    "voyage-3-lite",
    "voyage-3.5",
    "voyage-3.5-lite",
    "voyage-code-3",
  ],
  gemini: ["text-embedding-004"],
};

const CUSTOM_MODEL_OPTION = "__custom__";

function readMemoryRecallProvider(value: unknown): MemoryRecallProvider {
  if (typeof value !== "string") return defaultMemoryRecallSettings.embeddingProvider;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "auto" ||
    normalized === "local" ||
    normalized === "transformers_js" ||
    normalized === "openai" ||
    normalized === "voyage" ||
    normalized === "gemini" ||
    normalized === "ollama"
  ) {
    return normalized;
  }
  if (normalized === "transformers") return "transformers_js";
  if (normalized === "local_db" || normalized === "keyword" || normalized === "database") {
    return "local";
  }
  return defaultMemoryRecallSettings.embeddingProvider;
}

function readMemoryBehaviorSettings(value: unknown): MemoryBehaviorSettingsState {
  const record = asSettingsRecord(value);
  return {
    backgroundReviewEnabled:
      typeof record.backgroundReviewEnabled === "boolean"
        ? record.backgroundReviewEnabled
        : defaultMemoryBehaviorSettings.backgroundReviewEnabled,
    backgroundReviewMinIntervalMs:
      typeof record.backgroundReviewMinIntervalMs === "number" &&
      Number.isFinite(record.backgroundReviewMinIntervalMs)
        ? record.backgroundReviewMinIntervalMs
        : defaultMemoryBehaviorSettings.backgroundReviewMinIntervalMs,
    backgroundReviewTimeoutSeconds:
      typeof record.backgroundReviewTimeoutSeconds === "number" &&
      Number.isFinite(record.backgroundReviewTimeoutSeconds)
        ? record.backgroundReviewTimeoutSeconds
        : defaultMemoryBehaviorSettings.backgroundReviewTimeoutSeconds,
    memoryFlushEnabled:
      typeof record.memoryFlushEnabled === "boolean"
        ? record.memoryFlushEnabled
        : defaultMemoryBehaviorSettings.memoryFlushEnabled,
    memoryFlushSoftThresholdTokens:
      typeof record.memoryFlushSoftThresholdTokens === "number" &&
      Number.isFinite(record.memoryFlushSoftThresholdTokens)
        ? record.memoryFlushSoftThresholdTokens
        : defaultMemoryBehaviorSettings.memoryFlushSoftThresholdTokens,
    memoryFlushPrompt:
      typeof record.memoryFlushPrompt === "string"
        ? record.memoryFlushPrompt
        : defaultMemoryBehaviorSettings.memoryFlushPrompt,
    memoryFlushSystemPrompt:
      typeof record.memoryFlushSystemPrompt === "string"
        ? record.memoryFlushSystemPrompt
        : defaultMemoryBehaviorSettings.memoryFlushSystemPrompt,
  };
}

function readMemoryRecallSettings(value: unknown): MemoryRecallSettingsState {
  const record = asSettingsRecord(value);
  const maxFileSizeBytes = readIntegerSetting(
    record.maxFileSizeBytes,
    defaultMemoryRecallSettings.maxFileSizeMb * 1024 * 1024,
    8 * 1024,
    100 * 1024 * 1024
  );
  return {
    enabled: readBooleanSetting(record.enabled, defaultMemoryRecallSettings.enabled),
    semanticEnabled: readBooleanSetting(
      record.semanticEnabled,
      defaultMemoryRecallSettings.semanticEnabled
    ),
    includeHidden: readBooleanSetting(
      record.includeHidden,
      defaultMemoryRecallSettings.includeHidden
    ),
    autoReindexOnWorkspaceSet: readBooleanSetting(
      record.autoReindexOnWorkspaceSet,
      defaultMemoryRecallSettings.autoReindexOnWorkspaceSet
    ),
    maxFiles: readIntegerSetting(
      record.maxFiles,
      defaultMemoryRecallSettings.maxFiles,
      100,
      1_000_000
    ),
    maxFileSizeMb: Number((maxFileSizeBytes / (1024 * 1024)).toFixed(2)),
    semanticMaxFiles: readIntegerSetting(
      record.semanticMaxFiles,
      defaultMemoryRecallSettings.semanticMaxFiles,
      100,
      50_000
    ),
    semanticMinScore: Number(
      readNumberSetting(
        record.semanticMinScore,
        defaultMemoryRecallSettings.semanticMinScore,
        0.05,
        0.99
      ).toFixed(2)
    ),
    embeddingProvider: readMemoryRecallProvider(record.embeddingProvider),
    embeddingModel:
      typeof record.embeddingModel === "string" ? record.embeddingModel.trim().slice(0, 160) : "",
  };
}

function memoryRecallConfigPayload(recall: MemoryRecallSettingsState): Record<string, unknown> {
  return {
    enabled: recall.enabled,
    autoReindexOnWorkspaceSet: recall.autoReindexOnWorkspaceSet,
    includeHidden: recall.includeHidden,
    maxFileSizeBytes: Math.round(
      readNumberSetting(
        recall.maxFileSizeMb,
        defaultMemoryRecallSettings.maxFileSizeMb,
        0.01,
        100
      ) *
        1024 *
        1024
    ),
    maxFiles: readIntegerSetting(
      recall.maxFiles,
      defaultMemoryRecallSettings.maxFiles,
      100,
      1_000_000
    ),
    semanticEnabled: recall.semanticEnabled,
    semanticMaxFiles: readIntegerSetting(
      recall.semanticMaxFiles,
      defaultMemoryRecallSettings.semanticMaxFiles,
      100,
      50_000
    ),
    semanticMinScore: readNumberSetting(
      recall.semanticMinScore,
      defaultMemoryRecallSettings.semanticMinScore,
      0.05,
      0.99
    ),
    embeddingProvider: recall.embeddingProvider,
    embeddingModel: recall.embeddingModel.trim().slice(0, 160),
  };
}

type MemoryProviderChoice =
  | "local"
  | "supermemory"
  | "mem0"
  | "honcho"
  | "openviking"
  | "hindsight";

type MemoryProviderFieldValues = Record<string, string>;

type MemoryProviderSettingsState = {
  provider: MemoryProviderChoice;
  autoRecall: boolean;
  autoCapture: boolean;
  supermemory: MemoryProviderFieldValues;
  mem0: MemoryProviderFieldValues;
  honcho: MemoryProviderFieldValues;
  openviking: MemoryProviderFieldValues;
  hindsight: MemoryProviderFieldValues;
};

type MemoryProviderFieldSpec = {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
};

type ExternalMemoryProviderChoice = Exclude<MemoryProviderChoice, "local">;

const memoryProviderOptions: Array<{ value: MemoryProviderChoice; label: string }> = [
  { value: "local", label: "Built-in (local)" },
  { value: "supermemory", label: "Supermemory" },
  { value: "mem0", label: "Mem0" },
  { value: "honcho", label: "Honcho" },
  { value: "openviking", label: "OpenViking" },
  { value: "hindsight", label: "Hindsight" },
];

const memoryProviderDocs: Record<ExternalMemoryProviderChoice, string> = {
  supermemory: "https://docs.supermemory.ai",
  mem0: "https://docs.mem0.ai",
  honcho: "https://docs.honcho.dev",
  openviking: "https://github.com/volcengine/OpenViking",
  hindsight: "https://hindsight.vectorize.io",
};

const memoryProviderFieldSpecs: Record<ExternalMemoryProviderChoice, MemoryProviderFieldSpec[]> = {
  supermemory: [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.supermemory.ai" },
    { key: "containerTag", label: "Container tag", placeholder: "cybara" },
  ],
  mem0: [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.mem0.ai" },
    { key: "userId", label: "User ID", placeholder: "cybara-user" },
    { key: "agentId", label: "Agent ID", placeholder: "cybara" },
  ],
  honcho: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.honcho.dev" },
    { key: "workspace", label: "Workspace", placeholder: "cybara" },
    { key: "peer", label: "Peer", placeholder: "user" },
  ],
  openviking: [
    { key: "baseUrl", label: "Server URL", required: true, placeholder: "http://127.0.0.1:1933" },
    { key: "apiKey", label: "API key", secret: true },
  ],
  hindsight: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.hindsight.vectorize.io" },
    { key: "tenant", label: "Tenant", placeholder: "default" },
    { key: "bankId", label: "Memory bank", placeholder: "cybara" },
  ],
};

const defaultMemoryProviderSettings: MemoryProviderSettingsState = {
  provider: "local",
  autoRecall: true,
  autoCapture: true,
  supermemory: { apiKey: "", baseUrl: "https://api.supermemory.ai", containerTag: "cybara" },
  mem0: { apiKey: "", baseUrl: "https://api.mem0.ai", userId: "cybara-user", agentId: "cybara" },
  honcho: { apiKey: "", baseUrl: "https://api.honcho.dev", workspace: "cybara", peer: "user" },
  openviking: { apiKey: "", baseUrl: "http://127.0.0.1:1933" },
  hindsight: {
    apiKey: "",
    baseUrl: "https://api.hindsight.vectorize.io",
    tenant: "default",
    bankId: "cybara",
  },
};

function readMemoryProviderChoice(value: unknown): MemoryProviderChoice {
  if (typeof value !== "string") return "local";
  const normalized = value.trim().toLowerCase();
  return memoryProviderOptions.some((option) => option.value === normalized)
    ? (normalized as MemoryProviderChoice)
    : "local";
}

function readMemoryProviderFields(
  value: unknown,
  defaults: MemoryProviderFieldValues
): MemoryProviderFieldValues {
  const record = asSettingsRecord(value);
  const out: MemoryProviderFieldValues = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    out[key] = typeof record[key] === "string" ? (record[key] as string) : fallback;
  }
  return out;
}

function readMemoryProviderSettings(value: unknown): MemoryProviderSettingsState {
  const record = asSettingsRecord(value);
  const defaults = defaultMemoryProviderSettings;
  return {
    provider: readMemoryProviderChoice(record.provider),
    autoRecall: readBooleanSetting(record.autoRecall, defaults.autoRecall),
    autoCapture: readBooleanSetting(record.autoCapture, defaults.autoCapture),
    supermemory: readMemoryProviderFields(record.supermemory, defaults.supermemory),
    mem0: readMemoryProviderFields(record.mem0, defaults.mem0),
    honcho: readMemoryProviderFields(record.honcho, defaults.honcho),
    openviking: readMemoryProviderFields(record.openviking, defaults.openviking),
    hindsight: readMemoryProviderFields(record.hindsight, defaults.hindsight),
  };
}

export function MemoryBehaviorSettings() {
  const { addToast } = useUIStore();
  const [memory, setMemory] = useState<MemoryBehaviorSettingsState>(defaultMemoryBehaviorSettings);
  const [recall, setRecall] = useState<MemoryRecallSettingsState>(defaultMemoryRecallSettings);
  const [provider, setProvider] = useState<MemoryProviderSettingsState>(
    defaultMemoryProviderSettings
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRecall, setSavingRecall] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTest, setProviderTest] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        setMemory(readMemoryBehaviorSettings(result.data?.memory));
        setRecall(readMemoryRecallSettings(result.data?.workspace_indexer));
        setProvider(readMemoryProviderSettings(result.data?.memory_provider));
      } catch {
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const updateMemory = (patch: Partial<MemoryBehaviorSettingsState>) => {
    setMemory((current) => ({ ...current, ...patch }));
  };

  const updateRecall = (patch: Partial<MemoryRecallSettingsState>) => {
    setRecall((current) => ({ ...current, ...patch }));
  };

  const [customEmbeddingModel, setCustomEmbeddingModel] = useState(false);
  const embeddingModelSuggestions = memoryRecallModelSuggestions[recall.embeddingProvider] || [];
  const embeddingModelIsSuggested =
    recall.embeddingModel === "" || embeddingModelSuggestions.includes(recall.embeddingModel);
  const showCustomEmbeddingModelInput =
    recall.embeddingProvider !== "local" &&
    (embeddingModelSuggestions.length === 0 || customEmbeddingModel || !embeddingModelIsSuggested);

  const updateProvider = (patch: Partial<MemoryProviderSettingsState>) => {
    setProviderTest(null);
    setProvider((current) => ({ ...current, ...patch }));
  };

  const updateProviderField = (
    providerId: ExternalMemoryProviderChoice,
    key: string,
    value: string
  ) => {
    setProviderTest(null);
    setProvider((current) => ({
      ...current,
      [providerId]: { ...current[providerId], [key]: value },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ memory, memory_provider: provider });
      if (!result.success || result.data?.success === false) {
        throw new Error(result.error || "Memory settings were not saved");
      }
      addToast("success", "Memory settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save memory settings");
    } finally {
      setSaving(false);
    }
  };

  const saveRecall = async () => {
    setSavingRecall(true);
    try {
      const result = await settingsApi.updateConfig({
        workspace_indexer: memoryRecallConfigPayload(recall),
      });
      if (!result.success || result.data?.success === false) {
        throw new Error(result.error || "Indexing settings were not saved");
      }
      addToast("success", "Indexing settings saved");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to save indexing settings"
      );
    } finally {
      setSavingRecall(false);
    }
  };

  const testProvider = async () => {
    setTestingProvider(true);
    setProviderTest(null);
    try {
      const result = await memoryApi.testProvider(provider.provider, provider);
      if (result.data) {
        setProviderTest({ ok: result.data.ok, detail: result.data.detail });
      } else {
        setProviderTest({ ok: false, detail: result.error || "Connection test failed" });
      }
    } catch (error) {
      setProviderTest({
        ok: false,
        detail: error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setTestingProvider(false);
    }
  };

  const activeExternalProvider =
    provider.provider === "local" ? null : (provider.provider as ExternalMemoryProviderChoice);

  return (
    <div className="space-y-6">
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-400" />
            Memory
          </CardTitle>
          <CardDescription>
            Controls how agents learn durable facts, when long chats flush memory before compaction,
            and which memory provider stores long-term memories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Learning loop</h3>
                <p className="text-xs text-gray-400 mt-1">
                  After substantial responses, Cybara can run a silent reviewer that saves durable
                  preferences, corrections, and project facts.
                </p>
              </div>
              <Switch
                label="Background memory review"
                checked={memory.backgroundReviewEnabled}
                disabled={loading || saving}
                onChange={(checked) => updateMemory({ backgroundReviewEnabled: checked })}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Minimum interval (minutes)"
                  min={1}
                  max={1440}
                  type="number"
                  value={Math.round(memory.backgroundReviewMinIntervalMs / 60000)}
                  disabled={loading || saving}
                  onChange={(event) =>
                    updateMemory({
                      backgroundReviewMinIntervalMs:
                        Math.max(1, Number(event.target.value) || 5) * 60000,
                    })
                  }
                />
                <Input
                  label="Timeout (seconds)"
                  min={10}
                  max={600}
                  type="number"
                  value={memory.backgroundReviewTimeoutSeconds}
                  disabled={loading || saving}
                  onChange={(event) =>
                    updateMemory({
                      backgroundReviewTimeoutSeconds: Math.max(
                        10,
                        Number(event.target.value) || 90
                      ),
                    })
                  }
                />
              </div>
            </div>

            <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Pre-compaction flush</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Before a long chat compacts, the agent gets one chance to save durable memory so
                  important details are not lost.
                </p>
              </div>
              <Switch
                label="Flush before compaction"
                checked={memory.memoryFlushEnabled}
                disabled={loading || saving}
                onChange={(checked) => updateMemory({ memoryFlushEnabled: checked })}
              />
              <Input
                label="Soft threshold reserve (tokens)"
                min={500}
                max={200000}
                type="number"
                value={memory.memoryFlushSoftThresholdTokens}
                disabled={loading || saving}
                onChange={(event) =>
                  updateMemory({
                    memoryFlushSoftThresholdTokens: Math.max(
                      500,
                      Number(event.target.value) || 4000
                    ),
                  })
                }
              />
            </div>
          </div>

          <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-200">
              Advanced memory prompts
            </summary>
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Textarea
                label="Flush prompt"
                value={memory.memoryFlushPrompt}
                disabled={loading || saving}
                rows={5}
                onChange={(event) => updateMemory({ memoryFlushPrompt: event.target.value })}
              />
              <Textarea
                label="Flush system prompt"
                value={memory.memoryFlushSystemPrompt}
                disabled={loading || saving}
                rows={5}
                onChange={(event) => updateMemory({ memoryFlushSystemPrompt: event.target.value })}
              />
            </div>
          </details>

          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Memory provider</h3>
              <p className="text-xs text-gray-400 mt-1">
                Built-in local memory (MEMORY.md + daily files) always runs. Selecting an external
                provider mirrors durable memories to it and blends its recall into agent context.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Provider"
                options={memoryProviderOptions}
                value={provider.provider}
                disabled={loading || saving}
                onChange={(value) => updateProvider({ provider: value as MemoryProviderChoice })}
              />
              {activeExternalProvider ? (
                <div className="flex items-end pb-1">
                  <button
                    type="button"
                    className="text-xs text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                    onClick={() => void openExternal(memoryProviderDocs[activeExternalProvider])}
                  >
                    {memoryProviderDocs[activeExternalProvider]}
                  </button>
                </div>
              ) : null}
            </div>
            {activeExternalProvider ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {memoryProviderFieldSpecs[activeExternalProvider].map((field) => (
                    <Input
                      key={`${activeExternalProvider}-${field.key}`}
                      label={`${field.label}${field.required ? " *" : ""}`}
                      type={field.secret ? "password" : "text"}
                      placeholder={field.placeholder || ""}
                      value={provider[activeExternalProvider][field.key] ?? ""}
                      disabled={loading || saving}
                      onChange={(event) =>
                        updateProviderField(activeExternalProvider, field.key, event.target.value)
                      }
                    />
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Switch
                    label="Auto recall"
                    description="Blend provider memories into agent context"
                    checked={provider.autoRecall}
                    disabled={loading || saving}
                    onChange={(checked) => updateProvider({ autoRecall: checked })}
                  />
                  <Switch
                    label="Auto capture"
                    description="Mirror new durable memories to the provider"
                    checked={provider.autoCapture}
                    disabled={loading || saving}
                    onChange={(checked) => updateProvider({ autoCapture: checked })}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    leftIcon={
                      testingProvider ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Activity className="w-4 h-4" />
                      )
                    }
                    onClick={() => void testProvider()}
                    disabled={loading || saving || testingProvider}
                  >
                    Test Connection
                  </Button>
                  {providerTest ? (
                    <span
                      className={`text-xs ${providerTest.ok ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {providerTest.ok ? "Connected" : "Failed"} — {providerTest.detail}
                    </span>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button
              leftIcon={
                saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )
              }
              onClick={() => void save()}
              disabled={loading || saving}
            >
              Save Memory Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            Indexing
          </CardTitle>
          <CardDescription>
            The embedding index that powers semantic search over memory, sessions, and workspace
            files. Separate from memory itself — memories persist even with indexing off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Switch
              label="Build search index"
              description="Index memories, sessions, and workspace files for faster search"
              checked={recall.enabled}
              disabled={loading || savingRecall}
              onChange={(checked) => updateRecall({ enabled: checked })}
            />
            <Switch
              label="Embedding search"
              description="Use embeddings for similarity search"
              checked={recall.semanticEnabled}
              disabled={loading || savingRecall}
              onChange={(checked) => updateRecall({ semanticEnabled: checked })}
            />
            <Switch
              label="Include hidden files"
              checked={recall.includeHidden}
              disabled={loading || savingRecall}
              onChange={(checked) => updateRecall({ includeHidden: checked })}
            />
            <Switch
              label="Auto reindex on workspace change"
              checked={recall.autoReindexOnWorkspaceSet}
              disabled={loading || savingRecall}
              onChange={(checked) => updateRecall({ autoReindexOnWorkspaceSet: checked })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <Select
              label="Embedding provider"
              options={memoryRecallProviderOptions}
              value={recall.embeddingProvider}
              disabled={loading || savingRecall}
              onChange={(value) => {
                setCustomEmbeddingModel(false);
                updateRecall({
                  embeddingProvider: value as MemoryRecallProvider,
                  embeddingModel: "",
                });
              }}
            />
            {recall.embeddingProvider !== "local" && embeddingModelSuggestions.length > 0 && (
              <Select
                label="Model"
                options={[
                  { value: "", label: "Default" },
                  ...embeddingModelSuggestions.map((model) => ({ value: model, label: model })),
                  { value: CUSTOM_MODEL_OPTION, label: "Custom model…" },
                ]}
                value={
                  customEmbeddingModel || !embeddingModelIsSuggested
                    ? CUSTOM_MODEL_OPTION
                    : recall.embeddingModel
                }
                disabled={loading || savingRecall}
                onChange={(value) => {
                  if (value === CUSTOM_MODEL_OPTION) {
                    setCustomEmbeddingModel(true);
                    return;
                  }
                  setCustomEmbeddingModel(false);
                  updateRecall({ embeddingModel: value });
                }}
              />
            )}
            {showCustomEmbeddingModelInput && (
              <Input
                label={embeddingModelSuggestions.length > 0 ? "Custom model" : "Model override"}
                placeholder="Auto"
                value={recall.embeddingModel}
                disabled={loading || savingRecall}
                onChange={(event) => updateRecall({ embeddingModel: event.target.value })}
              />
            )}
            <Input
              label="Max files"
              type="number"
              min={100}
              value={recall.maxFiles}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  maxFiles: readIntegerSetting(
                    event.target.value,
                    defaultMemoryRecallSettings.maxFiles,
                    100,
                    1_000_000
                  ),
                })
              }
            />
            <Input
              label="Max file size (MB)"
              type="number"
              min={0.01}
              max={100}
              step={0.1}
              value={recall.maxFileSizeMb}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  maxFileSizeMb: readNumberSetting(
                    event.target.value,
                    defaultMemoryRecallSettings.maxFileSizeMb,
                    0.01,
                    100
                  ),
                })
              }
            />
            <Input
              label="Semantic files"
              type="number"
              min={100}
              max={50000}
              value={recall.semanticMaxFiles}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  semanticMaxFiles: readIntegerSetting(
                    event.target.value,
                    defaultMemoryRecallSettings.semanticMaxFiles,
                    100,
                    50_000
                  ),
                })
              }
            />
            <Input
              label="Semantic min score"
              type="number"
              min={0.05}
              max={0.99}
              step={0.05}
              value={recall.semanticMinScore}
              disabled={loading || savingRecall}
              onChange={(event) =>
                updateRecall({
                  semanticMinScore: Number(
                    readNumberSetting(
                      event.target.value,
                      defaultMemoryRecallSettings.semanticMinScore,
                      0.05,
                      0.99
                    ).toFixed(2)
                  ),
                })
              }
            />
          </div>
          <div className="flex justify-end">
            <Button
              leftIcon={
                savingRecall ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )
              }
              onClick={() => void saveRecall()}
              disabled={loading || savingRecall}
            >
              Save Indexing Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
