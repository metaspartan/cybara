import { useEffect, useMemo, useState } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import type { GatewayProfile } from "./src/lib/connection";
import { clearActiveProfile, getActiveProfile, saveProfile } from "./src/lib/storage";
import { spacing, type Palette } from "./src/theme/liquidGlass";
import { ThemeProvider, useTheme, useThemeControls } from "./src/theme/ThemeContext";

function AppShell() {
  const colors = useTheme();
  const { scheme } = useThemeControls();
  const [profile, setProfile] = useState<GatewayProfile | null>(null);
  const [ready, setReady] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    getActiveProfile()
      .then(setProfile)
      .finally(() => setReady(true));
  }, []);

  const connect = async (nextProfile: GatewayProfile) => {
    const saved = { ...nextProfile, lastConnectedAt: new Date().toISOString() };
    await saveProfile(saved);
    setProfile(saved);
  };

  const disconnect = async () => {
    await clearActiveProfile();
    setProfile(null);
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <StatusBar barStyle={scheme === "light" ? "dark-content" : "light-content"} />
      <View style={styles.content}>
        {ready && profile ? (
          <DashboardScreen profile={profile} onDisconnect={disconnect} />
        ) : (
          <ConnectScreen onConnect={connect} />
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      paddingTop: spacing.lg,
    },
  });
