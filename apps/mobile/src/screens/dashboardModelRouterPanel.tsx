import { useEffect, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { Network } from "lucide-react-native";
import { MOBILE_ROUTER_STRATEGY_OPTIONS, readMobileRouterStrategy } from "../lib/dashboard";
import type {
  CybaraMobileApi,
  FeatureSummary,
  ProviderPlanMonitoringConfig,
  ProviderPlanStatusResponse,
  RouterConfig,
  RouterStatus,
} from "../lib/api";
import { colors } from "../theme/liquidGlass";
import {
  DetailInfoSection,
  SettingSelector,
  SettingToggle,
  SettingsSection,
  StableDetailPanel,
} from "./dashboardControls";
import { EmptyState, LoadingState } from "./dashboardPrimitives";
import {
  providerPlanPresetLimitLabel,
  providerPlanUsageRows,
  providerPlanUsageSummary,
  ProviderPlanUsageGrid,
} from "./dashboardProviderPlanUsage";
import { styles } from "./dashboardStyles";

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
              const manualPlanEditable = plan?.manualPlanEditable !== false;
              const routePlanUsageRows = providerPlanUsageRows(plan ?? null);
              const routePlanUsageSummary = providerPlanUsageSummary(plan ?? null);
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
                  {!manualPlanEditable ? (
                    <View style={styles.settingsInfoBox}>
                      <Text style={styles.settingsInfoTitle}>Plan usage is automatic</Text>
                      <Text style={styles.settingsInfoText}>
                        {routePlanUsageSummary ||
                          "Live provider usage is used for routing. No manual plan limits are needed."}
                      </Text>
                      <ProviderPlanUsageGrid rows={routePlanUsageRows} />
                    </View>
                  ) : presetSuggestions.length > 0 ? (
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
                  {manualPlanEditable ? (
                    <View style={styles.settingsActionRow}>
                      <TextInput
                        editable={!savingRouterConfig}
                        keyboardType="number-pad"
                        onBlur={() => {
                          const parsed = Number(tokenDraft.trim());
                          void savePlanConfigPatch(route.providerId, {
                            monthly: {
                              enabled: true,
                              tokenLimit:
                                Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
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
                              spendLimit:
                                Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
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
                  ) : null}
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
