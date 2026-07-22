import { useEffect, useRef, useState } from "react";
import type { BarcodeScanningResult } from "expo-camera";
import {
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type Permission,
} from "react-native";
import { GlassButton, GlassPanel } from "../components/Glass";
import {
  buildMobileConnectPayload,
  DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS,
  profileFromPayload,
  resolveGatewayProfile,
  verifyGatewayProfile,
  type GatewayProfile,
} from "../lib/connection";
import {
  ensureAndroidLanAccess,
  type AndroidLanAccessRuntime,
  type AndroidLanPermissionName,
} from "../lib/androidLanAccess";
import { Camera, CameraView } from "../lib/expoNativeModules";
import { useMobileI18n } from "../i18n";
import { colors, radius, spacing, subscribeColors, typography } from "../theme/liquidGlass";
import cybaraLogo from "../../assets/cybara.png";

const androidLanAccessRuntime: AndroidLanAccessRuntime = {
  os: Platform.OS,
  apiLevel: Number(Platform.Version),
  grantedStatus: PermissionsAndroid.RESULTS.GRANTED,
  check: (permission: AndroidLanPermissionName) =>
    PermissionsAndroid.check(permission as Permission),
  request: (permission: AndroidLanPermissionName) =>
    PermissionsAndroid.request(permission as Permission, {
      title: "Local network access",
      message: "Cybara needs local network access to connect to your gateway.",
      buttonPositive: "Allow",
      buttonNegative: "Not now",
    }),
};

function ensureGatewayNetworkAccess(baseUrl: string): Promise<void> {
  return ensureAndroidLanAccess(baseUrl, androidLanAccessRuntime);
}

function scannedPayloadText(result: BarcodeScanningResult): string {
  if (!result || typeof result.data !== "string") {
    throw new Error("Scanned QR code did not contain a readable Cybara payload.");
  }
  const trimmed = result.data.trim();
  if (!trimmed) {
    throw new Error("Scanned QR code was empty.");
  }
  return trimmed;
}

export function ConnectScreen({
  onConnect,
}: {
  onConnect: (profile: GatewayProfile) => void | Promise<void>;
}) {
  const [name, setName] = useState("Cybara Gateway");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [payload, setPayload] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectStatus, setConnectStatus] = useState("");
  const [connectError, setConnectError] = useState("");
  const mountedRef = useRef(true);
  const scanLockRef = useRef(false);
  const { t } = useMobileI18n();

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const setStatusIfMounted = (status: string) => {
    if (mountedRef.current) setConnectStatus(status);
  };

  const showConnectError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!mountedRef.current) return;
    setConnectError(message);
    setStatusIfMounted("");
    Alert.alert(t("connect.errorTitle"), message);
  };

  const finishConnect = async (profile: GatewayProfile) => {
    setStatusIfMounted(t("connect.checking"));
    await ensureGatewayNetworkAccess(profile.baseUrl);
    await verifyGatewayProfile(profile);
    setStatusIfMounted(t("connect.saving"));
    await onConnect(profile);
    setStatusIfMounted(t("connect.connected"));
  };

  const connectManual = async () => {
    if (connectBusy) return;
    setConnectBusy(true);
    setConnectError("");
    try {
      await finishConnect(profileFromPayload(buildMobileConnectPayload({ name, baseUrl, apiKey })));
    } catch (error) {
      showConnectError(error);
    } finally {
      if (mountedRef.current) setConnectBusy(false);
    }
  };

  const connectPayload = async () => {
    if (connectBusy) return;
    setConnectBusy(true);
    setConnectError("");
    try {
      setConnectStatus(t("action.connecting"));
      await finishConnect(
        await resolveGatewayProfile(
          payload,
          new Date(),
          fetch,
          DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS,
          ensureGatewayNetworkAccess
        )
      );
    } catch (error) {
      showConnectError(error);
    } finally {
      if (mountedRef.current) setConnectBusy(false);
    }
  };

  const openScanner = async () => {
    try {
      const currentPermission = await Camera.getCameraPermissionsAsync();
      const nextPermission = currentPermission.granted
        ? currentPermission
        : await Camera.requestCameraPermissionsAsync();
      if (!nextPermission.granted) {
        Alert.alert(t("connect.cameraPermissionTitle"), t("connect.cameraPermissionBody"));
        return;
      }
    } catch (error) {
      showConnectError(error);
      return;
    }
    scanLockRef.current = false;
    setScanLocked(false);
    setScannerOpen(true);
  };

  const connectScannedPayload = async (result: BarcodeScanningResult) => {
    if (scanLockRef.current || connectBusy) return;
    scanLockRef.current = true;
    let nextPayload: string;
    try {
      nextPayload = scannedPayloadText(result);
    } catch (error) {
      showConnectError(error);
      scanLockRef.current = false;
      return;
    }
    setScanLocked(true);
    setConnectBusy(true);
    setConnectError("");
    setScannerOpen(false);
    setPayload(nextPayload);
    try {
      setStatusIfMounted(t("action.connecting"));
      await finishConnect(
        await resolveGatewayProfile(
          nextPayload,
          new Date(),
          fetch,
          DEFAULT_GATEWAY_CONNECT_TIMEOUT_MS,
          ensureGatewayNetworkAccess
        )
      );
    } catch (error) {
      showConnectError(error);
    } finally {
      scanLockRef.current = false;
      if (mountedRef.current) {
        setScanLocked(false);
        setConnectBusy(false);
      }
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.brand}>
        <View style={styles.logoMark}>
          <Image accessibilityIgnoresInvertColors source={cybaraLogo} style={styles.logoImage} />
        </View>
        <View style={styles.brandText}>
          <Text style={styles.title}>{t("app.name")}</Text>
          <Text style={styles.subtitle}>{t("connect.subtitle")}</Text>
        </View>
      </View>
      <GlassPanel elevated style={styles.card}>
        <Text style={styles.cardTitle}>{t("connect.quick")}</Text>
        <Text style={styles.help}>{t("connect.quickHelp")}</Text>
        <GlassButton
          label={t("action.scanQr")}
          detail={t("connect.cameraPairing")}
          onPress={openScanner}
          selected={scannerOpen}
          disabled={connectBusy}
        />
        {scannerOpen ? (
          <View style={styles.cameraWrap}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              facing="back"
              onBarcodeScanned={scanLocked || connectBusy ? undefined : connectScannedPayload}
              style={styles.camera}
            />
            <View style={styles.cameraOverlay}>
              <View style={styles.scanFrame} />
            </View>
          </View>
        ) : null}
        <TextInput
          value={payload}
          onChangeText={setPayload}
          placeholder={t("connect.payloadPlaceholder")}
          placeholderTextColor={colors.textDim}
          multiline
          style={[styles.input, styles.payload]}
        />
        <GlassButton
          label={connectBusy ? t("action.connecting") : t("connect.payload")}
          detail={connectStatus || t("connect.payloadDetail")}
          onPress={connectPayload}
          disabled={connectBusy}
        />
        {connectError ? <Text style={styles.errorText}>{connectError}</Text> : null}
        {scannerOpen ? (
          <GlassButton
            label={t("connect.cancelScan")}
            onPress={() => {
              scanLockRef.current = false;
              setScanLocked(false);
              setScannerOpen(false);
            }}
            disabled={connectBusy}
          />
        ) : null}
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.cardTitle}>{t("connect.manual")}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("connect.deviceName")}
          placeholderTextColor={colors.textDim}
          style={styles.input}
        />
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          placeholder="http://192.168.1.20:4269"
          placeholderTextColor={colors.textDim}
          style={styles.input}
        />
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          secureTextEntry
          placeholder={t("connect.apiKey")}
          placeholderTextColor={colors.textDim}
          style={styles.input}
        />
        <GlassButton
          label={connectBusy ? t("action.connecting") : t("connect.gateway")}
          detail={connectStatus || t("connect.localProfile")}
          onPress={connectManual}
          disabled={connectBusy}
        />
      </GlassPanel>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    wrap: {
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    brand: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      paddingBottom: spacing.xs,
    },
    logoMark: {
      alignItems: "center",
      backgroundColor: colors.softCyan,
      borderColor: colors.softCyanBorder,
      borderRadius: radius.lg,
      borderWidth: 1,
      height: 58,
      justifyContent: "center",
      overflow: "hidden",
      width: 58,
    },
    logoImage: {
      height: 45,
      width: 45,
    },
    brandText: {
      flex: 1,
      gap: 3,
    },
    title: {
      color: colors.text,
      fontSize: 35,
      fontWeight: "900",
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: typography.body,
      lineHeight: 22,
    },
    card: {
      gap: spacing.md,
    },
    cardTitle: {
      color: colors.text,
      fontSize: typography.heading,
      fontWeight: "800",
    },
    help: {
      color: colors.textMuted,
      fontSize: typography.label,
      lineHeight: 18,
    },
    errorText: {
      color: colors.red,
      fontSize: typography.label,
      lineHeight: 19,
    },
    input: {
      minHeight: 46,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    payload: {
      minHeight: 92,
      textAlignVertical: "top",
    },
    cameraWrap: {
      height: 260,
      borderRadius: radius.lg,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundLift,
    },
    camera: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
    cameraOverlay: {
      alignItems: "center",
      bottom: 0,
      justifyContent: "center",
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
    scanFrame: {
      width: 190,
      height: 190,
      borderRadius: radius.lg,
      borderWidth: 2,
      borderColor: colors.cyan,
      backgroundColor: colors.inset,
    },
  });

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
