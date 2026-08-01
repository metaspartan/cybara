import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import {
  Database,
  Eye,
  Folder,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react-native";
import { colors } from "../theme/liquidGlass";
import { MOBILE_SYSTEM_PROMPT_FEATURE_KEYS } from "../lib/dashboard";
import { styles } from "./dashboardStyles";
import { EmptyState, LoadingState } from "./dashboardPrimitives";
import {
  DetailActionButton,
  DetailInfoSection,
  SettingSelector,
  SettingToggle,
  StableDetailPanel,
  SettingsSection,
  SettingsTextField,
} from "./dashboardControls";
import {
  endpointErrorDetail,
  readMobileIndexingSettings,
  readMobileLlmTimeoutSettings,
  readMobileMemoryBehaviorSettings,
  readMobileMemoryProviderSettings,
  readMobileTokenOptimizationSettings,
  MOBILE_MEMORY_PROVIDER_CHOICES,
  type MobileIndexingSettings,
  type MobileLlmTimeoutSettings,
  type MobileMemoryBehaviorSettings,
  type MobileMemoryProviderChoice,
  type MobileMemoryProviderSettings,
  type MobileTokenOptimizationSettings,
} from "./dashboardHelpers";
import {
  CybaraMobileApi,
  type FeatureSummary,
  type MigrationPreset,
  type MigrationSkillConflictMode,
  type MigrationSourceCandidate,
  type MigrationSourceKind,
  type SourceMigrationReport,
  type SourceMigrationRequest,
  type SystemPromptFeatureKey,
} from "../lib/api";
import { gatewayActionError } from "./dashboardActionError";

const systemPromptFeatureCopy: Record<SystemPromptFeatureKey, { label: string; detail: string }> = {
  memoryEnabled: {
    label: "Memory recall",
    detail: "Include durable memory context in agent prompts.",
  },
  skillsEnabled: {
    label: "Skills",
    detail: "Expose installed skills in the agent prompt.",
  },
  messagingEnabled: {
    label: "Messaging",
    detail: "Let agents use configured messaging surfaces.",
  },
  replyTagsEnabled: {
    label: "Reply tags",
    detail: "Include structured reply tags for channel responses.",
  },
};

const systemPromptFeatureRows = MOBILE_SYSTEM_PROMPT_FEATURE_KEYS.map((key) => ({
  key,
  ...systemPromptFeatureCopy[key],
}));

const migrationSummaryKeys = [
  "total",
  "planned",
  "migrated",
  "conflict",
  "skipped",
  "error",
] as const;

function migrationStatusColor(status: string): string {
  if (status === "migrated") return colors.green;
  if (status === "planned") return colors.cyan;
  if (status === "conflict") return colors.amber;
  if (status === "error") return colors.red;
  return colors.textMuted;
}

function migrationSourceDetail(source: MigrationSourceCandidate): string {
  return `${source.detected.memoryFiles} memories - ${source.detected.skillCount} skills - ${source.detected.sessionCount} chats - ${source.detected.configFiles} configs`;
}

export function MigrationSettingsPanel({
  accentColor,
  api,
}: {
  accentColor: string;
  api: CybaraMobileApi;
}) {
  const [sources, setSources] = useState<MigrationSourceCandidate[]>([]);
  const [sourceKind, setSourceKind] = useState<MigrationSourceKind>("openclaw");
  const [sourcePath, setSourcePath] = useState("");
  const [preset, setPreset] = useState<MigrationPreset>("user-data");
  const [skillConflict, setSkillConflict] = useState<MigrationSkillConflictMode>("skip");
  const [workspaceTarget, setWorkspaceTarget] = useState("");
  const [migrateSecrets, setMigrateSecrets] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<"preview" | "run" | null>(null);
  const [report, setReport] = useState<SourceMigrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourcePathRef = useRef("");
  const updateSourcePath = useCallback((value: string) => {
    sourcePathRef.current = value;
    setSourcePath(value);
  }, []);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.migrationSources();
      setSources(response.sources);
      const detected = response.sources.find((source) => source.exists);
      if (detected && !sourcePathRef.current.trim()) {
        setSourceKind(detected.kind);
        updateSourcePath(detected.path);
      }
    } catch (loadError) {
      setError(gatewayActionError(loadError, "Could not detect legacy agent sources."));
    } finally {
      setLoading(false);
    }
  }, [api, updateSourcePath]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const payload = (): SourceMigrationRequest => ({
    sourceKind,
    sourcePath: sourcePath.trim() || undefined,
    preset,
    migrateSecrets,
    overwrite,
    skillConflict,
    workspaceTarget: workspaceTarget.trim() || undefined,
  });

  const previewMigration = async () => {
    if (runningAction) return;
    setRunningAction("preview");
    setError(null);
    try {
      setReport(await api.previewMigration(payload()));
    } catch (previewError) {
      setError(gatewayActionError(previewError, "Migration preview failed."));
    } finally {
      setRunningAction(null);
    }
  };

  const runMigration = async () => {
    if (runningAction) return;
    setRunningAction("run");
    setError(null);
    try {
      setReport(await api.runMigration(payload()));
    } catch (runError) {
      setError(gatewayActionError(runError, "Migration failed."));
    } finally {
      setRunningAction(null);
    }
  };

  const confirmMigration = () => {
    Alert.alert(
      "Run migration?",
      "Preview first if you want to see exactly what will be imported before writing files.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Run",
          onPress: () => {
            void runMigration();
          },
        },
      ]
    );
  };

  const detectedSources = sources.filter((source) => source.exists);

  return (
    <>
      <SettingsSection title="Migration">
        <View style={styles.settingsGroupHeader}>
          <Folder color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Import legacy agent data</Text>
        </View>
        <Text style={styles.settingsInfoText}>
          Preview chats, settings, memories, skills, workspace instructions, and optional provider
          keys before anything is written on the gateway.
        </Text>
        {loading ? (
          <LoadingState label="Detecting sources" detail="Checking common gateway host paths." />
        ) : detectedSources.length > 0 ? (
          detectedSources.map((source) => {
            const selected = sourcePath === source.path;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={`${source.kind}-${source.path}`}
                onPress={() => {
                  setSourceKind(source.kind);
                  updateSourcePath(source.path);
                }}
                style={[
                  styles.settingsInfoBox,
                  selected && { borderColor: accentColor, backgroundColor: `${accentColor}12` },
                ]}
              >
                <View style={styles.settingsInfoHeader}>
                  <Folder color={selected ? accentColor : colors.textMuted} size={18} />
                  <Text style={styles.settingsInfoTitle}>{source.label}</Text>
                </View>
                <Text numberOfLines={1} style={styles.settingsFieldHelp}>
                  {source.path}
                </Text>
                <Text style={styles.settingsInfoText}>{migrationSourceDetail(source)}</Text>
              </Pressable>
            );
          })
        ) : (
          <EmptyState
            label="No local sources found"
            detail="Paste the legacy agent directory from the gateway host below."
          />
        )}
        <SettingSelector
          disabled={runningAction !== null}
          label="Source"
          onSelect={(value) => setSourceKind(value as MigrationSourceKind)}
          options={[
            { label: "OpenClaw", value: "openclaw" },
            { label: "Hermes", value: "hermes" },
            { label: "Codex", value: "codex" },
            { label: "Claude Code", value: "claude-code" },
            { label: "OpenCode", value: "opencode" },
          ]}
          selected={sourceKind}
          tone={accentColor}
          variant="menu"
        />
        <SettingsTextField
          label="Source directory"
          onChangeText={updateSourcePath}
          placeholder="Path on the gateway host"
          value={sourcePath}
        />
        <SettingSelector
          disabled={runningAction !== null}
          label="Preset"
          onSelect={(value) => setPreset(value as MigrationPreset)}
          options={[
            { label: "User Data", value: "user-data" },
            { label: "Full", value: "full" },
          ]}
          selected={preset}
          tone={accentColor}
          variant="segmented"
        />
        <SettingSelector
          disabled={runningAction !== null}
          label="Skill conflicts"
          onSelect={(value) => setSkillConflict(value as MigrationSkillConflictMode)}
          options={[
            { label: "Skip", value: "skip" },
            { label: "Rename", value: "rename" },
            { label: "Overwrite", value: "overwrite" },
          ]}
          selected={skillConflict}
          tone={accentColor}
          variant="menu"
        />
        <SettingsTextField
          label="Workspace target"
          onChangeText={setWorkspaceTarget}
          placeholder="Optional project folder for AGENTS.md"
          value={workspaceTarget}
        />
        <SettingToggle
          busy={runningAction !== null}
          detail="Off by default. Reports never expose key values."
          disabled={runningAction !== null}
          label="Import provider keys"
          onPress={() => setMigrateSecrets((value) => !value)}
          tone={colors.amber}
          value={migrateSecrets}
        />
        <SettingToggle
          busy={runningAction !== null}
          detail="Allows existing prompts, providers, and workspace files to be replaced."
          disabled={runningAction !== null}
          label="Allow overwrite"
          onPress={() => setOverwrite((value) => !value)}
          tone={colors.amber}
          value={overwrite}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.settingsActionRow}>
          <DetailActionButton
            Icon={RefreshCw}
            busy={loading}
            disabled={runningAction !== null}
            label="Refresh"
            onPress={() => {
              void loadSources();
            }}
            tone={accentColor}
          />
          <DetailActionButton
            Icon={Eye}
            busy={runningAction === "preview"}
            disabled={runningAction !== null}
            label="Preview"
            onPress={() => {
              void previewMigration();
            }}
            tone={colors.cyan}
          />
          <DetailActionButton
            Icon={Play}
            busy={runningAction === "run"}
            disabled={runningAction !== null}
            label="Run"
            onPress={confirmMigration}
            tone={colors.green}
          />
        </View>
      </SettingsSection>
      {report ? (
        <SettingsSection title={report.dryRun ? "Preview Report" : "Migration Report"}>
          <DetailInfoSection
            fields={migrationSummaryKeys.map((key) => ({
              label: key,
              value: String(report.summary[key] ?? 0),
            }))}
          />
          {report.warnings.length > 0 ? (
            <View style={styles.settingsInfoBox}>
              <View style={styles.settingsInfoHeader}>
                <ShieldAlert color={colors.amber} size={18} strokeWidth={2.1} />
                <Text style={styles.settingsInfoTitle}>Warnings</Text>
              </View>
              <Text style={styles.settingsInfoText}>{report.warnings.join(" ")}</Text>
            </View>
          ) : null}
          <View style={styles.settingsInfoBox}>
            <Text style={styles.settingsFieldHelp}>
              {report.sourceKind} to {report.targetRoot}
            </Text>
            {report.items.slice(0, 20).map((entry) => (
              <View key={entry.id} style={styles.infoRow}>
                <Text
                  numberOfLines={1}
                  style={[styles.infoLabel, { color: migrationStatusColor(entry.status) }]}
                >
                  {entry.status}
                </Text>
                <View style={styles.listText}>
                  <Text numberOfLines={1} style={styles.listTitle}>
                    {entry.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.listDetail}>
                    {[entry.category, entry.detail].filter(Boolean).join(" - ")}
                  </Text>
                </View>
              </View>
            ))}
            {report.items.length > 20 ? (
              <Text style={styles.settingsFieldHelp}>
                Showing 20 of {report.items.length} migration items.
              </Text>
            ) : null}
            {report.reportPath ? (
              <Text selectable style={styles.settingsFieldHelp}>
                Report saved to {report.reportPath}
              </Text>
            ) : null}
          </View>
        </SettingsSection>
      ) : null}
    </>
  );
}

const mobileMemoryProviderLabels: Record<MobileMemoryProviderChoice, string> = {
  local: "Built-in (local)",
  supermemory: "Supermemory",
  mem0: "Mem0",
  honcho: "Honcho",
  openviking: "OpenViking",
  hindsight: "Hindsight",
};

const mobileMemoryProviderFieldSpecs: Record<
  Exclude<MobileMemoryProviderChoice, "local">,
  Array<{ key: string; label: string; secret?: boolean; placeholder?: string }>
> = {
  supermemory: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.supermemory.ai" },
    { key: "containerTag", label: "Container tag", placeholder: "cybara" },
  ],
  mem0: [
    { key: "apiKey", label: "API key", secret: true },
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
    { key: "baseUrl", label: "Server URL", placeholder: "http://127.0.0.1:1933" },
    { key: "apiKey", label: "API key", secret: true },
  ],
  hindsight: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.hindsight.vectorize.io" },
    { key: "tenant", label: "Tenant", placeholder: "default" },
    { key: "bankId", label: "Memory bank", placeholder: "cybara" },
  ],
};

export function MemorySettingsPanel({
  accentColor,
  api,
  summary,
  refreshSummary,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  summary: FeatureSummary | null;
  refreshSummary: () => void;
}) {
  const configAvailable = summary?.availability.config.ok === true;
  const memorySettings = readMobileMemoryBehaviorSettings(summary?.config);
  const providerSettings = readMobileMemoryProviderSettings(summary?.config);
  const indexingSettings = readMobileIndexingSettings(summary?.config);
  const tokenOptimizationSettings = readMobileTokenOptimizationSettings(summary?.config);
  const [memoryDraft, setMemoryDraft] = useState(memorySettings);
  const [timeoutsDraft, setTimeoutsDraft] = useState(() =>
    readMobileLlmTimeoutSettings(summary?.config)
  );
  const [tokenOptimizationDraft, setTokenOptimizationDraft] =
    useState<MobileTokenOptimizationSettings>(tokenOptimizationSettings);
  const [providerDraft, setProviderDraft] = useState(providerSettings);
  const [indexingDraft, setIndexingDraft] = useState(indexingSettings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const configSignature = JSON.stringify(summary?.config ?? null);

  useEffect(() => {
    setMemoryDraft(memorySettings);
    setProviderDraft(providerSettings);
    setIndexingDraft(indexingSettings);
    setTokenOptimizationDraft(tokenOptimizationSettings);
    setTimeoutsDraft(readMobileLlmTimeoutSettings(summary?.config));
  }, [configSignature, configAvailable]);

  const persist = async (payload: Record<string, unknown>, failureTitle: string) => {
    if (!configAvailable || saving) return;
    setSaving(true);
    try {
      const result = await api.updateConfig(payload);
      if (result.success === false) throw new Error("The gateway rejected the update.");
      await refreshSummary();
    } catch (error) {
      Alert.alert(failureTitle, error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const saveMemory = (patch: Partial<MobileMemoryBehaviorSettings>) => {
    const next = { ...memoryDraft, ...patch };
    setMemoryDraft(next);
    void persist({ memory: next }, "Memory setting failed");
  };

  const saveTimeouts = (patch: Partial<MobileLlmTimeoutSettings>) => {
    const next = { ...timeoutsDraft, ...patch };
    setTimeoutsDraft(next);
    void persist({ llm_timeouts: next }, "Watchdog setting failed");
  };

  const saveTokenOptimization = (patch: Partial<MobileTokenOptimizationSettings>) => {
    const next = { ...tokenOptimizationDraft, ...patch };
    setTokenOptimizationDraft(next);
    void persist({ token_optimization: next }, "Token optimization setting failed");
  };

  const saveProvider = (patch: Partial<MobileMemoryProviderSettings>) => {
    const next = { ...providerDraft, ...patch };
    setProviderDraft(next);
    void persist({ memory_provider: next }, "Memory provider setting failed");
  };

  const saveIndexing = (patch: Partial<MobileIndexingSettings>) => {
    const next = { ...indexingDraft, ...patch };
    setIndexingDraft(next);
    void persist({ workspace_indexer: next }, "Indexing setting failed");
  };

  const testProvider = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const result = await api.testMemoryProvider(providerDraft.provider, providerDraft);
      Alert.alert(
        result.ok ? "Connection OK" : "Connection failed",
        result.detail || (result.ok ? "The provider responded." : "The provider did not respond.")
      );
    } catch (error) {
      Alert.alert("Connection failed", error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  if (!configAvailable) {
    return (
      <SettingsSection title="Memory">
        {!summary ? (
          <LoadingState
            label="Loading memory settings"
            detail="Fetching config from the gateway."
          />
        ) : (
          <EmptyState
            label="Memory settings unavailable"
            detail={endpointErrorDetail(
              summary?.availability.config,
              "The gateway did not return editable memory settings."
            )}
          />
        )}
      </SettingsSection>
    );
  }

  const externalProvider = providerDraft.provider === "local" ? null : providerDraft.provider;

  return (
    <>
      <SettingsSection title="Memory">
        <View style={styles.settingsGroupHeader}>
          <Sparkles color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Learning & flush</Text>
        </View>
        <SettingToggle
          busy={saving}
          detail="After substantial responses, a silent reviewer saves durable preferences and facts."
          label="Background memory review"
          onPress={() =>
            saveMemory({ backgroundReviewEnabled: !memoryDraft.backgroundReviewEnabled })
          }
          tone={accentColor}
          value={memoryDraft.backgroundReviewEnabled}
        />
        <SettingToggle
          busy={saving}
          detail="Before a long chat compacts, the agent gets one chance to save durable memory."
          label="Flush before compaction"
          onPress={() => saveMemory({ memoryFlushEnabled: !memoryDraft.memoryFlushEnabled })}
          tone={accentColor}
          value={memoryDraft.memoryFlushEnabled}
        />
        <SettingsTextField
          help="Soft reserve before compaction triggers the flush turn."
          label="Flush threshold (tokens)"
          onBlur={() => {
            const parsed = Number.parseInt(String(memoryDraft.memoryFlushSoftThresholdTokens), 10);
            saveMemory({
              memoryFlushSoftThresholdTokens:
                Number.isFinite(parsed) && parsed >= 500 ? parsed : 4000,
            });
          }}
          onChangeText={(value) =>
            setMemoryDraft((current) => ({
              ...current,
              memoryFlushSoftThresholdTokens: Number.parseInt(value, 10) || 0,
            }))
          }
          placeholder="4000"
          value={String(memoryDraft.memoryFlushSoftThresholdTokens || "")}
        />
      </SettingsSection>
      <SettingsSection title="Agent watchdogs">
        <Text style={styles.settingsInfoText}>
          Timeouts fire on provider silence, never on how long the agent works. Local model
          endpoints auto-relax these limits.
        </Text>
        <SettingsTextField
          help="Max wait for any output at all (seconds)."
          label="First token timeout"
          onBlur={() => saveTimeouts({})}
          onChangeText={(value) =>
            setTimeoutsDraft((current) => ({
              ...current,
              firstTokenSeconds: Number.parseInt(value, 10) || current.firstTokenSeconds,
            }))
          }
          placeholder="300"
          value={String(timeoutsDraft.firstTokenSeconds || "")}
        />
        <SettingsTextField
          help="Max silent gap mid-stream (seconds, 0 disables)."
          label="Stall timeout"
          onBlur={() => saveTimeouts({})}
          onChangeText={(value) =>
            setTimeoutsDraft((current) => ({
              ...current,
              stallSeconds: Number.parseInt(value, 10) || 0,
            }))
          }
          placeholder="300"
          value={String(timeoutsDraft.stallSeconds ?? "")}
        />
        <SettingsTextField
          help="Absolute cap per LLM call (seconds, 0 = unlimited)."
          label="Total cap"
          onBlur={() => saveTimeouts({})}
          onChangeText={(value) =>
            setTimeoutsDraft((current) => ({
              ...current,
              totalSeconds: Number.parseInt(value, 10) || 0,
            }))
          }
          placeholder="0"
          value={String(timeoutsDraft.totalSeconds ?? "")}
        />
        <SettingsTextField
          help="Ceiling for providers that cannot stream (seconds)."
          label="Non-streaming ceiling"
          onBlur={() => saveTimeouts({})}
          onChangeText={(value) =>
            setTimeoutsDraft((current) => ({
              ...current,
              nonStreamingSeconds: Number.parseInt(value, 10) || current.nonStreamingSeconds,
            }))
          }
          placeholder="1800"
          value={String(timeoutsDraft.nonStreamingSeconds || "")}
        />
      </SettingsSection>
      <SettingsSection title="Token optimization">
        <SettingToggle
          busy={saving}
          detail="Use TOON for structured tool outputs when it is smaller than compact JSON."
          label="Compact structured results"
          onPress={() =>
            saveTokenOptimization({
              toonStructuredDataEnabled: !tokenOptimizationDraft.toonStructuredDataEnabled,
            })
          }
          tone={accentColor}
          value={tokenOptimizationDraft.toonStructuredDataEnabled}
        />
      </SettingsSection>
      <SettingsSection title="Self-improvement">
        <SettingSelector
          disabled={saving}
          label="Background model"
          onSelect={(value) =>
            void persist({ background_agent_id: value }, "Background model failed")
          }
          options={[
            { label: "Same agent as the turn (default)", value: "" },
            ...(summary?.agents ?? []).map((agent) => ({
              label: agent.model ? `${agent.name} — ${agent.model}` : agent.name,
              value: agent.id,
            })),
          ]}
          selected={
            typeof summary?.config?.background_agent_id === "string"
              ? summary.config.background_agent_id
              : ""
          }
          tone={accentColor}
          variant="menu"
        />
        <Text style={styles.settingsFieldHelp}>
          Memory and skill review run silently after most turns. Point them at a cheaper agent to
          cut cost over time.
        </Text>
      </SettingsSection>
      <SettingsSection title="Memory provider">
        <SettingSelector
          disabled={saving}
          label="Provider"
          onSelect={(value) => {
            const provider = MOBILE_MEMORY_PROVIDER_CHOICES.includes(
              value as MobileMemoryProviderChoice
            )
              ? (value as MobileMemoryProviderChoice)
              : "local";
            saveProvider({ provider });
          }}
          options={MOBILE_MEMORY_PROVIDER_CHOICES.map((choice) => ({
            label: mobileMemoryProviderLabels[choice],
            value: choice,
          }))}
          selected={providerDraft.provider}
          tone={accentColor}
          variant="menu"
        />
        {externalProvider ? (
          <>
            {mobileMemoryProviderFieldSpecs[externalProvider].map((field) => (
              <SettingsTextField
                key={`${externalProvider}-${field.key}`}
                label={field.label}
                onBlur={() => saveProvider({})}
                onChangeText={(value) =>
                  setProviderDraft((current) => ({
                    ...current,
                    [externalProvider]: { ...current[externalProvider], [field.key]: value },
                  }))
                }
                placeholder={field.placeholder}
                secureTextEntry={field.secret}
                value={providerDraft[externalProvider][field.key] ?? ""}
              />
            ))}
            <SettingToggle
              busy={saving}
              detail="Blend provider memories into agent context."
              label="Auto recall"
              onPress={() => saveProvider({ autoRecall: !providerDraft.autoRecall })}
              tone={accentColor}
              value={providerDraft.autoRecall}
            />
            <SettingToggle
              busy={saving}
              detail="Mirror new durable memories to the provider."
              label="Auto capture"
              onPress={() => saveProvider({ autoCapture: !providerDraft.autoCapture })}
              tone={accentColor}
              value={providerDraft.autoCapture}
            />
            <DetailActionButton
              Icon={Zap}
              busy={testing}
              label="Test connection"
              onPress={() => void testProvider()}
              tone={accentColor}
            />
          </>
        ) : (
          <Text style={styles.settingsFieldHelp}>
            Built-in local memory (MEMORY.md + daily files) always runs. Select an external provider
            to mirror durable memories and blend its recall.
          </Text>
        )}
      </SettingsSection>
      <SettingsSection title="Indexing">
        <View style={styles.settingsGroupHeader}>
          <Database color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Semantic index</Text>
        </View>
        <SettingToggle
          busy={saving}
          detail="Index memories, sessions, and workspace files for faster search. Separate from memory itself."
          label="Build search index"
          onPress={() => saveIndexing({ enabled: !indexingDraft.enabled })}
          tone={accentColor}
          value={indexingDraft.enabled}
        />
        <SettingToggle
          busy={saving}
          detail="Use embeddings for similarity search."
          label="Embedding search"
          onPress={() => saveIndexing({ semanticEnabled: !indexingDraft.semanticEnabled })}
          tone={accentColor}
          value={indexingDraft.semanticEnabled}
        />
        <SettingToggle
          busy={saving}
          label="Include hidden files"
          onPress={() => saveIndexing({ includeHidden: !indexingDraft.includeHidden })}
          tone={accentColor}
          value={indexingDraft.includeHidden}
        />
        <SettingToggle
          busy={saving}
          label="Auto reindex on workspace change"
          onPress={() =>
            saveIndexing({ autoReindexOnWorkspaceSet: !indexingDraft.autoReindexOnWorkspaceSet })
          }
          tone={accentColor}
          value={indexingDraft.autoReindexOnWorkspaceSet}
        />
        <SettingSelector
          disabled={saving}
          label="Embedding provider"
          onSelect={(value) => {
            const provider = [
              "auto",
              "local",
              "transformers_js",
              "openai",
              "voyage",
              "gemini",
              "ollama",
            ].includes(value)
              ? (value as MobileIndexingSettings["embeddingProvider"])
              : "auto";
            saveIndexing({ embeddingProvider: provider });
          }}
          options={[
            { label: "Auto (best available)", value: "auto" },
            { label: "Local database (keyword only)", value: "local" },
            { label: "Local Transformers.js", value: "transformers_js" },
            { label: "Ollama (local)", value: "ollama" },
            { label: "OpenAI", value: "openai" },
            { label: "Voyage AI", value: "voyage" },
            { label: "Gemini", value: "gemini" },
          ]}
          selected={indexingDraft.embeddingProvider}
          tone={accentColor}
          variant="menu"
        />
        <SettingsTextField
          label="Model override"
          onBlur={() => saveIndexing({})}
          onChangeText={(embeddingModel) =>
            setIndexingDraft((current) => ({ ...current, embeddingModel }))
          }
          placeholder="Auto"
          value={indexingDraft.embeddingModel}
        />
      </SettingsSection>
    </>
  );
}

export function SystemPromptPanel({
  api,
  summary,
  accentColor,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  summary: FeatureSummary | null;
  accentColor: string;
  refreshSummary: () => void;
}) {
  const [savingPromptKey, setSavingPromptKey] = useState<SystemPromptFeatureKey | null>(null);
  const [identityDraft, setIdentityDraft] = useState({
    name: "",
    emoji: "",
    creature: "",
    vibe: "",
  });
  const [customPromptDraft, setCustomPromptDraft] = useState("");
  const [savingSystemPrompt, setSavingSystemPrompt] = useState(false);

  const available = summary?.availability.systemPrompt.ok === true && Boolean(summary.systemPrompt);
  const syncKey = summary?.systemPrompt
    ? `${JSON.stringify(summary.systemPrompt.identity)}|${summary.systemPrompt.customPrompt}`
    : "";

  useEffect(() => {
    const sp = summary?.systemPrompt;
    if (!sp) return;
    setIdentityDraft({
      name: sp.identity?.name || "",
      emoji: sp.identity?.emoji || "",
      creature: sp.identity?.creature || "",
      vibe: sp.identity?.vibe || "",
    });
    setCustomPromptDraft(sp.customPrompt || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const saveSystemPromptConfig = async () => {
    const sp = summary?.systemPrompt;
    if (!sp || savingSystemPrompt) return;
    const nextIdentity = { ...sp.identity, ...identityDraft };
    const identityChanged =
      nextIdentity.name !== (sp.identity?.name || "") ||
      nextIdentity.emoji !== (sp.identity?.emoji || "") ||
      nextIdentity.creature !== (sp.identity?.creature || "") ||
      nextIdentity.vibe !== (sp.identity?.vibe || "");
    const promptChanged = customPromptDraft !== (sp.customPrompt || "");
    if (!identityChanged && !promptChanged) return;
    setSavingSystemPrompt(true);
    try {
      const result = await api.updateSystemPrompt({
        ...sp,
        identity: nextIdentity,
        customPrompt: customPromptDraft,
      });
      if (result.success === false) throw new Error("System prompt update failed");
      await refreshSummary();
    } catch (error) {
      Alert.alert("Identity update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSystemPrompt(false);
    }
  };

  const toggleSystemPromptFeature = async (key: SystemPromptFeatureKey) => {
    if (!summary?.systemPrompt || savingPromptKey) return;
    setSavingPromptKey(key);
    try {
      const nextFeatures = {
        ...summary.systemPrompt.features,
        [key]: summary.systemPrompt.features[key] !== true,
      };
      const result = await api.updateSystemPrompt({
        ...summary.systemPrompt,
        features: nextFeatures,
      });
      if (result.success === false) throw new Error("System prompt update failed");
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Prompt feature update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSavingPromptKey(null);
    }
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${accentColor}18` }]}>
          <Sparkles color={accentColor} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text style={styles.itemTitle}>System Prompt</Text>
          <Text style={styles.itemDetail}>Identity and instructions applied to every agent</Text>
        </View>
      </View>

      {available && summary?.systemPrompt ? (
        <>
          <Text style={styles.subsectionTitle}>Identity</Text>
          <View style={styles.settingsGroup}>
            <SettingsTextField
              autoCapitalize="words"
              help="Shown as “You are …” in the system prompt. Leave blank to default to Cybara."
              label="Name"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(name) => setIdentityDraft((prev) => ({ ...prev, name }))}
              onSubmitEditing={() => void saveSystemPromptConfig()}
              placeholder="Cybara"
              returnKeyType="done"
              value={identityDraft.name}
            />
            <SettingsTextField
              autoCapitalize="none"
              label="Emoji"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(emoji) => setIdentityDraft((prev) => ({ ...prev, emoji }))}
              placeholder="🐹"
              value={identityDraft.emoji}
            />
            <SettingsTextField
              autoCapitalize="none"
              label="Creature / role"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(creature) => setIdentityDraft((prev) => ({ ...prev, creature }))}
              placeholder="AI assistant"
              value={identityDraft.creature}
            />
            <SettingsTextField
              autoCapitalize="sentences"
              label="Vibe"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(vibe) => setIdentityDraft((prev) => ({ ...prev, vibe }))}
              placeholder="concise and friendly"
              value={identityDraft.vibe}
            />
            <SettingsTextField
              autoCapitalize="sentences"
              help="Appended to every agent's system prompt."
              label="Custom instructions"
              multiline
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={setCustomPromptDraft}
              placeholder="e.g. Always answer in metric units."
              value={customPromptDraft}
            />
          </View>

          <Text style={styles.subsectionTitle}>Behavior</Text>
          <View style={styles.settingsGroup}>
            {systemPromptFeatureRows.map((row) => (
              <SettingToggle
                busy={savingPromptKey === row.key}
                detail={row.detail}
                disabled={savingPromptKey !== null}
                key={row.key}
                label={row.label}
                onPress={() => {
                  void toggleSystemPromptFeature(row.key);
                }}
                tone={accentColor}
                value={summary.systemPrompt?.features[row.key] === true}
              />
            ))}
          </View>
        </>
      ) : !summary ? (
        <LoadingState label="Loading prompt settings" detail="Fetching system prompt settings." />
      ) : (
        <EmptyState
          label="Prompt settings unavailable"
          detail={endpointErrorDetail(
            summary?.availability.systemPrompt,
            "The gateway did not return system prompt settings."
          )}
        />
      )}
    </StableDetailPanel>
  );
}
