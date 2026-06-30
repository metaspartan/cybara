import { useEffect, useState } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import type { GatewayProfile } from "./src/lib/connection";
import { clearActiveProfile, getActiveProfile, saveProfile } from "./src/lib/storage";
import { colors, spacing } from "./src/theme/liquidGlass";

export default function App() {
  const [profile, setProfile] = useState<GatewayProfile | null>(null);
  const [ready, setReady] = useState(false);

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
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.background}>
          <View style={styles.content}>
            {ready && profile ? (
              <DashboardScreen profile={profile} onDisconnect={disconnect} />
            ) : (
              <ConnectScreen onConnect={connect} />
            )}
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  background: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
