import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import {
  Bot,
  CalendarCheck,
  Copy,
  Cpu,
  Database,
  Eye,
  Folder,
  Link2,
  Play,
  RefreshCw,
  Save,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
  Bell,
  BellOff,
} from "lucide-react-native";
import { haptics } from "../lib/haptics";
import { Clipboard } from "../lib/expoNativeModules";
import { accentPalette, colors } from "../theme/liquidGlass";
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
  agentProviderId,
  arraySettingCount,
  booleanSetting,
  cleanSettingsFields,
  displayFieldLabel,
  displayFields,
  endpointErrorDetail,
  monitorPercent,
  monitorPercentLabel,
  objectRecord,
  readMobileIndexingSettings,
  readMobileMemoryBehaviorSettings,
  readMobileLlmTimeoutSettings,
  type MobileLlmTimeoutSettings,
  readMobileMemoryProviderSettings,
  readMobileTokenOptimizationSettings,
  remoteItemEnabled,
  remoteTaskRunning,
  MOBILE_MEMORY_PROVIDER_CHOICES,
  type MobileIndexingSettings,
  type MobileMemoryBehaviorSettings,
  type MobileMemoryProviderChoice,
  type MobileMemoryProviderSettings,
  type MobileTokenOptimizationSettings,
} from "./dashboardHelpers";
import {
  MOBILE_SETTINGS_DETAIL_CHROME,
  MOBILE_SYSTEM_PROMPT_FEATURE_KEYS,
  formatMobileValue,
  formatUptime,
  mobileProviderAuthMode,
} from "../lib/dashboard";
import { formatMetricBytes, formatStorageBytes } from "../lib/metrics";
import {
  CybaraMobileApi,
  CybaraApiError,
  type ActivitySummary,
  type AgentSummary,
  type FeatureSummary,
  type GatewayAuthSettings,
  type GatewayRemoteAccessSettings,
  type MigrationPreset,
  type MigrationSkillConflictMode,
  type MigrationSourceCandidate,
  type MigrationSourceKind,
  type ProviderPlanMonitoringConfig,
  type ProviderPlanStatusResponse,
  type ProviderSummary,
  type RemoteItemSummary,
  type RouterConfig,
  type SourceMigrationReport,
  type SourceMigrationRequest,
  type SystemPromptFeatureKey,
  type MobilePushDeviceSummary,
  type ToolApprovalDecision,
  type WalletAgentPolicyUpdate,
  type WalletChain,
  type WalletTokenChain,
} from "../lib/api";
import { gatewayActionError } from "./dashboardActionError";
import type { GatewayProfile } from "../lib/connection";
import {
  clearMobilePushNotifications,
  registerMobilePushNotifications,
} from "../lib/pushNotifications";
import { saveProfile } from "../lib/storage";
import {
  providerPlanPresetLimitLabel,
  providerPlanUsageRows,
  providerPlanUsageSummary,
  ProviderPlanUsageGrid,
} from "./dashboardProviderPlanUsage";

const CHANNEL_MODEL_ROUTER_SELECTOR_VALUE = "__model_router__";

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
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | undefined>(undefined);
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
    setRefreshToken("");
    setExpiresAt(undefined);
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
  const manualPlanEditable = providerPlan?.manualPlanEditable !== false;
  const planUsageSummary = providerPlanUsageSummary(providerPlan);
  const planUsageRows = providerPlanUsageRows(providerPlan);

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
    if (!manualPlanEditable) {
      await saveRoutePricing();
      return;
    }
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
        refresh_token: usesOAuth ? refreshToken.trim() || undefined : undefined,
        expires_at: usesOAuth ? expiresAt : undefined,
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

  const pollOAuthCallback = async (state: string, pollToken: string) => {
    const expiresAt = Date.now() + 600_000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const status = await api.providerOAuthCallbackStatus(state, pollToken);
      if (status.status === "success" && status.access_token) {
        setAccessToken(status.access_token);
        setRefreshToken(status.refresh_token || "");
        setExpiresAt(status.expires_at);
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
    let intervalMs = Math.max(5, intervalSeconds || 5) * 1000;
    const expiresAt = Date.now() + Math.max(60, expiresIn || 900) * 1000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const status = await api.pollProviderDeviceCodeOAuth(provider.provider, deviceCode);
      if (status.status === "success" && status.access_token) {
        setAccessToken(status.access_token);
        setRefreshToken(status.refresh_token || "");
        setExpiresAt(status.expires_at);
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
      if (status.status === "slow_down") {
        intervalMs += 5000;
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
        await openGatewayOrLocalUrl(
          response.verification_uri_complete || response.verification_uri
        );
        await pollOAuthDeviceCode(response.device_code, response.interval, response.expires_in);
      } else {
        const response = await api.startProviderOAuth(provider.provider);
        setOauthStatus("Complete sign-in in the browser window, then keep this screen open.");
        await openGatewayOrLocalUrl(response.auth_url);
        await pollOAuthCallback(response.state, response.poll_token);
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

      {planUsageRows.length > 0 ? (
        <View style={styles.settingsInfoBox}>
          <View style={styles.routerSummaryRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsInfoTitle}>Plan usage</Text>
              {planUsageSummary ? (
                <Text style={styles.settingsInfoText}>{planUsageSummary}</Text>
              ) : null}
            </View>
            <Text style={[styles.routerSummaryValue, { color: colors.blueText }]}>Auto</Text>
          </View>
          <ProviderPlanUsageGrid rows={planUsageRows} />
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
        {planMonitoringConfig && !manualPlanEditable ? (
          <>
            <View style={styles.settingsInfoBox}>
              <Text style={styles.settingsInfoTitle}>Plan usage is automatic</Text>
              <Text style={styles.settingsInfoText}>
                {planUsageSummary ||
                  "Live provider usage is used for routing. No manual plan limits are needed."}
              </Text>
              <ProviderPlanUsageGrid rows={planUsageRows} />
            </View>
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
        ) : planMonitoringConfig ? (
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
  const itemAgentId = "agentId" in item ? item.agentId || "" : "";
  const itemUsesModelRouter = "useModelRouter" in item && item.useModelRouter === true;
  const [name, setName] = useState(item.title);
  const [enabled, setEnabled] = useState(remoteItemEnabled(item));
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(itemAgentId);
  const [useModelRouter, setUseModelRouter] = useState(itemUsesModelRouter);
  const [modelRouterEnabled, setModelRouterEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(item.title);
    setEnabled(remoteItemEnabled(item));
    setSelectedAgentId(itemAgentId);
    setUseModelRouter(itemUsesModelRouter);
  }, [item, itemAgentId, itemUsesModelRouter]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.agents(), api.routerConfig()])
      .then(([nextAgents, router]) => {
        if (active) {
          setAgents(nextAgents);
          setModelRouterEnabled(router.enabled === true);
        }
      })
      .catch(() => {
        if (active) {
          setAgents([]);
          setModelRouterEnabled(false);
        }
      });
    return () => {
      active = false;
    };
  }, [api]);

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
        config: {
          agent_id: useModelRouter ? null : selectedAgentId || null,
          use_model_router: useModelRouter && modelRouterEnabled,
        },
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
        <SettingSelector
          label="Default routing"
          onSelect={(value) => {
            if (value === CHANNEL_MODEL_ROUTER_SELECTOR_VALUE) {
              setUseModelRouter(true);
              return;
            }
            setUseModelRouter(false);
            setSelectedAgentId(value);
          }}
          options={[
            { label: "Gateway default", value: "" },
            ...(modelRouterEnabled
              ? [{ label: "Model Router", value: CHANNEL_MODEL_ROUTER_SELECTOR_VALUE }]
              : []),
            ...agents.map((agent) => ({
              label: agent.model ? `${agent.name} - ${agent.model}` : agent.name,
              value: agent.id,
            })),
          ]}
          selected={useModelRouter ? CHANNEL_MODEL_ROUTER_SELECTOR_VALUE : selectedAgentId}
          variant="menu"
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

export { GatewayManagementPanel } from "./dashboardGatewayPanel";

export {
  MigrationSettingsPanel,
  MemorySettingsPanel,
  SystemPromptPanel,
} from "./dashboardAdvancedSettingsPanels";
