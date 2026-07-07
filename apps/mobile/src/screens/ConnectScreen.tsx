import { useState } from "react";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Alert, Image, StyleSheet, Text, TextInput, View } from "react-native";
import { GlassButton, GlassPanel } from "../components/Glass";
import {
  buildMobileConnectPayload,
  profileFromPayload,
  resolveGatewayProfile,
  verifyGatewayProfile,
  type GatewayProfile,
} from "../lib/connection";
import { colors, radius, spacing, subscribeColors, typography } from "../theme/liquidGlass";
import cybaraLogo from "../../assets/cybara.png";

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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const showConnectError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setConnectError(message);
    setConnectStatus("");
    Alert.alert("Could not connect", message);
  };

  const finishConnect = async (profile: GatewayProfile) => {
    setConnectStatus("Checking gateway...");
    await verifyGatewayProfile(profile);
    setConnectStatus("Saving connection...");
    await onConnect(profile);
    setConnectStatus("Connected");
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
      setConnectBusy(false);
    }
  };

  const connectPayload = async () => {
    if (connectBusy) return;
    setConnectBusy(true);
    setConnectError("");
    try {
      setConnectStatus("Reading pairing payload...");
      await finishConnect(await resolveGatewayProfile(payload));
    } catch (error) {
      showConnectError(error);
    } finally {
      setConnectBusy(false);
    }
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const nextPermission = await requestCameraPermission();
      if (!nextPermission.granted) {
        Alert.alert(
          "Camera permission is required",
          "Enable camera access to scan a Cybara gateway QR code."
        );
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  };

  const connectScannedPayload = async (result: BarcodeScanningResult) => {
    if (scanLocked || connectBusy) return;
    setScanLocked(true);
    setConnectBusy(true);
    setConnectError("");
    setPayload(result.data);
    try {
      setConnectStatus("Reading QR code...");
      await finishConnect(await resolveGatewayProfile(result.data));
      setScannerOpen(false);
    } catch (error) {
      showConnectError(error);
    } finally {
      setScanLocked(false);
      setConnectBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.brand}>
        <View style={styles.logoMark}>
          <Image accessibilityIgnoresInvertColors source={cybaraLogo} style={styles.logoImage} />
        </View>
        <View style={styles.brandText}>
          <Text style={styles.title}>Cybara</Text>
          <Text style={styles.subtitle}>Connect this phone to a running Cybara gateway.</Text>
        </View>
      </View>
      <GlassPanel elevated style={styles.card}>
        <Text style={styles.cardTitle}>Quick connect</Text>
        <Text style={styles.help}>Scan the Mobile page QR or paste a CLI pairing payload.</Text>
        <GlassButton
          label="Scan QR"
          detail="Camera pairing"
          onPress={openScanner}
          selected={scannerOpen}
          disabled={connectBusy}
        />
        {scannerOpen ? (
          <View style={styles.cameraWrap}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              facing="back"
              onBarcodeScanned={connectScannedPayload}
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
          placeholder="Paste QR payload"
          placeholderTextColor={colors.textDim}
          multiline
          style={[styles.input, styles.payload]}
        />
        <GlassButton
          label={connectBusy ? "Connecting..." : "Connect from payload"}
          detail={connectStatus || "QR/manual payload"}
          onPress={connectPayload}
          disabled={connectBusy}
        />
        {connectError ? <Text style={styles.errorText}>{connectError}</Text> : null}
        {scannerOpen ? (
          <GlassButton
            label="Cancel scan"
            onPress={() => setScannerOpen(false)}
            disabled={connectBusy}
          />
        ) : null}
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.cardTitle}>Manual gateway</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Device name"
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
          placeholder="API key"
          placeholderTextColor={colors.textDim}
          style={styles.input}
        />
        <GlassButton
          label={connectBusy ? "Connecting..." : "Connect gateway"}
          detail={connectStatus || "Stores this profile locally"}
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
