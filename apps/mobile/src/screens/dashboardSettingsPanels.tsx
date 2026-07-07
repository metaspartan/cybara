import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  Bot,
  CalendarCheck,
  Copy,
  Cpu,
  Database,
  Eye,
  Link2,
  Mic,
  Network,
  Play,
  RefreshCw,
  Save,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  Zap,
} from "lucide-react-native";
import { haptics } from "../lib/haptics";
import { colors } from "../theme/liquidGlass";
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
  absoluteTimestampLabel,
  agentIsRunning,
  agentProviderId,
  arraySettingCount,
  booleanSetting,
  cleanSettingsFields,
  displayFieldLabel,
  displayFields,
  endpointErrorDetail,
  mobileSpeechProviderOptions,
  monitorPercent,
  monitorPercentLabel,
  objectRecord,
  readMobileIndexingSettings,
  readMobileMemoryBehaviorSettings,
  readMobileLlmTimeoutSettings,
  type MobileLlmTimeoutSettings,
  readMobileMemoryProviderSettings,
  readMobileSpeechSettings,
  remoteItemEnabled,
  remoteTaskRunning,
  MOBILE_MEMORY_PROVIDER_CHOICES,
  type MobileIndexingSettings,
  type MobileMemoryBehaviorSettings,
  type MobileMemoryProviderChoice,
  type MobileMemoryProviderSettings,
  type MobileSpeechSettings,
} from "./dashboardHelpers";
import {
  MOBILE_ROUTER_STRATEGY_OPTIONS,
  MOBILE_SETTINGS_DETAIL_CHROME,
  MOBILE_SYSTEM_PROMPT_FEATURE_KEYS,
  formatMobileValue,
  formatUptime,
  mobileProviderAuthMode,
  readMobileRouterStrategy,
} from "../lib/dashboard";
import { formatMetricBytes, formatMetricNumber, formatStorageBytes } from "../lib/metrics";
import {
  CybaraMobileApi,
  CybaraApiError,
  type ActivitySummary,
  type AgentSummary,
  type FeatureSummary,
  type JourneyEvent,
  type JourneyResponse,
  type GatewayAuthSettings,
  type ProviderPlanMonitoringConfig,
  type ProviderPlanStatusResponse,
  type ProviderSummary,
  type RemoteItemSummary,
  type RouterConfig,
  type RouterStatus,
  type SystemPromptFeatureKey,
  type ToolApprovalDecision,
  type WalletAgentPolicyUpdate,
  type WalletChain,
  type WalletTokenChain,
} from "../lib/api";
import type { GatewayProfile } from "../lib/connection";
import { saveProfile } from "../lib/storage";

const agentTypeOptions = ["main", "research", "coder", "planner", "ops", "worker"] as const;

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

function gatewayActionError(error: unknown, fallback: string): string {
  if (error instanceof CybaraApiError) {
    if (error.status === 401 || error.status === 403) {
      return "This mobile profile does not have the scope required for that gateway action.";
    }
    return `Gateway returned ${error.status}.`;
  }
  return error instanceof Error ? error.message : fallback;
}

function providerPlanProgress(
  plan: ProviderPlanStatusResponse["providers"][number] | null
): number | null {
  const usage = (plan?.windows || [])
    .map((window) => window.usedPercent)
    .filter((value): value is number => typeof value === "number");
  if (usage.length === 0) return null;
  return Math.min(100, Math.max(...usage));
}

function providerPlanStatusTone(status: ProviderPlanStatusResponse["providers"][number]["status"]) {
  if (status === "ok") return colors.green;
  if (status === "warning") return colors.amber;
  if (status === "exhausted") return colors.red;
  return colors.textMuted;
}

function providerPlanPresetLimitLabel(
  preset: ProviderPlanStatusResponse["providers"][number]["presetSuggestions"][number]
) {
  if (preset.monthlyTokenLimit) return `${formatMetricNumber(preset.monthlyTokenLimit)} tokens/mo`;
  if (preset.monthlySpendLimit) return `$${preset.monthlySpendLimit}/mo credits`;
  if (preset.routeLimitWeekly) return `${formatMetricNumber(preset.routeLimitWeekly)} req/week`;
  if (preset.routeLimit5h) return `${formatMetricNumber(preset.routeLimit5h)} req/5h`;
  return "Provider-managed";
}

export type WalletPolicyToggleKey = Extract<
  keyof WalletAgentPolicyUpdate,
  | "allowNativeSend"
  | "allowTokenSend"
  | "allowEthContractWrite"
  | "allowSolProgramInstruction"
  | "allowEthSwaps"
  | "allowDappInteraction"
  | "allowX402Payments"
>;

const walletPolicyToggleRows: Array<{
  key: WalletPolicyToggleKey;
  label: string;
  detail: string;
}> = [
  {
    key: "allowNativeSend",
    label: "Native sends",
    detail: "Allow agents to send native wallet assets.",
  },
  {
    key: "allowTokenSend",
    label: "Token sends",
    detail: "Allow agents to send token balances.",
  },
  {
    key: "allowEthContractWrite",
    label: "ETH contract writes",
    detail: "Allow Ethereum contract write calls within policy limits.",
  },
  {
    key: "allowSolProgramInstruction",
    label: "Solana program instructions",
    detail: "Allow Solana program instructions within policy limits.",
  },
  {
    key: "allowEthSwaps",
    label: "ETH swaps",
    detail: "Allow Uniswap and compatible Ethereum swap actions.",
  },
  {
    key: "allowDappInteraction",
    label: "Dapp interaction",
    detail: "Allow configured dapp adapters and host allowlists.",
  },
  {
    key: "allowX402Payments",
    label: "x402 payments",
    detail: "Allow agent-initiated x402 payment requests.",
  },
];

export function AgentSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const summaryAgent = summary?.agents.find((agent) => agent.id === item.id);
  const itemType = "type" in item ? item.type : undefined;
  const itemStatus = "status" in item ? item.status : undefined;
  const agent: AgentSummary = summaryAgent ?? {
    id: item.id,
    name: item.title,
    model: itemType,
    status: itemStatus,
  };
  const [name, setName] = useState(agent.name);
  const [type, setType] = useState(agent.type || "main");
  const [providerId, setProviderId] = useState(agentProviderId(agent));
  const [model, setModel] = useState(agent.model || "");
  const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt || "");
  const [saving, setSaving] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const providerOptions = summary?.providers ?? [];
  const running = agentIsRunning(agent);

  useEffect(() => {
    setName(agent.name);
    setType(agent.type || "main");
    setProviderId(agentProviderId(agent));
    setModel(agent.model || "");
    setSystemPrompt(agent.system_prompt || "");
  }, [
    agent.id,
    agent.model,
    agent.name,
    agent.provider,
    agent.provider_id,
    agent.system_prompt,
    agent.type,
  ]);

  const saveAgent = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the agent a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.updateAgent(agent.id, {
        name: trimmedName,
        type,
        provider_id: providerId || undefined,
        model: model.trim() || undefined,
        system_prompt: systemPrompt,
      });
      await refreshSummary();
      Alert.alert("Agent saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Agent save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleAgentRuntime = async () => {
    setRunningAction(true);
    try {
      const result = running ? await api.stopAgent(agent.id) : await api.startAgent(agent.id);
      await refreshSummary();
      if (result.success === false) {
        throw new Error(
          running ? "The gateway did not stop this agent." : "The gateway did not start this agent."
        );
      }
    } catch (error) {
      Alert.alert("Agent action failed", error instanceof Error ? error.message : String(error));
    } finally {
      setRunningAction(false);
    }
  };

  const deleteAgent = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteAgent(agent.id);
      if (result.success === false) throw new Error("The gateway did not delete this agent.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete agent?", `${agent.name} will be removed from this gateway.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteAgent();
        },
      },
    ]);
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.cyan}18` }]}>
          <Bot color={colors.cyan} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {agent.name}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {[agent.status || "stopped", agent.model || "model not set"].join(" - ")}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingsTextField
          autoCapitalize="words"
          label="Display name"
          onChangeText={setName}
          placeholder="Agent name"
          value={name}
        />
        <SettingSelector
          label="Type"
          variant="menu"
          options={agentTypeOptions.map((value) => ({ label: displayFieldLabel(value), value }))}
          selected={type}
          onSelect={setType}
        />
        <SettingSelector
          label="Provider"
          variant="menu"
          options={providerOptions.map((provider) => ({
            label: provider.name,
            value: provider.id,
          }))}
          selected={providerId}
          onSelect={setProviderId}
        />
        <SettingsTextField
          label="Model"
          onChangeText={setModel}
          placeholder="Model name"
          value={model}
        />
        <SettingsTextField
          help="Used as this agent's operating instructions."
          label="System prompt"
          multiline
          onChangeText={setSystemPrompt}
          placeholder="You are a helpful AI assistant..."
          value={systemPrompt}
        />
      </View>

      <View style={styles.settingsActionRow}>
        <DetailActionButton Icon={Save} busy={saving} label="Save" onPress={saveAgent} />
        <DetailActionButton
          Icon={running ? Square : Play}
          busy={runningAction}
          label={running ? "Stop" : "Start"}
          onPress={toggleAgentRuntime}
          tone={running ? colors.amber : colors.green}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </StableDetailPanel>
  );
}

export function ProviderSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const summaryProvider = summary?.providers.find((provider) => provider.id === item.id);
  const itemType = "type" in item ? item.type : undefined;
  const provider: ProviderSummary = summaryProvider ?? {
    id: item.id,
    name: item.title,
    provider: itemType || item.detail || "provider",
  };
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.base_url || "");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isDefault, setIsDefault] = useState(Boolean(provider.is_default));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthStatus, setOauthStatus] = useState("");
  const [oauthDeviceCode, setOauthDeviceCode] = useState("");
  const [providerPlan, setProviderPlan] = useState<
    ProviderPlanStatusResponse["providers"][number] | null
  >(null);
  const [planMonitoringConfig, setPlanMonitoringConfig] =
    useState<ProviderPlanMonitoringConfig | null>(null);
  const [planPresetId, setPlanPresetId] = useState("");
  const [planName, setPlanName] = useState("");
  const [planFiveHourTokens, setPlanFiveHourTokens] = useState("");
  const [planWeeklyTokens, setPlanWeeklyTokens] = useState("");
  const [planMonthlyTokens, setPlanMonthlyTokens] = useState("");
  const [planMonthlySpend, setPlanMonthlySpend] = useState("");
  const [planPriceInput, setPlanPriceInput] = useState("");
  const [planPriceOutput, setPlanPriceOutput] = useState("");
  const [routerPricingConfig, setRouterPricingConfig] = useState<RouterConfig | null>(null);
  const authMode = mobileProviderAuthMode(provider);
  const usesApiKey = authMode === "api_key";
  const usesOAuth = authMode === "oauth";
  const usesAccessToken = authMode === "access_token";
  const usesAwsSdk = authMode === "aws_sdk";
  const usesNoAuth = authMode === "none";

  useEffect(() => {
    setName(provider.name);
    setBaseUrl(provider.base_url || "");
    setApiKey("");
    setAccessToken("");
    setIsDefault(Boolean(provider.is_default));
    setOauthBusy(false);
    setOauthStatus("");
    setOauthDeviceCode("");
    setProviderPlan(null);
  }, [provider.base_url, provider.id, provider.is_default, provider.name]);

  useEffect(() => {
    let mounted = true;
    const loadProviderPlan = async () => {
      try {
        const status = await api.providerPlanStatus();
        if (!mounted) return;
        const match = status.providers.find((plan) =>
          [plan.providerId, plan.configuredProviderId, plan.providerType].includes(provider.id)
        );
        setProviderPlan(
          match ||
            status.providers.find((plan) =>
              [plan.providerId, plan.configuredProviderId, plan.providerType].includes(
                provider.provider
              )
            ) ||
            null
        );
      } catch {
        if (mounted) setProviderPlan(null);
      }
      try {
        const cfg = await api.providerPlanConfig();
        if (!mounted) return;
        setPlanMonitoringConfig(cfg);
        const entry = cfg.providers[provider.id] ?? cfg.providers[provider.provider];
        setPlanPresetId(entry?.presetId || "");
        setPlanName(entry?.planName || "");
        setPlanFiveHourTokens(entry?.fiveHour?.tokenLimit ? String(entry.fiveHour.tokenLimit) : "");
        setPlanWeeklyTokens(entry?.weekly?.tokenLimit ? String(entry.weekly.tokenLimit) : "");
        setPlanMonthlyTokens(entry?.monthly?.tokenLimit ? String(entry.monthly.tokenLimit) : "");
        setPlanMonthlySpend(entry?.monthly?.spendLimit ? String(entry.monthly.spendLimit) : "");
      } catch {
        if (mounted) setPlanMonitoringConfig(null);
      }
      try {
        const routerCfg = await api.routerConfig();
        if (!mounted) return;
        setRouterPricingConfig(routerCfg);
        const route = routerCfg.routes[provider.id];
        setPlanPriceInput(route?.priceInputPerM !== undefined ? String(route.priceInputPerM) : "");
        setPlanPriceOutput(
          route?.priceOutputPerM !== undefined ? String(route.priceOutputPerM) : ""
        );
      } catch {
        if (mounted) setRouterPricingConfig(null);
      }
    };
    void loadProviderPlan();
    return () => {
      mounted = false;
    };
  }, [api, provider.id, provider.provider]);

  const parsePlanLimit = (value: string): number | undefined => {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const planPresets = providerPlan?.presetSuggestions ?? [];
  const selectedPlanPreset = planPresets.find((preset) => preset.id === planPresetId);

  const applyPlanPreset = (presetId: string) => {
    setPlanPresetId(presetId);
    const preset = planPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    setPlanName(preset.planName);
    setPlanFiveHourTokens(preset.fiveHourTokenLimit ? String(preset.fiveHourTokenLimit) : "");
    setPlanWeeklyTokens(preset.weeklyTokenLimit ? String(preset.weeklyTokenLimit) : "");
    setPlanMonthlyTokens(preset.monthlyTokenLimit ? String(preset.monthlyTokenLimit) : "");
    setPlanMonthlySpend(preset.monthlySpendLimit ? String(preset.monthlySpendLimit) : "");
  };

  const savePlanLimits = async () => {
    if (!planMonitoringConfig) return;
    const trimmedPlanName = planName.trim();
    const fiveHourLimit = parsePlanLimit(planFiveHourTokens);
    const weeklyLimit = parsePlanLimit(planWeeklyTokens);
    const tokenLimit = parsePlanLimit(planMonthlyTokens);
    const spendLimit = parsePlanLimit(planMonthlySpend);
    const existingKey = planMonitoringConfig.providers[provider.id]
      ? provider.id
      : planMonitoringConfig.providers[provider.provider]
        ? provider.provider
        : provider.id;
    const existing = planMonitoringConfig.providers[existingKey];
    const hasInput =
      Boolean(trimmedPlanName) ||
      Boolean(planPresetId) ||
      [fiveHourLimit, weeklyLimit, tokenLimit, spendLimit].some((value) => value !== undefined);
    if (!hasInput && !existing) {
      await saveRoutePricing();
      return;
    }

    const nextProviders = { ...planMonitoringConfig.providers };
    if (!hasInput) {
      delete nextProviders[existingKey];
    } else {
      const window = (limit?: number, spend?: number) =>
        limit !== undefined || spend !== undefined
          ? { enabled: true, tokenLimit: limit, spendLimit: spend }
          : undefined;
      nextProviders[existingKey] = {
        ...(existing || {}),
        enabled: true,
        presetId: selectedPlanPreset?.id,
        planName: trimmedPlanName || selectedPlanPreset?.planName || undefined,
        sourceMode: selectedPlanPreset?.sourceMode ?? existing?.sourceMode,
        externalSourceEnabled:
          selectedPlanPreset?.externalSourceEnabled ?? existing?.externalSourceEnabled,
        fiveHour: window(fiveHourLimit),
        weekly: window(weeklyLimit),
        monthly: window(tokenLimit, spendLimit),
      };
    }
    const updated = await api.updateProviderPlanConfig({
      ...planMonitoringConfig,
      enabled: true,
      providers: nextProviders,
    });
    setPlanMonitoringConfig(updated);
    await saveRoutePricing();
  };

  // Custom pay-as-you-go pricing per 1M tokens rides on the router route config.
  const saveRoutePricing = async () => {
    if (!routerPricingConfig) return;
    const priceInput = parsePlanLimit(planPriceInput);
    const priceOutput = parsePlanLimit(planPriceOutput);
    const wantsPricing = priceInput !== undefined || priceOutput !== undefined;
    const route = { ...(routerPricingConfig.routes[provider.id] || { weight: 1 }) };
    const hadPricing = route.priceInputPerM !== undefined || route.priceOutputPerM !== undefined;
    if (!wantsPricing && !hadPricing) return;

    if (wantsPricing) {
      route.priceInputPerM = priceInput ?? 0;
      route.priceOutputPerM = priceOutput ?? 0;
    } else {
      delete route.priceInputPerM;
      delete route.priceOutputPerM;
    }
    const nextConfig = {
      ...routerPricingConfig,
      routes: { ...routerPricingConfig.routes, [provider.id]: route },
    };
    await api.updateRouterConfig(nextConfig);
    setRouterPricingConfig(nextConfig);
  };

  const saveProvider = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the provider a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateProvider(provider.id, {
        name: trimmedName,
        base_url: baseUrl.trim() || undefined,
        api_key: usesApiKey ? apiKey.trim() || undefined : undefined,
        access_token: usesOAuth || usesAccessToken ? accessToken.trim() || undefined : undefined,
        is_default: isDefault,
      });
      if (result.success === false) throw new Error("The gateway did not save this provider.");
      await savePlanLimits();
      setApiKey("");
      setAccessToken("");
      await refreshSummary();
      Alert.alert("Provider saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Provider save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const openGatewayOrLocalUrl = async (url: string) => {
    try {
      await api.openUrlOnGateway(url);
      return;
    } catch {
      await Linking.openURL(url);
    }
  };

  const pollOAuthCallback = async (state: string) => {
    const expiresAt = Date.now() + 600_000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const status = await api.providerOAuthCallbackStatus(state);
      if (status.status === "success" && status.access_token) {
        setAccessToken(status.access_token);
        setOauthStatus("Connected. Save this provider to store the token.");
        return;
      }
      if (status.status === "error") {
        throw new Error(status.error || "Authorization failed.");
      }
    }
    throw new Error("Authorization timed out. Please try again.");
  };

  const pollOAuthDeviceCode = async (
    deviceCode: string,
    intervalSeconds: number,
    expiresIn: number
  ) => {
    const intervalMs = Math.max(5, intervalSeconds || 5) * 1000;
    const expiresAt = Date.now() + Math.max(60, expiresIn || 900) * 1000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const status = await api.pollProviderDeviceCodeOAuth(provider.provider, deviceCode);
      if (status.status === "success" && status.access_token) {
        setAccessToken(status.access_token);
        setOauthStatus("Connected. Save this provider to store the token.");
        return;
      }
      if (status.status === "expired" || status.status === "denied" || status.status === "error") {
        throw new Error(
          status.error ||
            (status.status === "denied"
              ? "Authorization was denied."
              : "Authorization expired. Please try again.")
        );
      }
    }
    throw new Error("Authorization timed out. Please try again.");
  };

  const startOAuth = async () => {
    if (!provider.hasOAuthConfig) {
      if (provider.oauthLoginUrl) {
        await Linking.openURL(provider.oauthLoginUrl);
      }
      return;
    }
    setOauthBusy(true);
    setOauthStatus("Starting sign-in...");
    setOauthDeviceCode("");
    try {
      if (provider.oauthFlow === "device_code") {
        const response = await api.startProviderDeviceCodeOAuth(provider.provider);
        setOauthDeviceCode(response.user_code);
        setOauthStatus("Enter the code in the browser window, then keep this screen open.");
        await openGatewayOrLocalUrl(response.verification_uri);
        await pollOAuthDeviceCode(response.device_code, response.interval, response.expires_in);
      } else {
        const response = await api.startProviderOAuth(provider.provider);
        setOauthStatus("Complete sign-in in the browser window, then keep this screen open.");
        await openGatewayOrLocalUrl(response.auth_url);
        await pollOAuthCallback(response.state);
      }
    } catch (error) {
      Alert.alert("OAuth failed", error instanceof Error ? error.message : String(error));
      setOauthStatus("Sign-in failed. Try again.");
    } finally {
      setOauthBusy(false);
    }
  };

  const testProvider = async () => {
    setTesting(true);
    try {
      const result = await api.testProvider(provider.id);
      Alert.alert(
        result.success ? "Provider connected" : "Provider test failed",
        result.message ||
          result.error ||
          (result.success ? "Connection verified." : "Connection failed.")
      );
    } catch (error) {
      Alert.alert("Provider test failed", error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const deleteProvider = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteProvider(provider.id);
      if (result.success === false) throw new Error("The gateway did not delete this provider.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete provider?",
      `${provider.name} will be removed. Agents using this provider may stop working.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteProvider();
          },
        },
      ]
    );
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.blueText}18` }]}>
          <Database color={colors.blueText} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {provider.name}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {`${provider.provider}${provider.is_default ? " - default" : ""}`}
          </Text>
        </View>
      </View>

      {providerPlan ? (
        <View style={styles.settingsInfoBox}>
          <View style={styles.routerSummaryRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsInfoTitle}>Provider plan</Text>
              <Text style={styles.settingsInfoText}>
                {providerPlan.sourceLabel || providerPlan.source || "Local Cybara usage"}
              </Text>
            </View>
            <Text
              style={[
                styles.routerSummaryValue,
                { color: providerPlanStatusTone(providerPlan.status) },
              ]}
            >
              {providerPlan.status}
            </Text>
          </View>
          {providerPlanProgress(providerPlan) !== null ? (
            <MonitorUsageBar
              detail={`${formatMetricNumber(providerPlan.localTokens30d)} tokens tracked over 30d`}
              label={providerPlan.planName || "Usage window"}
              tone={providerPlanStatusTone(providerPlan.status)}
              value={providerPlanProgress(providerPlan) || 0}
            />
          ) : (
            <Text style={styles.settingsInfoText}>
              {formatMetricNumber(providerPlan.localTokens30d)} local tokens over 30 days.
            </Text>
          )}
          {providerPlan.externalSourceAvailable ? (
            <Text style={styles.settingsInfoText}>
              External source available: {providerPlan.externalSourceLabel}.{" "}
              {providerPlan.externalSourceHint}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.settingsForm}>
        <SettingsTextField
          autoCapitalize="words"
          label="Display name"
          onChangeText={setName}
          placeholder="Provider name"
          value={name}
        />
        <SettingsTextField
          help="Only change this for local or self-hosted model providers."
          label="Base URL"
          onChangeText={setBaseUrl}
          placeholder="Provider default"
          value={baseUrl}
        />
        {planMonitoringConfig ? (
          <>
            {planPresets.length > 0 ? (
              <SettingSelector
                label="Plan preset"
                onSelect={applyPlanPreset}
                options={[
                  { label: "Custom / manual", value: "" },
                  ...planPresets.map((preset) => ({ label: preset.label, value: preset.id })),
                ]}
                selected={planPresetId}
                tone={colors.cyan}
                variant="menu"
              />
            ) : null}
            {selectedPlanPreset ? (
              <Text style={styles.settingsFieldHelp}>{selectedPlanPreset.limitDescription}</Text>
            ) : null}
            <SettingsTextField
              help="Subscription coding plans use rolling 5-hour and weekly windows; pay-as-you-go tracks a monthly budget. Leave empty to keep unconfigured."
              label="Plan name"
              onChangeText={setPlanName}
              placeholder="e.g. Pro, Max 5x, Pay-as-you-go"
              value={planName}
            />
            <SettingsTextField
              keyboardType="numeric"
              label="5-hour token limit"
              onChangeText={setPlanFiveHourTokens}
              placeholder="rolling window"
              value={planFiveHourTokens}
            />
            <SettingsTextField
              keyboardType="numeric"
              label="Weekly token limit"
              onChangeText={setPlanWeeklyTokens}
              placeholder="rolling window"
              value={planWeeklyTokens}
            />
            <SettingsTextField
              keyboardType="numeric"
              label="Monthly token limit"
              onChangeText={setPlanMonthlyTokens}
              placeholder="billing month"
              value={planMonthlyTokens}
            />
            <SettingsTextField
              keyboardType="numeric"
              label="Monthly budget"
              onChangeText={setPlanMonthlySpend}
              placeholder="e.g. 100"
              value={planMonthlySpend}
            />
            {routerPricingConfig ? (
              <>
                <SettingsTextField
                  help="Custom per-token pricing overrides catalog prices when estimating spend."
                  keyboardType="decimal-pad"
                  label="$ / 1M input tokens"
                  onChangeText={setPlanPriceInput}
                  placeholder="catalog price"
                  value={planPriceInput}
                />
                <SettingsTextField
                  keyboardType="decimal-pad"
                  label="$ / 1M output tokens"
                  onChangeText={setPlanPriceOutput}
                  placeholder="catalog price"
                  value={planPriceOutput}
                />
              </>
            ) : null}
          </>
        ) : null}
        {usesApiKey ? (
          <SettingsTextField
            help={
              MOBILE_SETTINGS_DETAIL_CHROME.providerCredentialUpdateMode === "blank-keeps-existing"
                ? "Leave blank to keep the saved API key."
                : undefined
            }
            label="API key"
            onChangeText={setApiKey}
            placeholder={provider.hasCredentials ? "Saved credential" : "Paste API key"}
            secureTextEntry
            value={apiKey}
          />
        ) : null}
        {usesOAuth ? (
          <View style={styles.settingsInfoBox}>
            <Text style={styles.settingsInfoTitle}>OAuth provider</Text>
            <Text style={styles.settingsInfoText}>
              {provider.hasOAuthConfig
                ? "Sign in through the gateway. No API key is required."
                : "Paste an access token for this OAuth provider."}
            </Text>
            {provider.hasOAuthConfig || provider.oauthLoginUrl ? (
              <DetailActionButton
                Icon={Link2}
                busy={oauthBusy}
                label={provider.hasOAuthConfig ? "Sign in" : "Open provider"}
                onPress={startOAuth}
                tone={colors.blueText}
              />
            ) : null}
            {oauthDeviceCode ? (
              <Text selectable style={styles.settingsInfoCode}>
                {oauthDeviceCode}
              </Text>
            ) : null}
            {oauthStatus ? <Text style={styles.settingsInfoText}>{oauthStatus}</Text> : null}
            {!provider.hasOAuthConfig ? (
              <SettingsTextField
                help="Leave blank to keep the saved access token."
                label="Access token"
                onChangeText={setAccessToken}
                placeholder={provider.hasCredentials ? "Saved credential" : "Paste access token"}
                secureTextEntry
                value={accessToken}
              />
            ) : null}
          </View>
        ) : null}
        {usesAccessToken ? (
          <SettingsTextField
            help="Leave blank to keep the saved token."
            label="Access token"
            onChangeText={setAccessToken}
            placeholder={provider.hasCredentials ? "Saved credential" : "Paste access token"}
            secureTextEntry
            value={accessToken}
          />
        ) : null}
        {usesAwsSdk || usesNoAuth ? (
          <View style={styles.settingsInfoBox}>
            <Text style={styles.settingsInfoTitle}>
              {usesAwsSdk ? "AWS SDK authentication" : "No authentication required"}
            </Text>
            <Text style={styles.settingsInfoText}>
              {usesAwsSdk
                ? "Use AWS environment variables, CLI profiles, or instance credentials on the gateway."
                : "This provider connects without saved credentials."}
            </Text>
          </View>
        ) : null}
        <SettingToggle
          detail="New chats use this provider when no agent-specific provider is selected."
          label="Default provider"
          onPress={() => setIsDefault((value) => !value)}
          value={isDefault}
        />
      </View>

      <View style={styles.settingsActionRow}>
        <DetailActionButton Icon={Save} busy={saving} label="Save" onPress={saveProvider} />
        <DetailActionButton
          Icon={Zap}
          busy={testing}
          label="Test"
          onPress={testProvider}
          tone={colors.green}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </StableDetailPanel>
  );
}

export function ChannelSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
}) {
  const [name, setName] = useState(item.title);
  const [enabled, setEnabled] = useState(remoteItemEnabled(item));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(item.title);
    setEnabled(remoteItemEnabled(item));
  }, [item]);

  const saveChannel = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the channel a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateChannel(item.id, {
        name: trimmedName,
        enabled,
      });
      if (result.success === false) throw new Error("The gateway did not save this channel.");
      await refreshSummary();
      Alert.alert("Channel saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Channel save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const testChannel = async () => {
    setTesting(true);
    try {
      const result = await api.testChannel(item.id);
      Alert.alert(
        result.success ? "Channel connected" : "Channel test failed",
        result.message ||
          result.error ||
          (result.success ? "Connection verified." : "Connection failed.")
      );
    } catch (error) {
      Alert.alert("Channel test failed", error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const deleteChannel = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteChannel(item.id);
      if (result.success === false) throw new Error("The gateway did not delete this channel.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete channel?", `${item.title} will no longer receive remote messages.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteChannel();
        },
      },
    ]);
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.cyan}18` }]}>
          <Link2 color={colors.cyan} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {item.detail}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingsTextField
          autoCapitalize="words"
          label="Display name"
          onChangeText={setName}
          placeholder="Channel name"
          value={name}
        />
        <SettingToggle
          detail="Disabled channels stay configured but stop handling messages."
          label="Enabled"
          onPress={() => setEnabled((value) => !value)}
          value={enabled}
        />
      </View>

      <View style={styles.settingsActionRow}>
        <DetailActionButton Icon={Save} busy={saving} label="Save" onPress={saveChannel} />
        <DetailActionButton
          Icon={Zap}
          busy={testing}
          label="Test"
          onPress={testChannel}
          tone={colors.green}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </StableDetailPanel>
  );
}

export function TaskSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const running = remoteTaskRunning(item);

  const toggleTask = async () => {
    setToggling(true);
    try {
      const result = running ? await api.stopTask(item.id) : await api.startTask(item.id);
      if (result.success === false) {
        throw new Error(
          running ? "The gateway did not stop this task." : "The gateway did not start this task."
        );
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert("Task action failed", error instanceof Error ? error.message : String(error));
    } finally {
      setToggling(false);
    }
  };

  const runTask = async () => {
    setRunningNow(true);
    try {
      const result = await api.runTask(item.id);
      if (result.success === false) throw new Error("The gateway did not run this task.");
      await refreshSummary();
      Alert.alert("Task started", `${item.title} was triggered.`);
    } catch (error) {
      Alert.alert("Task run failed", error instanceof Error ? error.message : String(error));
    } finally {
      setRunningNow(false);
    }
  };

  const deleteTask = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteTask(item.id);
      if (result.success === false) throw new Error("The gateway did not delete this task.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete task?", `${item.title} will be removed from the scheduler.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteTask();
        },
      },
    ]);
  };

  const fields = [
    ...("status" in item && item.status ? [{ label: "Status", value: item.status }] : []),
    ...("type" in item && item.type ? [{ label: "Type", value: item.type }] : []),
    ...cleanSettingsFields(item.fields),
  ];

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.blueText}18` }]}>
          <CalendarCheck color={colors.blueText} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {item.detail}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingToggle
          busy={toggling}
          detail={
            running
              ? "The scheduler reports this task as running. Tap to stop it."
              : "The scheduler reports this task as stopped. Tap to start it."
          }
          label="Running"
          onPress={toggleTask}
          value={running}
        />
      </View>

      <DetailInfoSection title="Details" fields={fields} />

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={Zap}
          busy={runningNow}
          label="Run now"
          onPress={runTask}
          tone={colors.cyan}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </StableDetailPanel>
  );
}

export function ApprovalSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
}) {
  const [decision, setDecision] = useState<ToolApprovalDecision | null>(null);
  const fields = cleanSettingsFields(item.fields);

  const resolveApproval = async (nextDecision: ToolApprovalDecision) => {
    setDecision(nextDecision);
    try {
      const result = await api.resolveToolApproval(item.id, nextDecision);
      if (result.success === false) {
        throw new Error(result.error || "The gateway did not resolve this approval.");
      }
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Approval failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDecision(null);
    }
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.amber}18` }]}>
          <ShieldAlert color={colors.amber} size={21} strokeWidth={2.2} />
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

      <DetailInfoSection title="Details" fields={fields} />

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={ShieldCheck}
          busy={decision === "approve_once"}
          label="Approve once"
          onPress={() => {
            void resolveApproval("approve_once");
          }}
          tone={colors.green}
        />
        <DetailActionButton
          Icon={ShieldCheck}
          busy={decision === "approve_session"}
          label="Session"
          onPress={() => {
            void resolveApproval("approve_session");
          }}
          tone={colors.cyan}
        />
        <DetailActionButton
          Icon={ShieldCheck}
          busy={decision === "approve_always"}
          label="Always"
          onPress={() => {
            void resolveApproval("approve_always");
          }}
          tone={colors.blueText}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={decision === "deny"}
          label="Deny"
          onPress={() => {
            void resolveApproval("deny");
          }}
          tone={colors.red}
        />
      </View>
    </StableDetailPanel>
  );
}

export function WalletPolicyPanel({
  api,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const [savingPolicyKey, setSavingPolicyKey] = useState<WalletPolicyToggleKey | null>(null);
  const [savingAgentAccess, setSavingAgentAccess] = useState(false);
  const [sendMode, setSendMode] = useState<"native" | "token">("native");
  const [sendChain, setSendChain] = useState<WalletChain>("eth");
  const [tokenChain, setTokenChain] = useState<WalletTokenChain>("eth");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendMemo, setSendMemo] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState("18");
  const [sendingWallet, setSendingWallet] = useState(false);
  const policy = objectRecord(summary?.walletPolicy);
  const status = objectRecord(summary?.walletStatus);
  const agentAccessEnabled = booleanSetting(status, "agentAccessEnabled");
  const policyAvailable = Boolean(policy);
  const statusAvailable = Boolean(status);
  const walletUnlocked = status?.unlocked === true;
  const walletSendReady =
    walletUnlocked &&
    sendTo.trim().length > 0 &&
    sendAmount.trim().length > 0 &&
    (sendMode === "native" || tokenAddress.trim().length > 0);

  const updateAgentAccess = async () => {
    if (!statusAvailable) return;
    const nextValue = !agentAccessEnabled;
    setSavingAgentAccess(true);
    try {
      const result = await api.setWalletAgentAccess(nextValue);
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

  const updatePolicyToggle = async (key: WalletPolicyToggleKey) => {
    if (!policyAvailable) return;
    const payload: WalletAgentPolicyUpdate = {};
    payload[key] = !booleanSetting(policy, key);
    setSavingPolicyKey(key);
    try {
      const result = await api.updateWalletAgentPolicy(payload);
      if (result.success === false) {
        throw new Error("The gateway did not update the wallet agent policy.");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Wallet policy update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSavingPolicyKey(null);
    }
  };

  const submitWalletSend = async () => {
    if (!walletSendReady || sendingWallet) return;
    setSendingWallet(true);
    try {
      const memo = sendMemo.trim() || undefined;
      const decimals = tokenDecimals.trim() ? Number(tokenDecimals.trim()) : undefined;
      if (
        sendMode === "token" &&
        decimals !== undefined &&
        (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
      ) {
        throw new Error("Token decimals must be a whole number from 0 to 18.");
      }
      const result =
        sendMode === "native"
          ? await api.sendWallet({
              chain: sendChain,
              to: sendTo.trim(),
              amount: sendAmount.trim(),
              memo,
            })
          : await api.sendWalletToken({
              chain: tokenChain,
              tokenAddress: tokenAddress.trim(),
              to: sendTo.trim(),
              amount: sendAmount.trim(),
              decimals,
              memo,
            });

      if (!result.txid) {
        throw new Error("The gateway did not return a transaction id.");
      }
      setSendTo("");
      setSendAmount("");
      setSendMemo("");
      setTokenAddress("");
      Alert.alert(
        "Wallet send submitted",
        result.explorerUrl ? `${result.txid}\n${result.explorerUrl}` : result.txid
      );
      await refreshSummary();
    } catch (error) {
      Alert.alert("Wallet send failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSendingWallet(false);
    }
  };

  const confirmWalletSend = () => {
    if (!walletSendReady || sendingWallet) return;
    const assetLabel =
      sendMode === "native" ? sendChain.toUpperCase() : `${tokenChain.toUpperCase()} token`;
    haptics.warning();
    Alert.alert(
      "Confirm wallet send",
      `Send ${sendAmount.trim()} ${assetLabel} to ${sendTo.trim()}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send", style: "destructive", onPress: () => void submitWalletSend() },
      ]
    );
  };

  const policyDetails = [
    { label: "ETH contract allowlist", value: arraySettingCount(policy, "allowedEthContracts") },
    { label: "Solana program allowlist", value: arraySettingCount(policy, "allowedSolPrograms") },
    { label: "Dapp host allowlist", value: arraySettingCount(policy, "allowedDappHosts") },
    { label: "x402 networks", value: arraySettingCount(policy, "allowedX402Networks") },
    {
      label: "Send recipient allowlist",
      value: arraySettingCount(policy, "allowedSendRecipients"),
    },
    {
      label: "Max send amount",
      value: formatMobileValue(policy?.maxSendAmount, "No cap"),
    },
    {
      label: "x402 max amount",
      value: formatMobileValue(policy?.x402MaxAmountAtomic, "Default"),
    },
  ];
  const statusFields = cleanSettingsFields(displayFields(status || {})).filter(
    (field) =>
      field.label !== "Agent Access Enabled" &&
      field.label !== "Primary Addresses" &&
      field.label !== "Kdf"
  );

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.green}18` }]}>
          <ShieldCheck color={colors.green} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.itemDetail}>
            {policyAvailable || statusAvailable
              ? "Agent wallet access and policy limits"
              : item.detail}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingToggle
          busy={savingAgentAccess}
          disabled={!statusAvailable || savingPolicyKey !== null}
          detail="Master switch for agent-initiated wallet actions."
          label="Agent wallet access"
          onPress={updateAgentAccess}
          value={agentAccessEnabled}
        />
        {walletPolicyToggleRows.map((toggle) => (
          <SettingToggle
            busy={savingPolicyKey === toggle.key}
            detail={toggle.detail}
            disabled={!policyAvailable || savingAgentAccess || savingPolicyKey !== null}
            key={toggle.key}
            label={toggle.label}
            onPress={() => {
              void updatePolicyToggle(toggle.key);
            }}
            value={booleanSetting(policy, toggle.key)}
          />
        ))}
      </View>

      <Text style={styles.subsectionTitle}>Send</Text>
      <View style={styles.settingsForm}>
        {statusAvailable ? (
          walletUnlocked ? (
            <>
              <SettingSelector
                disabled={sendingWallet}
                label="Send type"
                onSelect={(value) => setSendMode(value === "token" ? "token" : "native")}
                options={[
                  { label: "Native asset", value: "native" },
                  { label: "Token", value: "token" },
                ]}
                selected={sendMode}
                tone={colors.green}
                variant="segmented"
              />
              <SettingSelector
                disabled={sendingWallet}
                label={sendMode === "native" ? "Chain" : "Token chain"}
                onSelect={(value) => {
                  if (sendMode === "native") {
                    setSendChain(value as WalletChain);
                  } else {
                    setTokenChain(value === "sol" ? "sol" : "eth");
                  }
                }}
                options={
                  sendMode === "native"
                    ? [
                        { label: "ETH", value: "eth" },
                        { label: "BTC", value: "btc" },
                        { label: "SOL", value: "sol" },
                      ]
                    : [
                        { label: "ETH", value: "eth" },
                        { label: "SOL", value: "sol" },
                      ]
                }
                selected={sendMode === "native" ? sendChain : tokenChain}
                tone={colors.green}
                variant="menu"
              />
              {sendMode === "token" ? (
                <>
                  <SettingsTextField
                    label="Token address"
                    onChangeText={setTokenAddress}
                    placeholder={tokenChain === "eth" ? "0x..." : "Mint address"}
                    value={tokenAddress}
                  />
                  <SettingsTextField
                    label="Token decimals"
                    onChangeText={setTokenDecimals}
                    placeholder="18"
                    value={tokenDecimals}
                  />
                </>
              ) : null}
              <SettingsTextField
                label="Recipient"
                onChangeText={setSendTo}
                placeholder="Wallet address"
                value={sendTo}
              />
              <SettingsTextField
                label="Amount"
                onChangeText={setSendAmount}
                placeholder="0.01"
                value={sendAmount}
              />
              <SettingsTextField
                label="Memo"
                onChangeText={setSendMemo}
                placeholder="Optional"
                value={sendMemo}
              />
              <View style={styles.settingsActionRow}>
                <DetailActionButton
                  Icon={Send}
                  busy={sendingWallet}
                  disabled={!walletSendReady}
                  label="Review Send"
                  onPress={confirmWalletSend}
                  tone={colors.green}
                />
              </View>
            </>
          ) : (
            <EmptyState
              label="Wallet locked"
              detail="Unlock the wallet from the desktop or web wallet screen before sending."
            />
          )
        ) : !summary ? (
          <LoadingState label="Loading wallet" detail="Fetching wallet status from the gateway." />
        ) : (
          <EmptyState
            label="Wallet status unavailable"
            detail={endpointErrorDetail(
              summary?.availability.walletStatus,
              "The gateway did not return wallet status."
            )}
          />
        )}
      </View>

      <Text style={styles.subsectionTitle}>Policy limits</Text>
      {policyAvailable ? (
        <View>
          {policyDetails.map((field) => (
            <View key={field.label} style={styles.listRow}>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{field.label}</Text>
                <Text numberOfLines={1} style={styles.listDetail}>
                  {field.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : !summary ? (
        <LoadingState label="Loading policy" detail="Fetching wallet policy from the gateway." />
      ) : (
        <EmptyState
          label="Wallet policy unavailable"
          detail={endpointErrorDetail(
            summary?.availability.walletPolicy,
            "The gateway did not return wallet policy settings."
          )}
        />
      )}

      <DetailInfoSection title="Wallet status" fields={statusFields} />
    </StableDetailPanel>
  );
}

export function MonitorUsageBar({
  detail,
  label,
  tone,
  value,
}: {
  detail?: string;
  label: string;
  tone: string;
  value: number | null | undefined;
}) {
  const pct = monitorPercent(value);
  return (
    <View style={styles.monitorUsageRow}>
      <View style={styles.monitorUsageHeader}>
        <Text style={styles.listTitle}>{label}</Text>
        <Text style={[styles.counterText, { color: tone }]}>{monitorPercentLabel(value)}</Text>
      </View>
      <View style={styles.monitorUsageTrack}>
        <View style={[styles.monitorUsageFill, { backgroundColor: tone, width: `${pct}%` }]} />
      </View>
      {detail ? <Text style={styles.listDetail}>{detail}</Text> : null}
    </View>
  );
}

export function SystemMonitorDetailPanel({
  item,
  refreshSummary,
  summary,
}: {
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const [refreshingMonitor, setRefreshingMonitor] = useState(false);
  const snapshot = summary?.systemMonitor ?? null;
  const disk = snapshot?.disk ?? null;
  const fields = (() => {
    if (!snapshot) return cleanSettingsFields(item.fields);
    if (item.id === "cpu") {
      return [
        { label: "Model", value: snapshot.cpu.model },
        { label: "Cores", value: String(snapshot.cpu.cores) },
        { label: "Load average", value: snapshot.cpu.loadAverage.join(", ") },
        { label: "Load", value: monitorPercentLabel(snapshot.cpu.loadPct) },
      ];
    }
    if (item.id === "memory") {
      const fields = [
        { label: "Total", value: formatMetricBytes(snapshot.memory.totalBytes) },
        { label: "Used", value: formatMetricBytes(snapshot.memory.usedBytes) },
        { label: "Free", value: formatMetricBytes(snapshot.memory.freeBytes) },
      ];
      if (snapshot.memory.swap) {
        fields.push({
          label: "Swap used",
          value: `${formatMetricBytes(snapshot.memory.swap.usedBytes)} of ${formatMetricBytes(snapshot.memory.swap.totalBytes)}`,
        });
      }
      return fields;
    }
    if (item.id === "swap" && snapshot.memory.swap) {
      return [
        { label: "Total", value: formatMetricBytes(snapshot.memory.swap.totalBytes) },
        { label: "Used", value: formatMetricBytes(snapshot.memory.swap.usedBytes) },
        { label: "Free", value: formatMetricBytes(snapshot.memory.swap.freeBytes) },
      ];
    }
    if (item.id === "process") {
      return [
        { label: "PID", value: String(snapshot.process.pid) },
        { label: "Uptime", value: formatUptime(snapshot.process.uptimeSeconds) },
        { label: "RSS", value: formatMetricBytes(snapshot.process.memory.rssBytes) },
        { label: "Heap used", value: formatMetricBytes(snapshot.process.memory.heapUsedBytes) },
        { label: "Heap total", value: formatMetricBytes(snapshot.process.memory.heapTotalBytes) },
        { label: "External", value: formatMetricBytes(snapshot.process.memory.externalBytes) },
      ];
    }
    if (item.id === "disk" && disk) {
      return [
        { label: "Path", value: disk.path },
        { label: "Total", value: formatStorageBytes(disk.totalBytes) },
        { label: "Used", value: formatStorageBytes(disk.usedBytes) },
        { label: "Free", value: formatStorageBytes(disk.freeBytes) },
      ];
    }
    return [
      { label: "Platform", value: snapshot.platform.type },
      { label: "Architecture", value: snapshot.platform.arch },
      { label: "Release", value: snapshot.platform.release },
      { label: "Snapshot", value: absoluteTimestampLabel(snapshot.timestamp) },
      { label: "Sample interval", value: `${snapshot.sampleIntervalMs}ms` },
    ];
  })();

  const refreshMonitor = async () => {
    setRefreshingMonitor(true);
    try {
      await refreshSummary();
    } finally {
      setRefreshingMonitor(false);
    }
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.blueText}18` }]}>
          <Cpu color={colors.blueText} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.itemDetail}>
            {snapshot ? item.detail : "Waiting for system telemetry from the gateway"}
          </Text>
        </View>
      </View>

      {snapshot ? (
        <View style={styles.settingsForm}>
          {item.id === "cpu" ? (
            <>
              <MonitorUsageBar
                detail={`${snapshot.cpu.cores} cores - ${snapshot.cpu.model}`}
                label="CPU usage"
                tone={colors.blueText}
                value={snapshot.cpu.usagePct}
              />
              <MonitorUsageBar
                detail={
                  snapshot.platform.type === "win32"
                    ? "Load average unavailable on Windows"
                    : "1-minute normalized load"
                }
                label="CPU load"
                tone={colors.cyan}
                value={snapshot.cpu.loadPct}
              />
            </>
          ) : null}
          {item.id === "memory" ? (
            <MonitorUsageBar
              detail={`${formatMetricBytes(snapshot.memory.usedBytes)} of ${formatMetricBytes(snapshot.memory.totalBytes)} used`}
              label="Memory used"
              tone={colors.green}
              value={snapshot.memory.usedPct}
            />
          ) : null}
          {item.id === "swap" && snapshot.memory.swap ? (
            <MonitorUsageBar
              detail={`${formatMetricBytes(snapshot.memory.swap.usedBytes)} of ${formatMetricBytes(snapshot.memory.swap.totalBytes)} used`}
              label="Swap used"
              tone={colors.amber}
              value={snapshot.memory.swap.usedPct}
            />
          ) : null}
          {item.id === "process" ? (
            <>
              <MonitorUsageBar
                detail="Cybara gateway process CPU"
                label="Process CPU"
                tone={colors.amber}
                value={snapshot.process.cpuUsagePct}
              />
              <MonitorUsageBar
                detail={`${formatMetricBytes(snapshot.process.memory.heapUsedBytes)} of ${formatMetricBytes(snapshot.process.memory.heapTotalBytes)} heap used`}
                label="Heap used"
                tone={colors.cyan}
                value={
                  (snapshot.process.memory.heapUsedBytes /
                    Math.max(1, snapshot.process.memory.heapTotalBytes)) *
                  100
                }
              />
            </>
          ) : null}
          {item.id === "disk" && disk ? (
            <MonitorUsageBar
              detail={`${formatStorageBytes(disk.usedBytes)} of ${formatStorageBytes(disk.totalBytes)} used`}
              label="Disk used"
              tone={colors.blueText}
              value={disk.usedPct}
            />
          ) : null}
        </View>
      ) : !summary ? (
        <LoadingState
          label="Loading telemetry"
          detail="Fetching host telemetry from the gateway."
        />
      ) : (
        <EmptyState
          label="System telemetry unavailable"
          detail={endpointErrorDetail(
            summary?.availability.systemMonitor,
            "The gateway did not return host system telemetry."
          )}
        />
      )}

      <DetailInfoSection title="Details" fields={fields} />

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={RefreshCw}
          busy={refreshingMonitor}
          label="Refresh"
          onPress={() => {
            void refreshMonitor();
          }}
          tone={colors.blueText}
        />
      </View>
    </StableDetailPanel>
  );
}

export function ModelRouterPanel({
  api,
  accentColor,
  summary,
}: {
  api: CybaraMobileApi;
  accentColor: string;
  summary: FeatureSummary | null;
}) {
  const [routerConfig, setRouterConfig] = useState<RouterConfig | null>(null);
  const [routerStatus, setRouterStatus] = useState<RouterStatus | null>(null);
  const [planConfig, setPlanConfig] = useState<ProviderPlanMonitoringConfig | null>(null);
  const [planStatus, setPlanStatus] = useState<ProviderPlanStatusResponse | null>(null);
  const [routerError, setRouterError] = useState<string | null>(null);
  const [routerDailyLimitDraft, setRouterDailyLimitDraft] = useState("");
  const [moaMaxAgentsDraft, setMoaMaxAgentsDraft] = useState("");
  const [monthlyTokenDrafts, setMonthlyTokenDrafts] = useState<Record<string, string>>({});
  const [monthlySpendDrafts, setMonthlySpendDrafts] = useState<Record<string, string>>({});
  const [savingRouterConfig, setSavingRouterConfig] = useState(false);

  const routerStrategy = readMobileRouterStrategy(routerConfig?.strategy);
  const routerRouteCount =
    routerStatus?.routes.length ?? Object.keys(routerConfig?.routes ?? {}).length;
  const routerAvailableCount = routerStatus?.routes.filter((route) => route.available).length;
  const routerSpendToday =
    typeof routerStatus?.globalSpendToday === "number" ? routerStatus.globalSpendToday : null;
  const planByRoute = new Map<string, ProviderPlanStatusResponse["providers"][number]>();
  for (const plan of planStatus?.providers || []) {
    for (const key of [plan.providerId, plan.configuredProviderId, plan.providerType]) {
      if (key && !planByRoute.has(key)) planByRoute.set(key, plan);
    }
  }

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [nextConfig, nextStatus, nextPlanConfig, nextPlanStatus] = await Promise.all([
          api.routerConfig(),
          api.routerStatus().catch(() => null),
          api.providerPlanConfig().catch(() => null),
          api.providerPlanStatus().catch(() => null),
        ]);
        if (!mounted) return;
        setRouterConfig(nextConfig);
        setRouterStatus(nextStatus);
        setPlanConfig(nextPlanConfig);
        setPlanStatus(nextPlanStatus);
        setRouterDailyLimitDraft(
          nextConfig.globalSpendLimitDaily && nextConfig.globalSpendLimitDaily > 0
            ? String(nextConfig.globalSpendLimitDaily)
            : ""
        );
        setMoaMaxAgentsDraft(nextConfig.moaMaxAgents ? String(nextConfig.moaMaxAgents) : "");
        if (nextPlanConfig) {
          const tokenDrafts: Record<string, string> = {};
          const spendDrafts: Record<string, string> = {};
          for (const [key, providerConfig] of Object.entries(nextPlanConfig.providers)) {
            if (providerConfig.monthly?.tokenLimit) {
              tokenDrafts[key] = String(providerConfig.monthly.tokenLimit);
            }
            if (providerConfig.monthly?.spendLimit) {
              spendDrafts[key] = String(providerConfig.monthly.spendLimit);
            }
          }
          setMonthlyTokenDrafts(tokenDrafts);
          setMonthlySpendDrafts(spendDrafts);
        }
        setRouterError(null);
      } catch (error) {
        if (mounted) setRouterError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [api]);

  const saveRouterConfigPatch = async (patch: Partial<RouterConfig>) => {
    if (!routerConfig || savingRouterConfig) return;
    const previous = routerConfig;
    const next = { ...routerConfig, ...patch };
    setRouterConfig(next);
    setSavingRouterConfig(true);
    setRouterError(null);
    try {
      const result = await api.updateRouterConfig(next);
      if (result.success === false) throw new Error("Router config update failed");
      const nextStatus = await api.routerStatus().catch(() => null);
      setRouterStatus(nextStatus);
    } catch (error) {
      setRouterConfig(previous);
      setRouterError(error instanceof Error ? error.message : String(error));
      Alert.alert("Router update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRouterConfig(false);
    }
  };

  const savePlanConfigPatch = async (
    providerKey: string,
    patch: Partial<NonNullable<ProviderPlanMonitoringConfig["providers"][string]>>
  ) => {
    if (!planConfig || savingRouterConfig) return;
    const previous = planConfig;
    const current = planConfig.providers?.[providerKey] || {};
    const next: ProviderPlanMonitoringConfig = {
      ...planConfig,
      providers: {
        ...(planConfig.providers || {}),
        [providerKey]: {
          ...current,
          ...patch,
          monthly: patch.monthly
            ? { ...(current.monthly || {}), ...patch.monthly }
            : current.monthly,
        },
      },
    };
    setPlanConfig(next);
    setSavingRouterConfig(true);
    setRouterError(null);
    try {
      const saved = await api.updateProviderPlanConfig(next);
      setPlanConfig(saved);
      setPlanStatus(await api.providerPlanStatus().catch(() => null));
    } catch (error) {
      setPlanConfig(previous);
      setRouterError(error instanceof Error ? error.message : String(error));
      Alert.alert("Plan update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRouterConfig(false);
    }
  };

  const savePlanGlobalPatch = async (patch: Partial<ProviderPlanMonitoringConfig>) => {
    if (!planConfig || savingRouterConfig) return;
    const previous = planConfig;
    const next: ProviderPlanMonitoringConfig = {
      ...planConfig,
      ...patch,
      providers: patch.providers || planConfig.providers || {},
    };
    setPlanConfig(next);
    setSavingRouterConfig(true);
    setRouterError(null);
    try {
      const saved = await api.updateProviderPlanConfig(next);
      setPlanConfig(saved);
      setPlanStatus(await api.providerPlanStatus().catch(() => null));
    } catch (error) {
      setPlanConfig(previous);
      setRouterError(error instanceof Error ? error.message : String(error));
      Alert.alert("Plan update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRouterConfig(false);
    }
  };

  const applyProviderPlanPreset = async (
    route: RouterStatus["routes"][number],
    preset: ProviderPlanStatusResponse["providers"][number]["presetSuggestions"][number]
  ) => {
    if (!planConfig || !routerConfig || savingRouterConfig) return;
    const previousPlan = planConfig;
    const previousRouter = routerConfig;
    const currentProviderPlan = planConfig.providers?.[route.providerId] || {};
    const nextProviderPlan: NonNullable<ProviderPlanMonitoringConfig["providers"][string]> = {
      ...currentProviderPlan,
      enabled: true,
      presetId: preset.id,
      planName: preset.planName,
      sourceMode: preset.sourceMode,
      externalSourceEnabled: preset.externalSourceEnabled,
    };
    if (preset.monthlyTokenLimit || preset.monthlySpendLimit) {
      nextProviderPlan.monthly = {
        ...(nextProviderPlan.monthly || {}),
        enabled: true,
        tokenLimit: preset.monthlyTokenLimit,
        spendLimit: preset.monthlySpendLimit,
      };
    }
    if (preset.weeklyTokenLimit) {
      nextProviderPlan.weekly = {
        ...(nextProviderPlan.weekly || {}),
        enabled: true,
        tokenLimit: preset.weeklyTokenLimit,
      };
    }
    if (preset.fiveHourTokenLimit) {
      nextProviderPlan.fiveHour = {
        ...(nextProviderPlan.fiveHour || {}),
        enabled: true,
        tokenLimit: preset.fiveHourTokenLimit,
      };
    }
    const nextPlan: ProviderPlanMonitoringConfig = {
      ...planConfig,
      providers: {
        ...(planConfig.providers || {}),
        [route.providerId]: nextProviderPlan,
      },
    };
    const routePatch: Partial<RouterConfig["routes"][string]> = {};
    if (preset.routeLimit5h) routePatch.limit5h = preset.routeLimit5h;
    if (preset.routeLimitWeekly) routePatch.limitWeekly = preset.routeLimitWeekly;
    const currentRoute = routerConfig.routes?.[route.providerId] || {};
    const nextRouter: RouterConfig = {
      ...routerConfig,
      routes: {
        ...(routerConfig.routes || {}),
        [route.providerId]: { ...currentRoute, ...routePatch },
      },
    };
    setPlanConfig(nextPlan);
    setRouterConfig(nextRouter);
    setMonthlyTokenDrafts((current) => ({
      ...current,
      [route.providerId]: preset.monthlyTokenLimit ? String(preset.monthlyTokenLimit) : "",
    }));
    setMonthlySpendDrafts((current) => ({
      ...current,
      [route.providerId]: preset.monthlySpendLimit ? String(preset.monthlySpendLimit) : "",
    }));
    setSavingRouterConfig(true);
    setRouterError(null);
    try {
      const savedPlan = await api.updateProviderPlanConfig(nextPlan);
      if (Object.keys(routePatch).length > 0) {
        const routerResult = await api.updateRouterConfig(nextRouter);
        if (routerResult.success === false) throw new Error("Router config update failed");
      }
      setPlanConfig(savedPlan);
      setPlanStatus(await api.providerPlanStatus().catch(() => null));
      setRouterStatus(await api.routerStatus().catch(() => null));
    } catch (error) {
      setPlanConfig(previousPlan);
      setRouterConfig(previousRouter);
      setRouterError(error instanceof Error ? error.message : String(error));
      Alert.alert("Preset update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRouterConfig(false);
    }
  };

  const saveRouterDailyLimit = () => {
    if (!routerConfig) return;
    const trimmed = routerDailyLimitDraft.trim();
    const numeric = trimmed.length > 0 ? Number(trimmed) : 0;
    const nextLimit = Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
    const currentLimit =
      routerConfig.globalSpendLimitDaily && routerConfig.globalSpendLimitDaily > 0
        ? routerConfig.globalSpendLimitDaily
        : undefined;
    if (nextLimit === currentLimit) return;
    void saveRouterConfigPatch({ globalSpendLimitDaily: nextLimit });
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${accentColor}18` }]}>
          <Network color={accentColor} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text style={styles.itemTitle}>Model Router</Text>
          <Text style={styles.itemDetail}>
            Route chats across providers with fallback and selection strategies
          </Text>
        </View>
      </View>

      {routerConfig ? (
        <>
          <View style={styles.settingsGroup}>
            <SettingToggle
              busy={savingRouterConfig}
              detail="Route chats across configured model providers with fallback rules."
              disabled={savingRouterConfig}
              label="Model router"
              onPress={() => {
                void saveRouterConfigPatch({ enabled: !routerConfig.enabled });
              }}
              tone={accentColor}
              value={routerConfig.enabled}
            />
            <SettingSelector
              disabled={savingRouterConfig}
              label="Selection strategy"
              variant="menu"
              onSelect={(value) => {
                void saveRouterConfigPatch({ strategy: readMobileRouterStrategy(value) });
              }}
              options={MOBILE_ROUTER_STRATEGY_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              selected={routerStrategy}
              tone={accentColor}
            />
            {routerStrategy === "mixture_of_agents" ? (
              <>
                <View style={styles.settingsSegmentField}>
                  <Text style={styles.settingsFieldLabel}>Max proposer agents</Text>
                  <TextInput
                    editable={!savingRouterConfig}
                    keyboardType="number-pad"
                    onBlur={() => {
                      const n = Math.floor(Number(moaMaxAgentsDraft.trim()));
                      const next = Number.isFinite(n) && n > 0 ? n : undefined;
                      if (next !== routerConfig.moaMaxAgents) {
                        void saveRouterConfigPatch({ moaMaxAgents: next });
                      }
                    }}
                    onChangeText={setMoaMaxAgentsDraft}
                    placeholder="4"
                    placeholderTextColor={colors.textDim}
                    returnKeyType="done"
                    style={styles.settingsInput}
                    value={moaMaxAgentsDraft}
                  />
                  <Text style={styles.settingsFieldHelp}>
                    How many agents propose before one synthesizes the answer.
                  </Text>
                </View>
                <SettingSelector
                  disabled={savingRouterConfig}
                  label="Aggregator agent"
                  variant="menu"
                  onSelect={(value) => {
                    void saveRouterConfigPatch({
                      moaAggregatorAgentId: value === "auto" ? undefined : value,
                    });
                  }}
                  options={[
                    { label: "Auto (first proposer)", value: "auto" },
                    ...(summary?.agents ?? []).map((agent) => ({
                      label: agent.name || agent.id,
                      value: agent.id,
                    })),
                  ]}
                  selected={routerConfig.moaAggregatorAgentId || "auto"}
                  tone={accentColor}
                />
              </>
            ) : null}
            <SettingToggle
              busy={savingRouterConfig}
              detail="Use any healthy provider when configured routes are unavailable."
              disabled={savingRouterConfig}
              label="Fallback providers"
              onPress={() => {
                void saveRouterConfigPatch({ fallbackToAny: !routerConfig.fallbackToAny });
              }}
              tone={accentColor}
              value={routerConfig.fallbackToAny}
            />
            <View style={styles.settingsSegmentField}>
              <Text style={styles.settingsFieldLabel}>Daily spend cap</Text>
              <TextInput
                editable={!savingRouterConfig}
                keyboardType="decimal-pad"
                onBlur={saveRouterDailyLimit}
                onChangeText={setRouterDailyLimitDraft}
                placeholder="No cap"
                placeholderTextColor={colors.textDim}
                returnKeyType="done"
                style={styles.settingsInput}
                value={routerDailyLimitDraft}
              />
              <Text style={styles.settingsFieldHelp}>USD per day. Leave blank for no cap.</Text>
            </View>
          </View>

          <DetailInfoSection
            title="Status"
            fields={[
              { label: "Providers in rotation", value: String(routerRouteCount) },
              {
                label: "Available now",
                value:
                  routerAvailableCount === undefined ? "Unknown" : String(routerAvailableCount),
              },
              { label: "Strategy", value: routerStrategy.replace(/_/g, " ") },
              {
                label: "Spent today",
                value: routerSpendToday === null ? "Unknown" : `$${routerSpendToday.toFixed(4)}`,
              },
              {
                label: "Daily cap",
                value:
                  routerConfig.globalSpendLimitDaily && routerConfig.globalSpendLimitDaily > 0
                    ? `$${routerConfig.globalSpendLimitDaily}`
                    : "None",
              },
            ]}
          />
          <SettingsSection title="Provider plans">
            <View style={styles.settingsGroup}>
              <SettingToggle
                busy={savingRouterConfig}
                detail="Track local usage against coding-plan windows and preset limits."
                disabled={savingRouterConfig || !planConfig}
                label="Monitor coding plans"
                onPress={() => {
                  void savePlanGlobalPatch({ enabled: !(planConfig?.enabled ?? true) });
                }}
                tone={accentColor}
                value={planConfig?.enabled ?? planStatus?.enabled ?? true}
              />
              <SettingToggle
                busy={savingRouterConfig}
                detail="Skip a provider automatically when its configured plan reaches the hard stop."
                disabled={savingRouterConfig || !planConfig}
                label="Block exhausted plans"
                onPress={() => {
                  void savePlanGlobalPatch({
                    routerEnforcement: !(planConfig?.routerEnforcement ?? true),
                  });
                }}
                tone={accentColor}
                value={planConfig?.routerEnforcement ?? planStatus?.routerEnforcement ?? true}
              />
            </View>
            <DetailInfoSection
              title="Plan monitor"
              fields={[
                { label: "Monitored", value: String(planStatus?.summary?.monitored ?? 0) },
                { label: "Configured", value: String(planStatus?.summary?.configured ?? 0) },
                { label: "Warnings", value: String(planStatus?.summary?.warnings ?? 0) },
                { label: "Exhausted", value: String(planStatus?.summary?.exhausted ?? 0) },
              ]}
            />
            {(routerStatus?.routes || []).slice(0, 6).map((route) => {
              const plan = planByRoute.get(route.providerId);
              const providerPlanConfig = planConfig?.providers?.[route.providerId] || {};
              const monthly = providerPlanConfig.monthly || {};
              const presetSuggestions = plan?.presetSuggestions || [];
              const selectedPreset =
                providerPlanConfig.presetId || plan?.appliedPresetId || "manual";
              const selectedPresetSummary = presetSuggestions.find(
                (preset) => preset.id === selectedPreset
              );
              const tokenDraft =
                monthlyTokenDrafts[route.providerId] ??
                (monthly.tokenLimit ? String(monthly.tokenLimit) : "");
              const spendDraft =
                monthlySpendDrafts[route.providerId] ??
                (monthly.spendLimit ? String(monthly.spendLimit) : "");
              const firstWindow = plan?.windows[0];
              return (
                <View key={route.providerId} style={styles.settingsSegmentField}>
                  <Text style={styles.settingsFieldLabel}>
                    {plan?.providerName || route.providerId}
                  </Text>
                  <Text style={styles.settingsFieldHelp}>
                    {plan
                      ? `${plan.status} - ${firstWindow?.usedPercent?.toFixed(1) ?? "0"}% used`
                      : "No plan snapshot yet"}
                  </Text>
                  {presetSuggestions.length > 0 ? (
                    <>
                      <SettingSelector
                        disabled={savingRouterConfig}
                        label="Coding plan"
                        variant="menu"
                        onSelect={(value) => {
                          if (value === "manual") {
                            void savePlanConfigPatch(route.providerId, { presetId: undefined });
                            return;
                          }
                          const preset = presetSuggestions.find(
                            (candidate) => candidate.id === value
                          );
                          if (preset) void applyProviderPlanPreset(route, preset);
                        }}
                        options={[
                          { label: "Manual / custom", value: "manual" },
                          ...presetSuggestions.map((preset) => ({
                            label: `${preset.label} - ${providerPlanPresetLimitLabel(preset)}`,
                            value: preset.id,
                          })),
                        ]}
                        selected={selectedPreset}
                        tone={accentColor}
                      />
                      <Text style={styles.settingsFieldHelp}>
                        {selectedPresetSummary?.limitDescription ||
                          "Choose a preset, then override the manual caps below if needed."}
                      </Text>
                    </>
                  ) : null}
                  <View style={styles.settingsActionRow}>
                    <TextInput
                      editable={!savingRouterConfig}
                      keyboardType="number-pad"
                      onBlur={() => {
                        const parsed = Number(tokenDraft.trim());
                        void savePlanConfigPatch(route.providerId, {
                          monthly: {
                            enabled: true,
                            tokenLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
                          },
                        });
                      }}
                      onChangeText={(value) =>
                        setMonthlyTokenDrafts((current) => ({
                          ...current,
                          [route.providerId]: value,
                        }))
                      }
                      placeholder="Monthly tokens"
                      placeholderTextColor={colors.textDim}
                      returnKeyType="done"
                      style={[styles.settingsInput, { flex: 1 }]}
                      value={tokenDraft}
                    />
                    <TextInput
                      editable={!savingRouterConfig}
                      keyboardType="decimal-pad"
                      onBlur={() => {
                        const parsed = Number(spendDraft.trim());
                        void savePlanConfigPatch(route.providerId, {
                          monthly: {
                            enabled: true,
                            spendLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
                          },
                        });
                      }}
                      onChangeText={(value) =>
                        setMonthlySpendDrafts((current) => ({
                          ...current,
                          [route.providerId]: value,
                        }))
                      }
                      placeholder="Monthly $"
                      placeholderTextColor={colors.textDim}
                      returnKeyType="done"
                      style={[styles.settingsInput, { flex: 1 }]}
                      value={spendDraft}
                    />
                  </View>
                </View>
              );
            })}
          </SettingsSection>
          {routerError ? <Text style={styles.errorText}>{routerError}</Text> : null}
        </>
      ) : !routerError ? (
        <LoadingState label="Loading router" detail="Fetching model router settings." />
      ) : (
        <EmptyState label="Router unavailable" detail={routerError} />
      )}
    </StableDetailPanel>
  );
}

export function GatewayManagementPanel({
  api,
  openLogs,
  profile,
  refreshSummary,
  summary,
  onProfileUpdated,
}: {
  api: CybaraMobileApi;
  openLogs: () => void;
  profile: GatewayProfile;
  refreshSummary: () => void | Promise<void>;
  summary: FeatureSummary | null;
  onProfileUpdated?: (profile: GatewayProfile) => void | Promise<void>;
}) {
  const [authSettings, setAuthSettings] = useState<GatewayAuthSettings | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const recentLogs = summary?.logs.slice(0, 4) ?? [];

  const loadAuthSettings = useCallback(async () => {
    setBusyAction((current) => current ?? "auth-load");
    setAuthError(null);
    try {
      const settings = await api.gatewayAuthSettings();
      setAuthSettings(settings);
    } catch (error) {
      setAuthSettings(null);
      setAuthError(gatewayActionError(error, "Auth settings unavailable."));
    } finally {
      setBusyAction((current) => (current === "auth-load" ? null : current));
    }
  }, [api]);

  useEffect(() => {
    void loadAuthSettings();
  }, [loadAuthSettings, profile.id]);

  const revealKey = async () => {
    if (revealedKey) {
      setRevealedKey(null);
      return;
    }
    setBusyAction("reveal");
    try {
      const result = await api.revealGatewayApiKey();
      if (!result.apiKey) throw new Error("No API key is configured.");
      setRevealedKey(result.apiKey);
    } catch (error) {
      Alert.alert("Reveal failed", gatewayActionError(error, "API key reveal failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const copyKey = async () => {
    setBusyAction("copy");
    try {
      let key = revealedKey;
      if (!key) {
        const result = await api.revealGatewayApiKey();
        key = result.apiKey;
      }
      if (!key) throw new Error("No API key is configured.");
      await Clipboard.setStringAsync(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      Alert.alert("Copy failed", gatewayActionError(error, "API key copy failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const rotateKey = async () => {
    setBusyAction("rotate");
    try {
      const result = await api.rotateGatewayApiKey();
      if (!result.apiKey) throw new Error("Gateway did not return a replacement key.");
      const nextProfile = {
        ...profile,
        apiKey: result.apiKey,
        lastConnectedAt: new Date().toISOString(),
      };
      api.setApiKey(result.apiKey);
      if (onProfileUpdated) {
        await onProfileUpdated(nextProfile);
      } else {
        await saveProfile(nextProfile);
      }
      setRevealedKey(result.apiKey);
      await loadAuthSettings();
      Alert.alert("API key rotated", "This device has adopted the new key.");
    } catch (error) {
      Alert.alert("Rotation failed", gatewayActionError(error, "API key rotation failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const confirmRotateKey = () => {
    Alert.alert(
      "Rotate API key?",
      "The current root key stops working immediately. This device adopts the new key if the gateway allows the rotation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rotate",
          style: "destructive",
          onPress: () => {
            void rotateKey();
          },
        },
      ]
    );
  };

  const updateRequireLocalhost = async () => {
    if (!authSettings || authSettings.requireAuthForLocalhostForced) return;
    const next = !authSettings.requireAuthForLocalhost;
    setBusyAction("localhost");
    try {
      const settings = await api.updateGatewayAuthSettings({ requireAuthForLocalhost: next });
      setAuthSettings(settings);
    } catch (error) {
      Alert.alert("Auth setting failed", gatewayActionError(error, "Auth setting update failed."));
      await loadAuthSettings();
    } finally {
      setBusyAction(null);
    }
  };

  const restartGateway = async () => {
    setRestartBusy(true);
    try {
      const result = await api.restartGateway();
      if (result.success === false) throw new Error(result.message || "Gateway restart failed.");
      Alert.alert("Gateway restarting", result.message || "The gateway is restarting.");
      await new Promise((resolve) => setTimeout(resolve, 4500));
      await refreshSummary();
    } catch (error) {
      Alert.alert("Restart failed", gatewayActionError(error, "Gateway restart failed."));
    } finally {
      setRestartBusy(false);
    }
  };

  return (
    <>
      <SettingsSection title="Gateway runtime">
        <View style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <Server color={colors.cyan} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Runtime</Text>
          </View>
          <Text style={styles.settingsInfoText}>
            Restart the connected gateway and refresh mobile data once it is healthy again.
          </Text>
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={RefreshCw}
              busy={restartBusy}
              label="Restart Gateway"
              onPress={() => {
                void restartGateway();
              }}
              tone={colors.green}
            />
            <DetailActionButton Icon={Database} label="Open Logs" onPress={openLogs} />
          </View>
        </View>
        <View style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <ShieldCheck color={colors.amber} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Gateway API Key</Text>
          </View>
          {authError ? (
            <Text style={styles.errorText}>{authError}</Text>
          ) : (
            <>
              <Text selectable style={styles.settingsInfoText}>
                {revealedKey || authSettings?.apiKeyPreview || "Loading API key status..."}
              </Text>
              <Text style={styles.settingsFieldHelp}>
                {authSettings?.apiKeySource === "env"
                  ? "Provided by CYBARA_API_KEY."
                  : authSettings?.apiKeyPath || "~/.cybara/api_key"}
              </Text>
            </>
          )}
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={Eye}
              busy={busyAction === "reveal"}
              disabled={!authSettings?.apiKeyConfigured}
              label={revealedKey ? "Hide" : "Reveal"}
              onPress={() => {
                void revealKey();
              }}
              tone={colors.amber}
            />
            <DetailActionButton
              Icon={Copy}
              busy={busyAction === "copy"}
              disabled={!authSettings?.apiKeyConfigured}
              label={copied ? "Copied" : "Copy"}
              onPress={() => {
                void copyKey();
              }}
              tone={colors.amber}
            />
            <DetailActionButton
              Icon={RefreshCw}
              busy={busyAction === "rotate"}
              disabled={!authSettings?.apiKeyConfigured || authSettings?.apiKeySource === "env"}
              label="Rotate"
              onPress={confirmRotateKey}
              tone={colors.amber}
            />
          </View>
        </View>
        {authSettings ? (
          <SettingToggle
            busy={busyAction === "localhost"}
            detail={
              authSettings.requireAuthForLocalhostForced
                ? "Forced by environment or production mode."
                : "When on, localhost browser requests must include the API key."
            }
            disabled={authSettings.requireAuthForLocalhostForced || busyAction !== null}
            label="Require API key for localhost"
            onPress={() => {
              void updateRequireLocalhost();
            }}
            tone={colors.amber}
            value={authSettings.requireAuthForLocalhost}
          />
        ) : null}
      </SettingsSection>
      <SettingsSection title="Recent gateway logs">
        {recentLogs.length === 0 ? (
          <EmptyState label="No logs loaded" detail="Open Logs to fetch recent gateway events." />
        ) : (
          recentLogs.map((log) => (
            <View key={log.id} style={styles.settingsNavigationRow}>
              <View style={styles.settingsNavigationIcon}>
                <Database color={colors.textMuted} size={18} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text numberOfLines={1} style={styles.listTitle}>
                  {log.title || "Gateway event"}
                </Text>
                <Text numberOfLines={1} style={styles.listDetail}>
                  {[log.source, log.detail, absoluteTimestampLabel(log.createdAt)]
                    .filter(Boolean)
                    .join(" - ")}
                </Text>
              </View>
            </View>
          ))
        )}
      </SettingsSection>
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
  const [memoryDraft, setMemoryDraft] = useState(memorySettings);
  const [timeoutsDraft, setTimeoutsDraft] = useState(() =>
    readMobileLlmTimeoutSettings(summary?.config)
  );
  const [providerDraft, setProviderDraft] = useState(providerSettings);
  const [indexingDraft, setIndexingDraft] = useState(indexingSettings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const configSignature = JSON.stringify(summary?.config?.memory_provider ?? null);

  useEffect(() => {
    setMemoryDraft(memorySettings);
    setProviderDraft(providerSettings);
    setIndexingDraft(indexingSettings);
    // Re-sync drafts only when the gateway config itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          detail="Index memory and workspace files for search. Separate from memory itself."
          label="Build recall index"
          onPress={() => saveIndexing({ enabled: !indexingDraft.enabled })}
          tone={accentColor}
          value={indexingDraft.enabled}
        />
        <SettingToggle
          busy={saving}
          detail="Use embeddings for similarity search."
          label="Semantic recall"
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

export function SpeechSettingsPanel({
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
  const speechSettings = readMobileSpeechSettings(summary?.config);
  const [speechDraft, setSpeechDraft] = useState(speechSettings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSpeechDraft(speechSettings);
  }, [
    speechSettings.stt.language,
    speechSettings.stt.model,
    speechSettings.stt.provider,
    speechSettings.stt.providerId,
    speechSettings.tts.fallbackToSystem,
    speechSettings.tts.maxTextLength,
    speechSettings.tts.model,
    speechSettings.tts.outputFormat,
    speechSettings.tts.provider,
    speechSettings.tts.providerId,
    speechSettings.tts.speed,
    speechSettings.tts.voice,
  ]);

  const saveSpeech = async (
    section: "tts" | "stt",
    patch: Partial<MobileSpeechSettings["tts"]> | Partial<MobileSpeechSettings["stt"]>
  ) => {
    if (!configAvailable || saving) return;
    const nextSpeech: MobileSpeechSettings = {
      ...speechDraft,
      [section]: { ...speechDraft[section], ...patch },
    };
    setSpeechDraft(nextSpeech);
    setSaving(true);
    try {
      const result = await api.updateConfig({ speech: nextSpeech });
      if (result.success === false) throw new Error("Speech setting failed");
      await refreshSummary();
    } catch (error) {
      Alert.alert("Speech setting failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!configAvailable) {
    return (
      <SettingsSection title="Speech">
        {!summary ? (
          <LoadingState
            label="Loading speech settings"
            detail="Fetching config from the gateway."
          />
        ) : (
          <EmptyState
            label="Speech settings unavailable"
            detail={endpointErrorDetail(
              summary?.availability.config,
              "The gateway did not return editable speech settings."
            )}
          />
        )}
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title="Text to speech">
        <View style={styles.settingsGroupHeader}>
          <Volume2 color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Voice output</Text>
        </View>
        <SettingSelector
          disabled={saving}
          label="TTS provider"
          onSelect={(value) => {
            const provider =
              value === "system" || value === "elevenlabs" || value === "openai" ? value : "auto";
            void saveSpeech("tts", { provider });
          }}
          options={[
            { label: "Auto", value: "auto" },
            { label: "ElevenLabs", value: "elevenlabs" },
            { label: "OpenAI", value: "openai" },
            { label: "System", value: "system" },
          ]}
          selected={speechDraft.tts.provider}
          tone={accentColor}
          variant="menu"
        />
        <SettingSelector
          disabled={saving}
          label="TTS account"
          onSelect={(providerId) => {
            void saveSpeech("tts", { providerId });
          }}
          options={mobileSpeechProviderOptions(summary?.providers || [], "tts")}
          selected={speechDraft.tts.providerId}
          tone={accentColor}
          variant="menu"
        />
        <SettingsTextField
          label="TTS model"
          onBlur={() => {
            void saveSpeech("tts", { model: speechDraft.tts.model });
          }}
          onChangeText={(model) =>
            setSpeechDraft((current) => ({ ...current, tts: { ...current.tts, model } }))
          }
          placeholder="eleven_multilingual_v2"
          value={speechDraft.tts.model}
        />
        <SettingsTextField
          label="Voice"
          onBlur={() => {
            void saveSpeech("tts", { voice: speechDraft.tts.voice });
          }}
          onChangeText={(voice) =>
            setSpeechDraft((current) => ({ ...current, tts: { ...current.tts, voice } }))
          }
          placeholder="Voice ID or name"
          value={speechDraft.tts.voice}
        />
        <SettingSelector
          disabled={saving}
          label="Audio format"
          onSelect={(outputFormat) => {
            void saveSpeech("tts", { outputFormat });
          }}
          options={[
            { label: "MP3", value: "mp3" },
            { label: "M4A", value: "m4a" },
            { label: "WAV", value: "wav" },
            { label: "Opus", value: "opus" },
            { label: "AAC", value: "aac" },
            { label: "AIFF", value: "aiff" },
          ]}
          selected={speechDraft.tts.outputFormat}
          tone={accentColor}
          variant="menu"
        />
        <SettingToggle
          busy={saving}
          detail="Use the system voice if no cloud TTS provider is configured."
          disabled={saving}
          label="System voice fallback"
          onPress={() => {
            void saveSpeech("tts", { fallbackToSystem: !speechDraft.tts.fallbackToSystem });
          }}
          tone={accentColor}
          value={speechDraft.tts.fallbackToSystem}
        />
      </SettingsSection>
      <SettingsSection title="Speech to text">
        <View style={styles.settingsGroupHeader}>
          <Mic color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Dictation</Text>
        </View>
        <SettingSelector
          disabled={saving}
          label="STT mode"
          onSelect={(provider) => {
            const nextProvider = provider === "native" || provider === "openai" ? provider : "auto";
            void saveSpeech("stt", { provider: nextProvider });
          }}
          options={[
            { label: "Auto", value: "auto" },
            { label: "Native dictation", value: "native" },
            { label: "OpenAI compatible", value: "openai" },
          ]}
          selected={speechDraft.stt.provider}
          tone={accentColor}
          variant="menu"
        />
        <SettingSelector
          disabled={saving}
          label="STT account"
          onSelect={(providerId) => {
            void saveSpeech("stt", { providerId });
          }}
          options={mobileSpeechProviderOptions(summary?.providers || [], "stt")}
          selected={speechDraft.stt.providerId}
          tone={accentColor}
          variant="menu"
        />
        <SettingsTextField
          label="STT model"
          onBlur={() => {
            void saveSpeech("stt", { model: speechDraft.stt.model });
          }}
          onChangeText={(model) =>
            setSpeechDraft((current) => ({ ...current, stt: { ...current.stt, model } }))
          }
          placeholder="gpt-4o-mini-transcribe"
          value={speechDraft.stt.model}
        />
        <SettingsTextField
          label="Language"
          onBlur={() => {
            void saveSpeech("stt", { language: speechDraft.stt.language });
          }}
          onChangeText={(language) =>
            setSpeechDraft((current) => ({ ...current, stt: { ...current.stt, language } }))
          }
          placeholder="en"
          value={speechDraft.stt.language}
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

function journeyRelativeTime(ms: number): string {
  if (!ms) return "unknown";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function journeyDayKey(ms: number): string {
  if (!ms) return "Undated";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function JourneyPanel({ accentColor, api }: { accentColor: string; api: CybaraMobileApi }) {
  const [journey, setJourney] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await api.journey();
        if (mounted) {
          setJourney(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load journey");
      }
    };
    void load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [api]);

  const groups: Array<{ day: string; events: JourneyEvent[] }> = [];
  const order: string[] = [];
  const map = new Map<string, JourneyEvent[]>();
  for (const event of journey?.events ?? []) {
    const key = journeyDayKey(event.createdAtMs);
    if (!map.has(key)) order.push(key);
    map.set(key, [...(map.get(key) ?? []), event]);
  }
  for (const day of order) groups.push({ day, events: map.get(day) ?? [] });

  return (
    <StableDetailPanel>
      <SettingsSection title="Journey">
        <Text style={styles.settingsInfoText}>
          Everything your agent has learned — skills and memories over time.
        </Text>
        <View style={styles.gatewayDetailGrid}>
          <View style={styles.gatewayDetailPill}>
            <Text style={styles.gatewayDetailLabel}>Skills</Text>
            <Text style={[styles.gatewayDetailValue, { color: colors.cyan }]}>
              {journey?.counts.skills ?? 0}
            </Text>
          </View>
          <View style={styles.gatewayDetailPill}>
            <Text style={styles.gatewayDetailLabel}>Memories</Text>
            <Text style={[styles.gatewayDetailValue, { color: accentColor }]}>
              {journey?.counts.memories ?? 0}
            </Text>
          </View>
          <View style={styles.gatewayDetailPill}>
            <Text style={styles.gatewayDetailLabel}>Total</Text>
            <Text style={styles.gatewayDetailValue}>{journey?.counts.total ?? 0}</Text>
          </View>
        </View>
      </SettingsSection>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {journey && journey.events.length === 0 && !error ? (
        <EmptyState label="No learning yet" detail="Saved skills and memories will appear here." />
      ) : null}
      {groups.map((group) => (
        <SettingsSection key={group.day} title={group.day}>
          {group.events.map((event) => (
            <View key={event.id} style={styles.settingsInfoBox}>
              <View style={styles.routerSummaryRow}>
                <Text style={[styles.settingsInfoTitle, { flex: 1 }]} numberOfLines={2}>
                  {event.title}
                </Text>
                <Text style={styles.settingsInfoText}>
                  {journeyRelativeTime(event.createdAtMs)}
                </Text>
              </View>
              {event.detail && event.detail !== event.title ? (
                <Text style={styles.settingsInfoText} numberOfLines={3}>
                  {event.detail}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.settingsInfoText,
                  { color: event.kind === "skill" ? colors.cyan : accentColor },
                ]}
              >
                {event.kind}
                {event.category ? ` · ${event.category}` : ""}
              </Text>
            </View>
          ))}
        </SettingsSection>
      ))}
    </StableDetailPanel>
  );
}
