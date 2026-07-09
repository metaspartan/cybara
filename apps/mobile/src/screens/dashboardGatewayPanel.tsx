import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  Bell,
  BellOff,
  Copy,
  Database,
  Eye,
  Folder,
  Network,
  RefreshCw,
  Save,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { Clipboard } from "../lib/expoNativeModules";
import {
  clearMobilePushNotifications,
  registerMobilePushNotifications,
} from "../lib/pushNotifications";
import { saveProfile } from "../lib/storage";
import { colors } from "../theme/liquidGlass";
import {
  CybaraMobileApi,
  type FeatureSummary,
  type GatewayAuthSettings,
  type GatewayRemoteAccessSettings,
  type MobilePushDeviceSummary,
} from "../lib/api";
import type { GatewayProfile } from "../lib/connection";
import { absoluteTimestampLabel } from "./dashboardHelpers";
import {
  DetailActionButton,
  SettingSelector,
  SettingToggle,
  SettingsSection,
  SettingsTextField,
} from "./dashboardControls";
import { EmptyState } from "./dashboardPrimitives";
import { styles } from "./dashboardStyles";
import { gatewayActionError } from "./dashboardActionError";

const remoteAccessModeOptions: Array<{
  label: string;
  value: GatewayRemoteAccessSettings["mode"];
}> = [
  { label: "Private mesh", value: "private_overlay" },
  { label: "Public HTTPS tunnel", value: "public_tunnel" },
];

const remoteAccessProviderOptions: Array<{
  label: string;
  value: GatewayRemoteAccessSettings["provider"];
}> = [
  { label: "Tailscale", value: "tailscale" },
  { label: "ZeroTier", value: "zerotier" },
  { label: "NetBird", value: "netbird" },
  { label: "Cloudflare Tunnel", value: "cloudflare" },
  { label: "Custom proxy", value: "custom" },
];

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
  const [gatewayPassword, setGatewayPassword] = useState("");
  const [gatewayPasswordConfirm, setGatewayPasswordConfirm] = useState("");
  const [remoteAccessEnabled, setRemoteAccessEnabled] = useState(false);
  const [remoteAccessMode, setRemoteAccessMode] =
    useState<GatewayRemoteAccessSettings["mode"]>("private_overlay");
  const [remoteAccessProvider, setRemoteAccessProvider] =
    useState<GatewayRemoteAccessSettings["provider"]>("tailscale");
  const [remoteAccessBaseUrl, setRemoteAccessBaseUrl] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [dataDirBusy, setDataDirBusy] = useState(false);
  const [mobilePush, setMobilePush] = useState<MobilePushDeviceSummary | null>(null);
  const [pushStatusLoading, setPushStatusLoading] = useState(false);
  const pushBusy =
    pushStatusLoading ||
    busyAction === "push-enable" ||
    busyAction === "push-test" ||
    busyAction === "push-clear" ||
    busyAction === "push-chat" ||
    busyAction === "push-task";
  const pushConfigured = mobilePush?.configured === true;
  const pushPreferences = mobilePush?.preferences ?? {
    chatCompletions: true,
    taskCompletions: true,
  };
  const pushStatusLabel = pushConfigured
    ? [
        mobilePush?.provider || "expo",
        mobilePush?.platform || "unknown",
        mobilePush?.lastSentAt ? `last sent ${absoluteTimestampLabel(mobilePush.lastSentAt)}` : "",
      ]
        .filter(Boolean)
        .join(" - ")
    : "Off on this device";
  const configuredDefaultWorkspaceDir =
    typeof summary?.config.default_workspace_dir === "string"
      ? summary.config.default_workspace_dir
      : "";
  const [defaultWorkspaceDir, setDefaultWorkspaceDir] = useState(configuredDefaultWorkspaceDir);
  const activeCybaraDataDir =
    typeof summary?.config.cybara_data_dir === "string" ? summary.config.cybara_data_dir : "";
  const configuredCybaraDataDir =
    typeof summary?.config.configured_cybara_data_dir === "string"
      ? summary.config.configured_cybara_data_dir
      : activeCybaraDataDir;
  const cybaraDataDirForced = summary?.config.cybara_data_dir_forced === true;
  const cybaraDataDirRestartRequired = summary?.config.cybara_data_dir_restart_required === true;
  const cybaraDataDirSource =
    typeof summary?.config.cybara_data_dir_source === "string"
      ? summary.config.cybara_data_dir_source
      : "default";
  const defaultCybaraDataDir =
    typeof summary?.config.default_cybara_data_dir === "string"
      ? summary.config.default_cybara_data_dir
      : "";
  const [cybaraDataDir, setCybaraDataDir] = useState(configuredCybaraDataDir);
  const recentLogs = summary?.logs.slice(0, 4) ?? [];

  useEffect(() => {
    setDefaultWorkspaceDir(configuredDefaultWorkspaceDir);
  }, [configuredDefaultWorkspaceDir, profile.id]);

  useEffect(() => {
    setCybaraDataDir(configuredCybaraDataDir);
  }, [configuredCybaraDataDir, profile.id]);

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

  const loadMobilePushStatus = useCallback(async () => {
    setPushStatusLoading(true);
    try {
      const result = await api.currentMobileDevice();
      setMobilePush(result.device?.push ?? null);
    } catch {
      setMobilePush(null);
    } finally {
      setPushStatusLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadMobilePushStatus();
  }, [loadMobilePushStatus, profile.id]);

  useEffect(() => {
    const remote = authSettings?.remoteAccess;
    setRemoteAccessEnabled(remote?.enabled === true);
    setRemoteAccessMode(remote?.mode || "private_overlay");
    setRemoteAccessProvider(remote?.provider || "tailscale");
    setRemoteAccessBaseUrl(remote?.baseUrl || "");
  }, [
    authSettings?.remoteAccess?.baseUrl,
    authSettings?.remoteAccess?.enabled,
    authSettings?.remoteAccess?.mode,
    authSettings?.remoteAccess?.provider,
  ]);

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

  const saveGatewayPassword = async () => {
    const password = gatewayPassword.trim();
    if (password.length < 12) {
      Alert.alert("Password too short", "Use at least 12 characters.");
      return;
    }
    if (password !== gatewayPasswordConfirm.trim()) {
      Alert.alert("Passwords do not match", "Enter the same gateway password twice.");
      return;
    }
    setBusyAction("gateway-password");
    try {
      const settings = await api.updateGatewayAuthSettings({ gatewayPassword: password });
      setAuthSettings(settings);
      api.setGatewayPassword(password);
      const nextProfile = {
        ...profile,
        gatewayPassword: password,
        lastConnectedAt: new Date().toISOString(),
      };
      if (onProfileUpdated) {
        await onProfileUpdated(nextProfile);
      } else {
        await saveProfile(nextProfile);
      }
      setGatewayPassword("");
      setGatewayPasswordConfirm("");
      Alert.alert("Gateway password saved", "This device will include it on root settings calls.");
    } catch (error) {
      Alert.alert("Password failed", gatewayActionError(error, "Gateway password update failed."));
      await loadAuthSettings();
    } finally {
      setBusyAction(null);
    }
  };

  const clearGatewayPassword = async () => {
    setBusyAction("gateway-password-clear");
    try {
      const settings = await api.updateGatewayAuthSettings({ clearGatewayPassword: true });
      setAuthSettings(settings);
      api.setGatewayPassword(undefined);
      const { gatewayPassword: _gatewayPassword, ...rest } = profile;
      const nextProfile = {
        ...rest,
        lastConnectedAt: new Date().toISOString(),
      };
      if (onProfileUpdated) {
        await onProfileUpdated(nextProfile);
      } else {
        await saveProfile(nextProfile);
      }
      Alert.alert("Gateway password cleared", "Remote root access no longer requires it.");
    } catch (error) {
      Alert.alert("Clear failed", gatewayActionError(error, "Gateway password clear failed."));
      await loadAuthSettings();
    } finally {
      setBusyAction(null);
    }
  };

  const saveRemoteAccess = async () => {
    setBusyAction("remote-access");
    try {
      const settings = await api.updateGatewayAuthSettings({
        remoteAccess: {
          enabled: remoteAccessEnabled,
          mode: remoteAccessMode,
          provider: remoteAccessProvider,
          baseUrl: remoteAccessBaseUrl.trim(),
        },
      });
      setAuthSettings(settings);
      Alert.alert("Remote access saved", settings.remoteAccess?.message || "Settings updated.");
    } catch (error) {
      Alert.alert(
        "Remote access failed",
        gatewayActionError(error, "Remote access update failed.")
      );
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

  const enablePushNotifications = async () => {
    setBusyAction("push-enable");
    try {
      const result = await registerMobilePushNotifications(api, { requestPermission: true });
      if (result.status !== "registered") {
        throw new Error(result.message || `Notification setup returned ${result.status}.`);
      }
      await loadMobilePushStatus();
      Alert.alert("Notifications enabled", "Cybara can notify this device when chats finish.");
    } catch (error) {
      Alert.alert("Notifications failed", gatewayActionError(error, "Notification setup failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const sendTestNotification = async () => {
    setBusyAction("push-test");
    try {
      const result = await api.sendTestPush();
      if (result.success === false) {
        const errors = result.result?.errors?.join(", ");
        throw new Error(errors || "Gateway could not send a test notification.");
      }
      await loadMobilePushStatus();
      Alert.alert("Test sent", "A Cybara notification was sent to this device.");
    } catch (error) {
      Alert.alert("Test failed", gatewayActionError(error, "Test notification failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const disablePushNotifications = async () => {
    setBusyAction("push-clear");
    try {
      await clearMobilePushNotifications(api);
      await loadMobilePushStatus();
      Alert.alert("Notifications disabled", "This device will no longer receive gateway pushes.");
    } catch (error) {
      Alert.alert("Disable failed", gatewayActionError(error, "Notification disable failed."));
    } finally {
      setBusyAction(null);
    }
  };

  const updatePushPreference = async (
    key: "chatCompletions" | "taskCompletions",
    value: boolean
  ) => {
    setBusyAction(key === "chatCompletions" ? "push-chat" : "push-task");
    try {
      const result = await api.updatePushPreferences({ [key]: value });
      setMobilePush(result.device?.push ?? null);
    } catch (error) {
      Alert.alert(
        "Notification setting failed",
        gatewayActionError(error, "Notification setting update failed.")
      );
      await loadMobilePushStatus();
    } finally {
      setBusyAction(null);
    }
  };

  const saveDefaultWorkspace = async () => {
    if (summary?.availability.config.ok !== true) {
      Alert.alert("Config unavailable", "The gateway config route is not available.");
      return;
    }
    setWorkspaceBusy(true);
    try {
      const result = await api.updateConfig({
        default_workspace_dir: defaultWorkspaceDir.trim(),
      });
      if (result.success === false) throw new Error("Gateway rejected the workspace setting.");
      await refreshSummary();
      Alert.alert(
        "Default workspace saved",
        "New chats use this workspace when no session folder is selected."
      );
    } catch (error) {
      Alert.alert(
        "Workspace update failed",
        gatewayActionError(error, "Default workspace update failed.")
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const saveCybaraDataDir = async () => {
    if (summary?.availability.config.ok !== true) {
      Alert.alert("Config unavailable", "The gateway config route is not available.");
      return;
    }
    if (cybaraDataDirForced) {
      Alert.alert("Data directory forced", "Unset CYBARA_HOME on the gateway to manage this path.");
      return;
    }
    setDataDirBusy(true);
    try {
      const result = await api.updateConfig({
        cybara_data_dir: cybaraDataDir.trim(),
      });
      if (result.success === false) throw new Error("Gateway rejected the data directory setting.");
      await refreshSummary();
      Alert.alert(
        "Data directory saved",
        result.restartRequired
          ? "Restart the gateway for the new data directory to become active."
          : "The gateway data directory setting is saved."
      );
    } catch (error) {
      Alert.alert(
        "Data directory failed",
        gatewayActionError(error, "Data directory update failed.")
      );
    } finally {
      setDataDirBusy(false);
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
            <Bell color={colors.cyan} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Mobile Notifications</Text>
          </View>
          <Text style={styles.settingsInfoText}>
            Get notified on this device when a chat response or gateway task completes.
          </Text>
          <Text style={styles.settingsFieldHelp}>Status: {pushStatusLabel}</Text>
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={Bell}
              busy={busyAction === "push-enable"}
              disabled={pushBusy}
              label="Enable"
              onPress={() => {
                void enablePushNotifications();
              }}
              tone={colors.cyan}
            />
            <DetailActionButton
              Icon={Send}
              busy={busyAction === "push-test"}
              disabled={pushBusy}
              label="Test"
              onPress={() => {
                void sendTestNotification();
              }}
            />
            <DetailActionButton
              Icon={BellOff}
              busy={busyAction === "push-clear"}
              disabled={pushBusy}
              label="Disable"
              onPress={() => {
                void disablePushNotifications();
              }}
              tone={colors.red}
            />
          </View>
          <SettingToggle
            busy={busyAction === "push-chat"}
            detail="Notify when an agent finishes responding."
            disabled={!pushConfigured || pushBusy}
            label="Chat completions"
            onPress={() => {
              void updatePushPreference("chatCompletions", !pushPreferences.chatCompletions);
            }}
            tone={colors.cyan}
            value={pushPreferences.chatCompletions}
          />
          <SettingToggle
            busy={busyAction === "push-task"}
            detail="Notify when a scheduled or background task completes or fails."
            disabled={!pushConfigured || pushBusy}
            label="Task completions"
            onPress={() => {
              void updatePushPreference("taskCompletions", !pushPreferences.taskCompletions);
            }}
            tone={colors.cyan}
            value={pushPreferences.taskCompletions}
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Storage">
        <View style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <Folder color={colors.cyan} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Default Workspace</Text>
          </View>
          <Text style={styles.settingsInfoText}>
            New chats and agent prompts use this directory when the session does not choose a
            workspace.
          </Text>
          <SettingsTextField
            label="Workspace directory"
            value={defaultWorkspaceDir}
            onChangeText={setDefaultWorkspaceDir}
            onSubmitEditing={() => {
              void saveDefaultWorkspace();
            }}
            placeholder="/Users/you"
            returnKeyType="done"
          />
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={Save}
              busy={workspaceBusy}
              disabled={workspaceBusy}
              label="Save Workspace"
              onPress={() => {
                void saveDefaultWorkspace();
              }}
              tone={colors.cyan}
            />
          </View>
        </View>
        <View style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <Database color={colors.cyan} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Data Directory</Text>
          </View>
          <Text style={styles.settingsInfoText}>
            Stores gateway config, database, API keys, memory, logs, skills, and local media on the
            gateway host.
          </Text>
          <SettingsTextField
            label="Configured data directory"
            value={cybaraDataDir}
            onChangeText={setCybaraDataDir}
            onSubmitEditing={() => {
              void saveCybaraDataDir();
            }}
            editable={!cybaraDataDirForced}
            placeholder={defaultCybaraDataDir || "~/.cybara"}
            returnKeyType="done"
          />
          <Text selectable style={styles.settingsInfoText}>
            Active now: {activeCybaraDataDir || "Unavailable"}
          </Text>
          {configuredCybaraDataDir && configuredCybaraDataDir !== activeCybaraDataDir ? (
            <Text selectable style={styles.settingsInfoText}>
              After restart: {configuredCybaraDataDir}
            </Text>
          ) : null}
          <Text style={styles.settingsInfoText}>
            Source: {cybaraDataDirSource}
            {cybaraDataDirRestartRequired ? " · restart required" : ""}
            {cybaraDataDirForced ? " · managed by CYBARA_HOME" : ""}
          </Text>
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={Save}
              busy={dataDirBusy}
              disabled={dataDirBusy || cybaraDataDirForced || !cybaraDataDir.trim()}
              label="Save Data Directory"
              onPress={() => {
                void saveCybaraDataDir();
              }}
              tone={colors.cyan}
            />
          </View>
        </View>
      </SettingsSection>
      <SettingsSection title="Security">
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
        <View style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <ShieldAlert color={colors.amber} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Gateway Password</Text>
          </View>
          <Text style={styles.settingsInfoText}>
            Optional second factor for remote root/UI access when the gateway is reachable outside
            this machine.
          </Text>
          <Text style={styles.settingsFieldHelp}>
            Status: {authSettings?.gatewayPasswordEnabled ? "Enabled" : "Off"}
          </Text>
          <SettingsTextField
            label="New password"
            value={gatewayPassword}
            onChangeText={setGatewayPassword}
            placeholder="At least 12 characters"
            returnKeyType="next"
            secureTextEntry
          />
          <SettingsTextField
            label="Confirm password"
            value={gatewayPasswordConfirm}
            onChangeText={setGatewayPasswordConfirm}
            placeholder="Repeat password"
            returnKeyType="done"
            secureTextEntry
            onSubmitEditing={() => {
              void saveGatewayPassword();
            }}
          />
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={Save}
              busy={busyAction === "gateway-password"}
              disabled={
                busyAction !== null || !gatewayPassword.trim() || !gatewayPasswordConfirm.trim()
              }
              label={authSettings?.gatewayPasswordEnabled ? "Update Password" : "Enable Password"}
              onPress={() => {
                void saveGatewayPassword();
              }}
              tone={colors.amber}
            />
            <DetailActionButton
              Icon={Trash2}
              busy={busyAction === "gateway-password-clear"}
              disabled={busyAction !== null || !authSettings?.gatewayPasswordEnabled}
              label="Clear"
              onPress={() => {
                void clearGatewayPassword();
              }}
              tone={colors.red}
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
      <SettingsSection title="Remote access">
        <View style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <Network color={colors.cyan} size={18} strokeWidth={2.2} />
            <Text style={styles.settingsInfoTitle}>Remote Access</Text>
          </View>
          <Text style={styles.settingsInfoText}>
            Use a private mesh for remote mobile access, or a password-protected HTTPS tunnel for a
            public domain.
          </Text>
          <SettingToggle
            disabled={busyAction !== null}
            label="Enable remote URL"
            onPress={() => setRemoteAccessEnabled((value) => !value)}
            tone={colors.cyan}
            value={remoteAccessEnabled}
          />
          <SettingSelector
            disabled={busyAction !== null}
            label="Access method"
            options={remoteAccessModeOptions}
            selected={remoteAccessMode}
            variant="menu"
            onSelect={(value) => setRemoteAccessMode(value as GatewayRemoteAccessSettings["mode"])}
          />
          <SettingSelector
            disabled={busyAction !== null}
            label="Provider"
            options={remoteAccessProviderOptions}
            selected={remoteAccessProvider}
            variant="menu"
            onSelect={(value) =>
              setRemoteAccessProvider(value as GatewayRemoteAccessSettings["provider"])
            }
          />
          <SettingsTextField
            help={authSettings?.remoteAccess?.message}
            keyboardType="url"
            label="Client URL"
            value={remoteAccessBaseUrl}
            onChangeText={setRemoteAccessBaseUrl}
            placeholder={
              remoteAccessMode === "public_tunnel"
                ? "https://cybara.example.com"
                : "https://name.tailnet.ts.net"
            }
            returnKeyType="done"
            onSubmitEditing={() => {
              void saveRemoteAccess();
            }}
          />
          <View style={styles.settingsActionRow}>
            <DetailActionButton
              Icon={Save}
              busy={busyAction === "remote-access"}
              disabled={busyAction !== null}
              label="Save Remote Access"
              onPress={() => {
                void saveRemoteAccess();
              }}
              tone={colors.cyan}
            />
          </View>
        </View>
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
