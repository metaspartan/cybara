import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { HapticsProvider } from "./src/haptics/HapticsContext";
import { MobileI18nProvider } from "./src/i18n";
import { CybaraMobileApi } from "./src/lib/api";
import {
  resolveGatewayProfile,
  verifyGatewayProfile,
  type GatewayProfile,
} from "./src/lib/connection";
import {
  configureMobileNotificationPresentation,
  registerMobilePushNotifications,
} from "./src/lib/pushNotifications";
import { DeepLinkAttemptTracker } from "./src/lib/deepLinkAttempts";
import { clearActiveProfile, getActiveProfile, saveProfile } from "./src/lib/storage";
import { MobileErrorBoundary } from "./src/components/MobileErrorBoundary";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { type Palette, spacing } from "./src/theme/liquidGlass";
import { ThemeProvider, useTheme, useThemeControls } from "./src/theme/ThemeContext";

function AppShell() {
  const colors = useTheme();
  const { scheme } = useThemeControls();
  const [profile, setProfile] = useState<GatewayProfile | null>(null);
  const [ready, setReady] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    let mounted = true;
    getActiveProfile()
      .then((nextProfile) => {
        if (mounted) setProfile(nextProfile);
      })
      .catch(() => {
        if (mounted) setProfile(null);
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const attempts = new DeepLinkAttemptTracker();
    const openConnection = async (url: string | null): Promise<void> => {
      if (!url || !attempts.begin(url)) return;
      try {
        const nextProfile = await resolveGatewayProfile(url);
        await verifyGatewayProfile(nextProfile);
        if (!active) return;
        const saved = { ...nextProfile, lastConnectedAt: new Date().toISOString() };
        await saveProfile(saved);
        if (!active) return;
        setProfile(saved);
        attempts.complete(url);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Unable to open this connection.";
        Alert.alert("Connection failed", message);
      } finally {
        attempts.finish(url);
      }
    };

    void Linking.getInitialURL().then(openConnection);
    const subscription = Linking.addEventListener("url", (event) => {
      void openConnection(event.url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const api = new CybaraMobileApi(profile);
    void configureMobileNotificationPresentation();
    void registerMobilePushNotifications(api, { requestPermission: false });
  }, [profile]);

  const connect = async (nextProfile: GatewayProfile) => {
    const saved = { ...nextProfile, lastConnectedAt: new Date().toISOString() };
    await saveProfile(saved);
    setProfile(saved);
  };

  const updateProfile = async (nextProfile: GatewayProfile) => {
    await saveProfile(nextProfile);
    setProfile(nextProfile);
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
          <DashboardScreen
            profile={profile}
            onDisconnect={disconnect}
            onProfileUpdated={updateProfile}
          />
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
        <HapticsProvider>
          <MobileI18nProvider>
            <MobileErrorBoundary>
              <AppShell />
            </MobileErrorBoundary>
          </MobileI18nProvider>
        </HapticsProvider>
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
