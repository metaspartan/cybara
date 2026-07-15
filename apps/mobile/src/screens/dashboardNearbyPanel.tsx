import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Check, Laptop, Link2, Network, RefreshCw, ShieldCheck, Trash2 } from "lucide-react-native";
import { CybaraMobileApi, type MobileNearbySettings, type MobileNearbyStatus } from "../lib/api";
import { colors } from "../theme/liquidGlass";
import {
  DetailActionButton,
  SettingToggle,
  SettingsSection,
  SettingsTextField,
} from "./dashboardControls";
import { styles } from "./dashboardStyles";

export function NearbyMobileSettings({ api }: { api: CybaraMobileApi }) {
  const [status, setStatus] = useState<MobileNearbyStatus | null>(null);
  const [settings, setSettings] = useState<MobileNearbySettings>({
    enabled: false,
    displayName: "Cybara",
    port: 4270,
    discoveryMinutes: 10,
    autoAdvertise: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairAddress, setPairAddress] = useState("");
  const discoveryUnavailable = Boolean(
    settings.enabled &&
      status?.running &&
      status.discovery !== undefined &&
      !status.discovery.udp.running &&
      !status.discovery.mdns.running
  );
  const discoveryFallback = Boolean(
    settings.enabled &&
      status?.running &&
      !discoveryUnavailable &&
      (status.discovery?.udp.error || status.discovery?.mdns.error)
  );

  const load = useCallback(
    async (syncSettings = true) => {
      try {
        const next = await api.nearbyStatus();
        setStatus(next);
        if (syncSettings) setSettings(next.settings);
        setError(null);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Nearby settings unavailable";
        setError(
          message.includes("403")
            ? "Full-access pairing is required to manage nearby devices."
            : message
        );
      }
    },
    [api]
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(false), 2000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nearby action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Nearby Cybara">
      <View style={styles.settingsInfoBox}>
        <View style={styles.settingsInfoHeader}>
          <Network color={colors.cyan} size={18} strokeWidth={2.2} />
          <Text style={styles.settingsInfoTitle}>Local device sharing</Text>
        </View>
        <Text style={styles.settingsInfoText}>
          Pair trusted Cybara installations on the same network and approve chat transfers.
        </Text>
        <View style={styles.settingsInfoHeader}>
          <ShieldCheck color={colors.textMuted} size={16} strokeWidth={2} />
          <Text style={styles.settingsFieldHelp}>
            Off by default. Discovery is temporary and pairing requires matching codes.
          </Text>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {discoveryUnavailable ? (
          <Text style={styles.errorText}>Automatic device discovery is unavailable.</Text>
        ) : null}
        {discoveryFallback ? (
          <Text style={styles.settingsFieldHelp}>Using the available discovery fallback.</Text>
        ) : null}
        {!error || status ? (
          <>
            <SettingToggle
              disabled={busy}
              label="Enable Nearby Cybara"
              onPress={() => {
                const next = { ...settings, enabled: !settings.enabled };
                setSettings(next);
                void run(() => api.updateNearbySettings(next));
              }}
              tone={colors.cyan}
              value={settings.enabled}
            />
            {settings.enabled ? (
              <>
                <SettingToggle
                  disabled={busy}
                  label="Discoverable whenever enabled"
                  onPress={() => {
                    const next = { ...settings, autoAdvertise: !settings.autoAdvertise };
                    setSettings(next);
                    void run(() => api.updateNearbySettings(next));
                  }}
                  tone={colors.cyan}
                  value={settings.autoAdvertise}
                />
                <SettingsTextField
                  label="Device name"
                  value={settings.displayName}
                  onChangeText={(displayName) => setSettings({ ...settings, displayName })}
                />
                <View style={styles.settingsActionRow}>
                  <DetailActionButton
                    Icon={Check}
                    busy={busy}
                    disabled={busy}
                    label="Save"
                    onPress={() => void run(() => api.updateNearbySettings(settings))}
                    tone={colors.cyan}
                  />
                  <DetailActionButton
                    Icon={RefreshCw}
                    busy={busy}
                    disabled={busy}
                    label="Refresh Devices"
                    onPress={() => void run(() => api.refreshNearbyDiscovery())}
                    tone={colors.cyan}
                  />
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </View>

      {settings.enabled ? (
        <View style={styles.settingsInfoBox}>
          <Text style={styles.settingsInfoTitle}>Connect by LAN address</Text>
          <Text style={styles.settingsFieldHelp}>
            Use an address shown on the other Cybara when automatic discovery is unavailable.
          </Text>
          <SettingsTextField label="Address" value={pairAddress} onChangeText={setPairAddress} />
          <DetailActionButton
            Icon={Link2}
            busy={busy}
            disabled={busy || !pairAddress.trim()}
            label="Connect"
            onPress={() => {
              const value = pairAddress.trim();
              const baseUrl = /^https?:\/\//i.test(value) ? value : `http://${value}`;
              void run(() => api.pairNearbyByAddress(baseUrl));
            }}
            tone={colors.cyan}
          />
          {status?.localAddresses.map((address) => (
            <Text key={address} selectable style={styles.settingsFieldHelp}>
              This device: {address.replace(/^https?:\/\//, "")}
            </Text>
          ))}
        </View>
      ) : null}

      {status?.discoveredPeers.map((peer) => (
        <View key={peer.id} style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <Laptop color={colors.textMuted} size={17} />
            <Text style={styles.settingsInfoTitle}>{peer.name}</Text>
          </View>
          <DetailActionButton
            Icon={Link2}
            busy={busy}
            disabled={busy}
            label="Connect"
            onPress={() => void run(() => api.pairNearby(peer.id, peer.baseUrl))}
            tone={colors.cyan}
          />
        </View>
      ))}

      {status?.pairings.map((pairing) => (
        <View key={pairing.id} style={styles.settingsInfoBox}>
          <Text style={styles.settingsInfoTitle}>{pairing.peerName}</Text>
          <Text selectable style={styles.settingsInfoText}>
            {pairing.verificationCode}
          </Text>
          <Text style={styles.settingsFieldHelp}>
            Confirm only if the code matches the other device.
          </Text>
          {!pairing.localConfirmed ? (
            <DetailActionButton
              Icon={Check}
              busy={busy}
              disabled={busy}
              label="Codes Match"
              onPress={() => void run(() => api.confirmNearbyPairing(pairing.id))}
              tone={colors.cyan}
            />
          ) : null}
        </View>
      ))}

      {status?.pairedPeers.map((peer) => (
        <View key={peer.id} style={styles.settingsInfoBox}>
          <View style={styles.settingsInfoHeader}>
            <Laptop color={colors.textMuted} size={17} />
            <View style={styles.listText}>
              <Text style={styles.settingsInfoTitle}>{peer.name}</Text>
              <Text style={styles.settingsFieldHelp}>Verified {peer.fingerprint.slice(0, 12)}</Text>
            </View>
          </View>
          <SettingToggle
            disabled={busy}
            label="Auto-import shared chats"
            onPress={() => void run(() => api.updateNearbyPeer(peer.id, !peer.syncEnabled))}
            tone={colors.cyan}
            value={peer.syncEnabled}
          />
          <DetailActionButton
            Icon={Trash2}
            busy={busy}
            disabled={busy}
            label="Remove"
            onPress={() => void run(() => api.removeNearbyPeer(peer.id))}
            tone={colors.red}
          />
        </View>
      ))}

      {status?.incomingTransfers.map((transfer) => (
        <View key={transfer.id} style={styles.settingsInfoBox}>
          <Text style={styles.settingsInfoTitle}>{transfer.title || "Shared chat"}</Text>
          <Text style={styles.settingsInfoText}>
            From {transfer.peerName} · {transfer.messageCount} messages
          </Text>
          <DetailActionButton
            Icon={Check}
            busy={busy}
            disabled={busy}
            label="Accept"
            onPress={() => void run(() => api.acceptNearbyTransfer(transfer.id))}
            tone={colors.cyan}
          />
        </View>
      ))}
    </SettingsSection>
  );
}
