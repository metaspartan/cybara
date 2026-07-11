import {
  Brain,
  CalendarCheck,
  ChevronRight,
  Database,
  Folder,
  Network,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useHapticsControls } from "../haptics/HapticsContext";
import type {
  ActivitySummary,
  CybaraMobileApi,
  FeatureSummary,
  ProviderPlanStatusResponse,
  RemoteItemSummary,
} from "../lib/api";
import type { GatewayProfile } from "../lib/connection";
import {
  compactHost,
  formatMobileValue,
  formatUptime,
  MOBILE_ACCENT_KEYS,
  MOBILE_LOGS_CHROME,
  MOBILE_REASONING_EFFORT_OPTIONS,
  MOBILE_ROUTER_STRATEGY_OPTIONS,
  MOBILE_SETTINGS_DETAIL_CHROME,
  MOBILE_SETTINGS_ROOT_CHROME,
  MOBILE_SETTINGS_SURFACES,
  MOBILE_SETTINGS_TABS,
  type MobileSettingsTab,
  type MobileSurfaceKey,
  mobileGatewayAuthStatus,
  mobileThemeConfigPayload,
  readMobileAccent,
  readMobileDangerousToolPolicy,
  readMobileReasoningEffort,
  readMobileSandboxRuntime,
  readMobileToolApprovalMode,
  summarizeFeatureCounts,
} from "../lib/dashboard";
import { haptics } from "../lib/haptics";
import { type AccentKey, accentPalette, colors } from "../theme/liquidGlass";
import { useThemeControls } from "../theme/ThemeContext";
import {
  DetailInfoSection,
  SettingSelector,
  SettingsSection,
  SettingsTabRail,
  SettingToggle,
  StableDetailPanel,
} from "./dashboardControls";
import {
  absoluteTimestampLabel,
  booleanSetting,
  cleanSettingsFields,
  endpointErrorDetail,
  endpointStatusLabel,
  type MobileSpeechSettings,
  mobileSpeechProviderOptions,
  objectRecord,
  readMobileSpeechSettings,
} from "./dashboardHelpers";
import { EmptyState, GatewayDetailPill, LoadingState, SettingsRow } from "./dashboardPrimitives";
import { MobileWebPolicyPanel } from "./dashboardWebPolicyPanel";
import { MobileComputerUsePanel } from "./dashboardComputerUsePanel";
import {
  ApprovalSettingsPanel,
  ChannelSettingsPanel,
  GatewayManagementPanel,
  MemorySettingsPanel,
  MigrationSettingsPanel,
  ProviderSettingsPanel,
  SystemMonitorDetailPanel,
  SystemPromptPanel,
  TaskSettingsPanel,
  WalletPolicyPanel,
} from "./dashboardSettingsPanels";
import { AgentSettingsPanel } from "./dashboardAgentSettingsPanel";
import { JourneyPanel } from "./dashboardJourneyPanel";
import { ModelRouterPanel } from "./dashboardModelRouterPanel";
import { SpeechSettingsPanel } from "./dashboardSpeechSettingsPanel";
import { MobileMcpSettingsPanel } from "./dashboardMcpPanel";
import { styles } from "./dashboardStyles";
import {
  type DetailRoute,
  surfaceMenuDetail,
  surfaceMeta,
  surfaceRows,
} from "./dashboardSurfaceData";

export function TasksPanel({
  summary,
  accentColor,
  openTask,
  createTask,
}: {
  summary: FeatureSummary | null;
  accentColor: string;
  openTask: (item: RemoteItemSummary | ActivitySummary) => void;
  createTask: () => void;
}) {
  const rows = surfaceRows("tasks", summary);
  const endpoint = summary?.availability.tasks;
  const unavailable = endpoint?.ok === false;

  return (
    <>
      <View style={styles.tasksHeader}>
        <View style={styles.tasksHeaderText}>
          <Text style={styles.tasksTitle}>Scheduled tasks</Text>
          <Text style={styles.tasksSubtitle}>
            {rows.length > 0
              ? rows.length === 1
                ? "1 automation"
                : `${rows.length} automations`
              : "Run an agent on a schedule"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="New task"
          accessibilityRole="button"
          onPress={createTask}
          style={[styles.tasksNewButton, { borderColor: accentColor }]}
        >
          <Plus color={accentColor} size={18} strokeWidth={2.6} />
          <Text style={[styles.tasksNewText, { color: accentColor }]}>New</Text>
        </Pressable>
      </View>

      <StableDetailPanel>
        {!summary ? (
          <LoadingState label="Loading tasks" detail="Refreshing from the gateway." />
        ) : unavailable ? (
          <EmptyState
            label="Tasks unavailable"
            detail={endpointErrorDetail(endpoint, "The gateway did not return tasks.")}
          />
        ) : rows.length === 0 ? (
          <View style={styles.tasksEmpty}>
            <View
              style={[
                styles.listIcon,
                styles.tasksEmptyIcon,
                { backgroundColor: `${accentColor}18` },
              ]}
            >
              <CalendarCheck color={accentColor} size={22} strokeWidth={2.1} />
            </View>
            <Text style={styles.tasksEmptyTitle}>No tasks yet</Text>
            <Text style={styles.tasksEmptyDetail}>
              Schedule an agent to run automatically — reports, checks, or recurring jobs.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={createTask}
              style={[styles.tasksEmptyCta, { backgroundColor: accentColor }]}
            >
              <Plus color={colors.text} size={17} strokeWidth={2.5} />
              <Text style={styles.tasksEmptyCtaText}>Create your first task</Text>
            </Pressable>
          </View>
        ) : (
          rows.map((row) => (
            <Pressable key={row.id} style={styles.listRow} onPress={() => openTask(row)}>
              <View style={[styles.listIcon, { backgroundColor: `${accentColor}18` }]}>
                <CalendarCheck color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text numberOfLines={1} style={styles.listTitle}>
                  {row.title}
                </Text>
                <Text numberOfLines={1} style={styles.listDetail}>
                  {row.detail}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          ))
        )}
      </StableDetailPanel>
    </>
  );
}

function MemoryRecallCard({
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
  const [saving, setSaving] = useState(false);
  const configAvailable = summary?.availability.config.ok === true;
  const configRecord = (summary?.config ?? {}) as Record<string, unknown>;
  const workspaceIndexer = (configRecord.workspace_indexer ?? {}) as Record<string, unknown>;
  const memoryMethod =
    typeof workspaceIndexer.embeddingProvider === "string"
      ? (workspaceIndexer.embeddingProvider as string)
      : "auto";

  const save = async (value: string) => {
    if (!configAvailable || saving) return;
    setSaving(true);
    try {
      const result = await api.updateConfig({
        workspace_indexer: { ...workspaceIndexer, embeddingProvider: value },
      });
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Memory method setting failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <StableDetailPanel>
      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recall</Text>
      </View>
      {configAvailable ? (
        <SettingSelector
          disabled={saving}
          label="Recall method"
          onSelect={save}
          options={[
            { label: "Auto", value: "auto" },
            { label: "Local database (keyword only)", value: "local" },
            { label: "Local Transformers.js", value: "transformers_js" },
            { label: "Ollama (local)", value: "ollama" },
            { label: "OpenAI", value: "openai" },
            { label: "Voyage AI", value: "voyage" },
            { label: "Gemini", value: "gemini" },
          ]}
          selected={memoryMethod}
          tone={accentColor}
          variant="menu"
        />
      ) : !summary ? (
        <LoadingState label="Loading memory settings" detail="Fetching config from the gateway." />
      ) : (
        <EmptyState
          label="Memory settings unavailable"
          detail={endpointErrorDetail(
            summary?.availability.config,
            "The gateway did not return config settings."
          )}
        />
      )}
    </StableDetailPanel>
  );
}

export function SurfaceDetailPanel({
  api,
  accentColor,
  profile,
  summary,
  surface,
  openItem,
  loadMoreLogs,
  loadingMoreLogs,
  logPageError,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  accentColor: string;
  profile: GatewayProfile;
  summary: FeatureSummary | null;
  surface: MobileSurfaceKey;
  openItem: (item: RemoteItemSummary | ActivitySummary) => void;
  loadMoreLogs: () => void;
  loadingMoreLogs: boolean;
  logPageError: string | null;
  refreshSummary: () => void;
}) {
  const meta = surfaceMeta[surface];
  const rows = surfaceRows(surface, summary);
  const endpoint = meta.endpoint ? summary?.availability[meta.endpoint] : undefined;
  const isLogsSurface = surface === "logs";
  const totalLogs = summary?.logsTotal ?? rows.length;
  const logPageSize = summary?.logsLimit ?? MOBILE_LOGS_CHROME.pageSize;
  const hasMoreLogs = Boolean(summary?.logsHasMore);
  const counterLabel = isLogsSurface
    ? `${rows.length}/${totalLogs}`
    : endpoint
      ? endpointStatusLabel(endpoint)
      : String(rows.length);

  return (
    <>
      {surface === "memory" ? (
        <MemoryRecallCard
          api={api}
          summary={summary}
          accentColor={accentColor}
          refreshSummary={refreshSummary}
        />
      ) : null}
      <StableDetailPanel>
        <View style={styles.subsectionHeader}>
          <Text style={styles.subsectionTitle}>Live records</Text>
          <Text style={styles.counterText}>{counterLabel}</Text>
        </View>
        {isLogsSurface && summary ? (
          <Text style={styles.pageDetailText}>
            Showing {rows.length} of {totalLogs} gateway log events
          </Text>
        ) : null}
        {!summary ? (
          <LoadingState
            label={`Loading ${meta.title.toLowerCase()}`}
            detail="Refreshing from the gateway."
          />
        ) : endpoint?.ok === false ? (
          <EmptyState
            label={`${meta.title} unavailable`}
            detail={endpointErrorDetail(endpoint, "The gateway did not return this surface.")}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            label={`No ${meta.title.toLowerCase()}`}
            detail="No records were returned for this gateway surface."
          />
        ) : (
          rows.map((row) => {
            const Icon = meta.Icon;
            return (
              <Pressable key={row.id} style={styles.listRow} onPress={() => openItem(row)}>
                <View style={[styles.listIcon, { backgroundColor: `${meta.tone}18` }]}>
                  <Icon color={meta.tone} size={20} strokeWidth={2.1} />
                </View>
                <View style={styles.listText}>
                  <Text numberOfLines={1} style={styles.listTitle}>
                    {row.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.listDetail}>
                    {row.detail}
                  </Text>
                </View>
                <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
              </Pressable>
            );
          })
        )}
        {isLogsSurface && summary && rows.length > 0 ? (
          <View style={styles.logPageFooter}>
            {logPageError ? <Text style={styles.errorText}>{logPageError}</Text> : null}
            {hasMoreLogs ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingMoreLogs}
                onPress={loadMoreLogs}
                style={[styles.loadMoreButton, loadingMoreLogs && styles.loadMoreButtonDisabled]}
              >
                {loadingMoreLogs ? (
                  <ActivityIndicator color={colors.blueText} size="small" />
                ) : null}
                <Text style={styles.loadMoreButtonText}>
                  {loadingMoreLogs ? "Loading logs" : `Load ${logPageSize} more`}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.pageDetailText}>All logs loaded</Text>
            )}
          </View>
        ) : null}
      </StableDetailPanel>
    </>
  );
}

export function ItemDetailPanel({
  api,
  closeDetail,
  refreshSummary,
  route,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  refreshSummary: () => void;
  route: Extract<DetailRoute, { kind: "item" }>;
  summary: FeatureSummary | null;
}) {
  const item = route.item;
  const meta = surfaceMeta[route.surface];
  const Icon = meta.Icon;
  if (route.surface === "agents" && MOBILE_SETTINGS_DETAIL_CHROME.agentsEditable) {
    return (
      <AgentSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
        summary={summary}
      />
    );
  }
  if (route.surface === "providers" && MOBILE_SETTINGS_DETAIL_CHROME.providersEditable) {
    return (
      <ProviderSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
        summary={summary}
      />
    );
  }
  if (route.surface === "channels" && MOBILE_SETTINGS_DETAIL_CHROME.channelsEditable) {
    return (
      <ChannelSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.surface === "tasks" && MOBILE_SETTINGS_DETAIL_CHROME.tasksActionable) {
    return (
      <TaskSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.surface === "wallet" && MOBILE_SETTINGS_DETAIL_CHROME.walletPolicyUsesToggles) {
    return (
      <WalletPolicyPanel api={api} item={item} refreshSummary={refreshSummary} summary={summary} />
    );
  }
  if (route.surface === "monitor" && MOBILE_SETTINGS_DETAIL_CHROME.monitorShowsHostTelemetry) {
    return (
      <SystemMonitorDetailPanel item={item} refreshSummary={refreshSummary} summary={summary} />
    );
  }
  if (route.surface === "approvals" && MOBILE_SETTINGS_DETAIL_CHROME.approvalsActionable) {
    return (
      <ApprovalSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
      />
    );
  }
  const fields = [
    ...("status" in item && item.status ? [{ label: "Status", value: item.status }] : []),
    ...("type" in item && item.type ? [{ label: "Type", value: item.type }] : []),
    ...("createdAt" in item && item.createdAt
      ? [{ label: "Time", value: absoluteTimestampLabel(item.createdAt) }]
      : []),
    ...cleanSettingsFields(item.fields),
  ];

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${meta.tone}18` }]}>
          <Icon color={meta.tone} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.itemDetail}>
            {item.detail}
          </Text>
        </View>
      </View>
      {fields.length === 0 ? (
        <EmptyState
          label="No editable settings"
          detail="This gateway surface does not expose mobile-editable settings yet."
        />
      ) : (
        <DetailInfoSection title="Details" fields={fields} />
      )}
    </StableDetailPanel>
  );
}

export function SettingsPanel({
  accentColor,
  accentKey,
  api,
  connectionError,
  profile,
  refreshSummary,
  summary,
  onThemeAccentChange,
  onDisconnect,
  onProfileUpdated,
  openSurface,
  openSystemPrompt,
  openModelRouter,
  openSpeech,
  openMemory,
  openMigration,
  openJourney,
}: {
  accentColor: string;
  accentKey: AccentKey;
  api: CybaraMobileApi;
  connectionError: string | null;
  profile: GatewayProfile;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
  onThemeAccentChange: (accent: AccentKey) => void;
  onDisconnect: () => void;
  onProfileUpdated?: (profile: GatewayProfile) => void | Promise<void>;
  openSurface: (surface: MobileSurfaceKey) => void;
  openSystemPrompt: () => void;
  openModelRouter: () => void;
  openSpeech: () => void;
  openMemory: () => void;
  openMigration: () => void;
  openJourney: () => void;
}) {
  const counts = summarizeFeatureCounts(summary);
  const { mode: appearanceMode, setMode: setAppearanceMode } = useThemeControls();
  const { enabled: hapticsEnabled, setEnabled: setHapticsEnabled } = useHapticsControls();
  const [selectedSettingsTab, setSelectedSettingsTab] = useState<MobileSettingsTab>("general");
  const [savingAccent, setSavingAccent] = useState<AccentKey | null>(null);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [savingAgentAccess, setSavingAgentAccess] = useState(false);
  const walletMeta = surfaceMeta.wallet;
  const WalletIcon = walletMeta.Icon;
  const configAvailable = summary?.availability.config.ok === true;
  const systemPromptAvailable =
    summary?.availability.systemPrompt.ok === true && Boolean(summary.systemPrompt);
  const health = summary?.health;
  const healthy = health?.status === "healthy";
  const authStatus = mobileGatewayAuthStatus(summary, connectionError);
  const healthUnavailable = authStatus === "unreachable";
  const gatewayStatusColor =
    healthy && authStatus === "connected"
      ? colors.green
      : healthUnavailable || authStatus === "needs_pairing"
        ? colors.red
        : colors.amber;
  const gatewayStatusLabel = healthy
    ? authStatus === "needs_pairing"
      ? "Pairing needs refresh"
      : "Gateway connected"
    : healthUnavailable
      ? "Gateway degraded"
      : "Checking gateway";
  const gatewayVersion = health?.version
    ? `v${String(health.version).replace(/^v/i, "")}`
    : "pending";
  const gatewayUptime = formatUptime(health?.uptime);
  const terminalEnabled = summary?.config.terminal_enabled === true;
  const acpEnabled = summary?.config.acp_enabled !== false;
  const selfImprovingSkillsEnabled = summary?.config.self_improving_skills_enabled !== false;
  const toolApprovalMode = readMobileToolApprovalMode(summary?.config);
  const reasoningEffort = readMobileReasoningEffort(summary?.config);
  const dangerousPolicy = readMobileDangerousToolPolicy(summary?.config);
  const sandboxRuntime = readMobileSandboxRuntime(summary?.config);
  const walletStatus = objectRecord(summary?.walletStatus);
  const walletStatusAvailable = Boolean(walletStatus);
  const agentAccessEnabled = booleanSetting(walletStatus, "agentAccessEnabled");
  const showGeneralSettings = selectedSettingsTab === "general";
  const showGatewaySettings = selectedSettingsTab === "gateway";
  const showAiSettings = selectedSettingsTab === "ai";
  const showMemorySettings = selectedSettingsTab === "memory";
  const showVoiceSettings = selectedSettingsTab === "voice";
  const showMcpSettings = selectedSettingsTab === "mcp";
  const showSafetySettings = selectedSettingsTab === "safety";
  const showWalletSettings = selectedSettingsTab === "wallet";
  const showMigrationSettings = selectedSettingsTab === "migration";
  const showSystemSettings = selectedSettingsTab === "system";

  const saveConfigPatch = async (
    key: string,
    patch: Record<string, unknown>,
    errorTitle = "Setting update failed"
  ) => {
    if (!configAvailable || savingConfigKey) return;
    setSavingConfigKey(key);
    try {
      const result = await api.updateConfig(patch);
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(errorTitle, error instanceof Error ? error.message : String(error));
    } finally {
      setSavingConfigKey(null);
    }
  };

  const toggleAgentAccess = async () => {
    if (!walletStatusAvailable || savingAgentAccess) return;
    setSavingAgentAccess(true);
    try {
      const result = await api.setWalletAgentAccess(!agentAccessEnabled);
      if (result.success === false) {
        throw new Error("The gateway did not update wallet agent access.");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Wallet access update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSavingAgentAccess(false);
    }
  };

  const updateThemeAccent = async (next: AccentKey) => {
    if (savingAccent || next === accentKey) return;
    const previous = readMobileAccent(summary?.config) as AccentKey;
    onThemeAccentChange(next);
    setSavingAccent(next);
    try {
      const result = await api.updateConfig(mobileThemeConfigPayload(next));
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      onThemeAccentChange(previous);
      Alert.alert("Theme update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAccent(null);
    }
  };

  return (
    <StableDetailPanel edgeToEdge={MOBILE_SETTINGS_ROOT_CHROME.settingsEdgeToEdgeContent}>
      <View style={styles.settingsNativePage}>
        <SettingsTabRail
          onSelect={(value) => {
            if (MOBILE_SETTINGS_TABS.some((option) => option.value === value)) {
              setSelectedSettingsTab(value as MobileSettingsTab);
            }
          }}
          options={MOBILE_SETTINGS_TABS}
          selected={selectedSettingsTab}
          tone={accentColor}
        />
        {showGatewaySettings && MOBILE_SETTINGS_ROOT_CHROME.gatewayConnectionDetails ? (
          <View style={styles.settingsSection}>
            <View style={styles.settingsGatewayCard}>
              <View style={styles.connectionRow}>
                <View style={[styles.liveDot, { backgroundColor: gatewayStatusColor }]} />
                <Text style={[styles.connectionText, { color: gatewayStatusColor }]}>
                  {gatewayStatusLabel}
                </Text>
              </View>
              <View style={styles.gatewayTop}>
                <View style={styles.gatewayIdentity}>
                  <Text style={styles.gatewayName}>{profile.name}</Text>
                  <Text style={styles.gatewayMeta}>{compactHost(profile.baseUrl)}</Text>
                </View>
              </View>
              <View style={styles.gatewayDetailGrid}>
                <GatewayDetailPill label="Uptime" value={gatewayUptime} />
                <GatewayDetailPill label="Version" value={gatewayVersion} />
                <GatewayDetailPill label="Endpoint" value={profile.baseUrl} />
                <GatewayDetailPill
                  label="Device"
                  value={profile.deviceId ? "Paired" : "Manual API key"}
                />
              </View>
              {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}
              {authStatus === "needs_pairing" ? (
                <Text style={styles.errorText}>
                  The gateway is reachable, but this device token was rejected. Disconnect this
                  profile and pair again from the gateway Mobile page.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {showGeneralSettings ? (
          <>
            <SettingsSection title="Appearance">
              <SettingSelector
                label="Theme"
                onSelect={(value) => {
                  if (value === "system" || value === "light" || value === "dark") {
                    setAppearanceMode(value);
                  }
                }}
                options={[
                  { label: "System", value: "system" },
                  { label: "Light", value: "light" },
                  { label: "Dark", value: "dark" },
                ]}
                selected={appearanceMode}
                tone={accentColor}
                variant="segmented"
              />
            </SettingsSection>
            <SettingsSection
              accessory={
                savingAccent ? <ActivityIndicator color={accentColor} size="small" /> : null
              }
              title="Highlight color"
            >
              <View style={styles.accentGrid}>
                {MOBILE_ACCENT_KEYS.map((key) => {
                  const themeKey = key as AccentKey;
                  const tone = accentPalette[themeKey];
                  const selected = accentKey === themeKey;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: Boolean(savingAccent) }}
                      disabled={Boolean(savingAccent)}
                      onPress={() => {
                        void updateThemeAccent(themeKey);
                      }}
                      style={[
                        styles.accentSwatch,
                        selected && {
                          borderColor: tone,
                          backgroundColor: `${tone}16`,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.accentSwatchDot,
                          {
                            backgroundColor: tone,
                            shadowColor: tone,
                          },
                          selected && styles.accentSwatchDotActive,
                        ]}
                      />
                      <Text
                        numberOfLines={1}
                        style={[styles.accentSwatchLabel, selected && { color: colors.text }]}
                      >
                        {key}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </SettingsSection>
            <SettingsSection title="Feedback">
              <SettingToggle
                detail="Use subtle feedback for navigation, agent activity, and completed responses."
                label="Haptic feedback"
                onPress={() => setHapticsEnabled(!hapticsEnabled)}
                tone={accentColor}
                value={hapticsEnabled}
              />
            </SettingsSection>
          </>
        ) : null}
        {showSafetySettings ? (
          <>
            <SettingsSection title="Safety controls">
              {configAvailable ? (
                <>
                  {MOBILE_SETTINGS_ROOT_CHROME.terminalToggle ? (
                    <SettingToggle
                      busy={savingConfigKey === "terminal_enabled"}
                      detail="Enable browser-based terminal access on the gateway."
                      disabled={savingConfigKey !== null}
                      label="Web terminal"
                      onPress={() => {
                        void saveConfigPatch(
                          "terminal_enabled",
                          { terminal_enabled: !terminalEnabled },
                          "Terminal setting failed"
                        );
                      }}
                      tone={accentColor}
                      value={terminalEnabled}
                    />
                  ) : null}
                  <SettingToggle
                    busy={savingConfigKey === "acp_enabled"}
                    detail="Allow compatible editors to connect through the gateway's ACP server."
                    disabled={savingConfigKey !== null}
                    label="ACP server"
                    onPress={() => {
                      void saveConfigPatch(
                        "acp_enabled",
                        { acp_enabled: !acpEnabled },
                        "ACP setting failed"
                      );
                    }}
                    tone={accentColor}
                    value={acpEnabled}
                  />
                  {MOBILE_SETTINGS_ROOT_CHROME.toolApprovalModeSelector ? (
                    <SettingSelector
                      disabled={savingConfigKey !== null}
                      label="Tool approvals"
                      onSelect={(value) => {
                        void saveConfigPatch(
                          "tool_approval_mode",
                          { tool_approval_mode: value === "ask" ? "ask" : "always_allow" },
                          "Tool approval setting failed"
                        );
                      }}
                      options={[
                        { label: "Always Allow", value: "always_allow" },
                        { label: "Ask Me", value: "ask" },
                      ]}
                      selected={toolApprovalMode}
                      tone={accentColor}
                      variant="menu"
                    />
                  ) : null}
                  {MOBILE_SETTINGS_ROOT_CHROME.dangerousToolPolicyToggle ? (
                    <>
                      <SettingToggle
                        busy={savingConfigKey === "dangerous_tool_policy"}
                        detail="Guardrails for shell, wallet, and other high-impact tools."
                        disabled={savingConfigKey !== null}
                        label="Dangerous tool policy"
                        onPress={() => {
                          void saveConfigPatch(
                            "dangerous_tool_policy",
                            {
                              dangerous_tool_policy: {
                                enabled: !dangerousPolicy.enabled,
                                mode: dangerousPolicy.mode,
                              },
                            },
                            "Dangerous tool policy failed"
                          );
                        }}
                        tone={accentColor}
                        value={dangerousPolicy.enabled}
                      />
                      {dangerousPolicy.enabled ? (
                        <SettingSelector
                          disabled={savingConfigKey !== null}
                          label="Dangerous policy mode"
                          onSelect={(value) => {
                            void saveConfigPatch(
                              "dangerous_tool_policy",
                              {
                                dangerous_tool_policy: {
                                  enabled: true,
                                  mode: value === "block" ? "block" : "audit",
                                },
                              },
                              "Dangerous tool policy failed"
                            );
                          }}
                          options={[
                            { label: "Audit", value: "audit" },
                            { label: "Block", value: "block" },
                          ]}
                          selected={dangerousPolicy.mode}
                          tone={accentColor}
                          variant="segmented"
                        />
                      ) : null}
                    </>
                  ) : null}
                  {MOBILE_SETTINGS_ROOT_CHROME.sandboxRuntimeControls ? (
                    <>
                      <SettingToggle
                        busy={savingConfigKey === "sandbox_runtime"}
                        detail="Run supported command tools in an isolated runtime."
                        disabled={savingConfigKey !== null}
                        label="Command sandbox"
                        onPress={() => {
                          void saveConfigPatch(
                            "sandbox_runtime",
                            {
                              sandbox_runtime: {
                                ...sandboxRuntime,
                                enabled: !sandboxRuntime.enabled,
                              },
                            },
                            "Sandbox setting failed"
                          );
                        }}
                        tone={accentColor}
                        value={sandboxRuntime.enabled}
                      />
                      {sandboxRuntime.enabled ? (
                        <>
                          <SettingSelector
                            disabled={savingConfigKey !== null}
                            label="Sandbox provider"
                            onSelect={(value) => {
                              const provider =
                                value === "apple_sandbox" ||
                                value === "podman" ||
                                value === "docker"
                                  ? value
                                  : "auto";
                              void saveConfigPatch(
                                "sandbox_runtime",
                                {
                                  sandbox_runtime: {
                                    ...sandboxRuntime,
                                    provider,
                                  },
                                },
                                "Sandbox setting failed"
                              );
                            }}
                            options={[
                              { label: "Auto", value: "auto" },
                              { label: "Apple", value: "apple_sandbox" },
                              { label: "Podman", value: "podman" },
                              { label: "Docker", value: "docker" },
                            ]}
                            selected={sandboxRuntime.provider}
                            tone={accentColor}
                            variant="segmented"
                          />
                          <SettingSelector
                            disabled={savingConfigKey !== null}
                            label="Sandbox network"
                            onSelect={(value) => {
                              void saveConfigPatch(
                                "sandbox_runtime",
                                {
                                  sandbox_runtime: {
                                    ...sandboxRuntime,
                                    network: value === "allow" ? "allow" : "deny",
                                  },
                                },
                                "Sandbox setting failed"
                              );
                            }}
                            options={[
                              { label: "Deny", value: "deny" },
                              { label: "Allow", value: "allow" },
                            ]}
                            selected={sandboxRuntime.network}
                            tone={accentColor}
                            variant="segmented"
                          />
                        </>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : !summary ? (
                <LoadingState label="Loading settings" detail="Fetching config from the gateway." />
              ) : (
                <EmptyState
                  label="Config unavailable"
                  detail={endpointErrorDetail(
                    summary?.availability.config,
                    "The gateway did not return editable settings."
                  )}
                />
              )}
            </SettingsSection>
            {configAvailable ? (
              <>
                <MobileWebPolicyPanel
                  accentColor={accentColor}
                  api={api}
                  config={(summary?.config ?? {}) as Record<string, unknown>}
                  refreshSummary={refreshSummary}
                />
                <MobileComputerUsePanel api={api} />
              </>
            ) : null}
          </>
        ) : null}
        {showMcpSettings ? <MobileMcpSettingsPanel accentColor={accentColor} api={api} /> : null}
        {showAiSettings ? (
          <SettingsSection title="AI">
            {configAvailable ? (
              <SettingSelector
                disabled={savingConfigKey !== null}
                label="Default agent"
                onSelect={(value) => {
                  void saveConfigPatch(
                    "default_agent_id",
                    { default_agent_id: value },
                    "Default agent setting failed"
                  );
                }}
                options={[
                  { label: "First available agent (default)", value: "" },
                  ...(summary?.agents ?? []).map((agent) => ({
                    label: agent.model ? `${agent.name} — ${agent.model}` : agent.name,
                    value: agent.id,
                  })),
                ]}
                selected={
                  typeof summary?.config?.default_agent_id === "string"
                    ? summary.config.default_agent_id
                    : ""
                }
                tone={accentColor}
                variant="menu"
              />
            ) : null}
            {configAvailable && MOBILE_SETTINGS_ROOT_CHROME.reasoningEffortSelector ? (
              <SettingSelector
                disabled={savingConfigKey !== null}
                label="Reasoning effort"
                onSelect={(value) => {
                  void saveConfigPatch(
                    "reasoning_effort",
                    { reasoning_effort: value },
                    "Reasoning effort setting failed"
                  );
                }}
                options={MOBILE_REASONING_EFFORT_OPTIONS.map((option) => ({
                  label: option.label,
                  value: option.value,
                }))}
                selected={reasoningEffort}
                tone={accentColor}
                variant="menu"
              />
            ) : null}
            {configAvailable ? (
              <SettingToggle
                busy={savingConfigKey === "self_improving_skills_enabled"}
                detail="Let agents save reusable skills after complex tasks."
                disabled={savingConfigKey !== null}
                label="Self-improving skills"
                onPress={() => {
                  void saveConfigPatch(
                    "self_improving_skills_enabled",
                    { self_improving_skills_enabled: !selfImprovingSkillsEnabled },
                    "Self-improving skills setting failed"
                  );
                }}
                tone={accentColor}
                value={selfImprovingSkillsEnabled}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openSystemPrompt}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Sparkles color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>System Prompt</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {systemPromptAvailable
                    ? summary?.systemPrompt?.identity?.name
                      ? `Identity: ${summary.systemPrompt.identity.name}`
                      : "Identity, instructions, and behavior"
                    : endpointStatusLabel(summary?.availability.systemPrompt)}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
            {MOBILE_SETTINGS_ROOT_CHROME.modelRouterControls ? (
              <Pressable
                accessibilityRole="button"
                style={styles.settingsNavigationRow}
                onPress={openModelRouter}
              >
                <View
                  style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
                >
                  <Network color={accentColor} size={20} strokeWidth={2.1} />
                </View>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>Model Router</Text>
                  <Text style={styles.listDetail} numberOfLines={1}>
                    Provider routing, fallback, and spend caps
                  </Text>
                </View>
                <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
              </Pressable>
            ) : null}
          </SettingsSection>
        ) : null}
        {showMemorySettings ? (
          <SettingsSection title="Memory">
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openMemory}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Brain color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>Memory</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {configAvailable
                    ? "Memory provider, learning loop, and indexing"
                    : endpointStatusLabel(summary?.availability.config)}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openJourney}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Sparkles color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>Journey</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  Skills and memories your agent has learned over time
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          </SettingsSection>
        ) : null}
        {showVoiceSettings && MOBILE_SETTINGS_ROOT_CHROME.speechControls ? (
          <SettingsSection title="Voice">
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openSpeech}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Volume2 color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>Text-to-speech & dictation</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {configAvailable
                    ? "Voice output provider, model, and speech-to-text"
                    : endpointStatusLabel(summary?.availability.config)}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          </SettingsSection>
        ) : null}
        {showGatewaySettings ? (
          <SettingsSection title="Gateway APIs">
            <SettingsRow
              Icon={Database}
              label="Config API"
              value={endpointStatusLabel(summary?.availability.config)}
            />
          </SettingsSection>
        ) : null}
        {showGatewaySettings ? (
          <GatewayManagementPanel
            api={api}
            openLogs={() => openSurface("logs")}
            profile={profile}
            refreshSummary={refreshSummary}
            summary={summary}
            onProfileUpdated={onProfileUpdated}
          />
        ) : null}
        {showWalletSettings ? (
          <SettingsSection title="Wallet">
            {MOBILE_SETTINGS_ROOT_CHROME.walletAccessShortcut ? (
              <SettingToggle
                busy={savingAgentAccess}
                detail="Master switch for agent-initiated wallet actions."
                disabled={!walletStatusAvailable || savingAgentAccess}
                label="Agent wallet access"
                onPress={() => {
                  void toggleAgentAccess();
                }}
                tone={accentColor}
                value={agentAccessEnabled}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={() => openSurface("wallet")}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${walletMeta.tone}18` }]}
              >
                <WalletIcon color={walletMeta.tone} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{walletMeta.title}</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {surfaceMenuDetail(
                    "wallet",
                    summary,
                    counts,
                    surfaceRows("wallet", summary).length
                  )}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          </SettingsSection>
        ) : null}
        {showMigrationSettings && MOBILE_SETTINGS_ROOT_CHROME.migrationControls ? (
          <SettingsSection title="Migration">
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openMigration}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Folder color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>Legacy agent import</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  Preview settings, memories, skills, and optional provider keys
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          </SettingsSection>
        ) : null}
        {showSystemSettings ? (
          <SettingsSection title="System">
            {MOBILE_SETTINGS_SURFACES.filter((surface) => surface !== "wallet").map((surface) => {
              const meta = surfaceMeta[surface];
              const Icon = meta.Icon;
              const rows = surfaceRows(surface, summary);
              return (
                <Pressable
                  key={surface}
                  style={styles.settingsNavigationRow}
                  onPress={() => openSurface(surface)}
                >
                  <View
                    style={[styles.settingsNavigationIcon, { backgroundColor: `${meta.tone}18` }]}
                  >
                    <Icon color={meta.tone} size={20} strokeWidth={2.1} />
                  </View>
                  <View style={styles.listText}>
                    <Text style={styles.listTitle}>{meta.title}</Text>
                    <Text style={styles.listDetail} numberOfLines={1}>
                      {surfaceMenuDetail(surface, summary, counts, rows.length)}
                    </Text>
                  </View>
                  <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
                </Pressable>
              );
            })}
          </SettingsSection>
        ) : null}
        {showSystemSettings ? (
          <View style={styles.settingsSection}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.disconnectButton,
                pressed && styles.disconnectButtonPressed,
              ]}
              onPress={() => {
                haptics.warning();
                Alert.alert(
                  "Disconnect gateway?",
                  "This removes the pairing profile from this device. You'll need to pair again to reconnect.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Disconnect", style: "destructive", onPress: onDisconnect },
                  ]
                );
              }}
            >
              <View style={styles.disconnectIcon}>
                <Trash2 color={colors.red} size={18} strokeWidth={2.4} />
              </View>
              <View style={styles.disconnectTextWrap}>
                <Text style={styles.disconnectTitle}>Disconnect Gateway</Text>
                <Text style={styles.disconnectDetail}>Remove this mobile pairing profile</Text>
              </View>
            </Pressable>
          </View>
        ) : null}
      </View>
    </StableDetailPanel>
  );
}
