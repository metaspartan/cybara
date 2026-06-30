import { useState } from "react";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { GlassButton, GlassPanel } from "../components/Glass";
import {
  buildMobileConnectPayload,
  parseMobileConnectPayload,
  profileFromPayload,
  type GatewayProfile,
} from "../lib/connection";
import { colors, radius, spacing, typography } from "../theme/liquidGlass";

export function ConnectScreen({ onConnect }: { onConnect: (profile: GatewayProfile) => void }) {
  const [name, setName] = useState("Mac Studio Gateway");
  const [baseUrl, setBaseUrl] = useState("http://192.168.1.20:4269");
  const [apiKey, setApiKey] = useState("");
  const [payload, setPayload] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const connectManual = () => {
    try {
      onConnect(profileFromPayload(buildMobileConnectPayload({ name, baseUrl, apiKey })));
    } catch (error) {
      Alert.alert("Connection details are incomplete", error instanceof Error ? error.message : String(error));
    }
  };

  const connectPayload = () => {
    try {
      onConnect(profileFromPayload(parseMobileConnectPayload(payload)));
    } catch (error) {
      Alert.alert("Could not parse connection payload", error instanceof Error ? error.message : String(error));
    }
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const nextPermission = await requestCameraPermission();
      if (!nextPermission.granted) {
        Alert.alert("Camera permission is required", "Enable camera access to scan a Cybara gateway QR code.");
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  };

  const connectScannedPayload = (result: BarcodeScanningResult) => {
    if (scanLocked) return;
    setScanLocked(true);
    setPayload(result.data);
    try {
      onConnect(profileFromPayload(parseMobileConnectPayload(result.data)));
      setScannerOpen(false);
    } catch (error) {
      setScanLocked(false);
      Alert.alert("Could not parse scanned QR", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Cybara</Text>
      <Text style={styles.subtitle}>Connect this phone to a running Cybara gateway.</Text>
      <GlassPanel elevated style={styles.card}>
        <Text style={styles.cardTitle}>Quick connect</Text>
        <Text style={styles.help}>Scan the gateway QR or paste the pairing payload.</Text>
        <GlassButton label="Scan QR" detail="Camera pairing" onPress={openScanner} selected={scannerOpen} />
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
        <GlassButton label="Connect from payload" detail="QR/manual payload" onPress={connectPayload} />
        {scannerOpen ? <GlassButton label="Cancel scan" onPress={() => setScannerOpen(false)} /> : null}
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.cardTitle}>Manual gateway</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Device name" placeholderTextColor={colors.textDim} style={styles.input} />
        <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" placeholder="Gateway URL" placeholderTextColor={colors.textDim} style={styles.input} />
        <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry placeholder="API key" placeholderTextColor={colors.textDim} style={styles.input} />
        <GlassButton label="Connect gateway" detail="Stores this profile locally" onPress={connectManual} />
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 36,
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
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(0, 0, 0, 0.26)",
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
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
});
