import { Settings2, Square, UsersRound } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ROOM_DISCUSSION_MODES,
  ROOM_MAX_ROUNDS,
  ROOM_MODE_DESCRIPTIONS,
  ROOM_MODE_LABELS,
  type RoomDiscussionMode,
} from "cybara-shared/room-mode";
import type { CybaraMobileApi } from "../lib/api";
import { speakInMobileRoom, updateMobileRoom } from "../lib/apiBots";
import type { AgentSummary, SessionRoomConfig } from "../lib/api-types";
import { haptics } from "../lib/haptics";
import { colors, radius, spacing } from "../theme/liquidGlass";
import { botAvatarColors, botAvatarInitials, roomModeSummary } from "./dashboardBots";

interface MobileRoomBannerProps {
  api: CybaraMobileApi;
  sessionId: string;
  room: SessionRoomConfig;
  agents: readonly AgentSummary[];
  busy: boolean;
  onChanged: () => void;
  onStop: () => void;
}

export function MobileRoomBanner({
  api,
  sessionId,
  room,
  agents,
  busy,
  onChanged,
  onStop,
}: MobileRoomBannerProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const participants = room.participant_agent_ids.map(
    (id) => agents.find((agent) => agent.id === id) ?? { id, name: id.slice(0, 8) }
  );

  const speak = async (agentId: string) => {
    if (busy || pending) return;
    setPending(true);
    haptics.select();
    try {
      await speakInMobileRoom(api, sessionId, agentId);
    } catch (error) {
      Alert.alert("Could not ask agent", error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const update = async (patch: { mode?: RoomDiscussionMode; maxRounds?: number }) => {
    if (pending) return;
    setPending(true);
    try {
      await updateMobileRoom(api, sessionId, patch);
      onChanged();
    } catch (error) {
      Alert.alert("Could not update room", error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={bannerStyles.card}>
      <View style={bannerStyles.headerRow}>
        <UsersRound size={14} color={colors.textDim} />
        <Text style={bannerStyles.headerLabel}>
          {roomModeSummary({
            mode: room.mode,
            maxRounds: room.max_rounds,
          })}
        </Text>
        <View style={bannerStyles.headerSpacer} />
        {busy ? (
          <Pressable
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="End discussion"
            style={bannerStyles.stopButton}
          >
            <Square size={12} color="#fca5a5" />
            <Text style={bannerStyles.stopText}>End</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setSettingsOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel="Room settings"
          style={[bannerStyles.iconButton, settingsOpen && bannerStyles.iconButtonActive]}
        >
          <Settings2 size={14} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bannerStyles.chipRail}>
        {participants.map((agent) => {
          const [from, to] = botAvatarColors(agent.id);
          return (
            <Pressable
              key={agent.id}
              onPress={() => void speak(agent.id)}
              disabled={busy || pending}
              accessibilityRole="button"
              accessibilityLabel={`Ask ${agent.name} to speak`}
              style={({ pressed }) => [
                bannerStyles.chip,
                (busy || pending) && bannerStyles.chipDisabled,
                pressed && bannerStyles.chipPressed,
              ]}
            >
              <View style={[bannerStyles.avatar, { backgroundColor: from, borderColor: to }]}>
                <Text style={bannerStyles.avatarText}>{botAvatarInitials(agent.name)}</Text>
              </View>
              <Text style={bannerStyles.chipText} numberOfLines={1}>
                {agent.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {settingsOpen ? (
        <View style={bannerStyles.settings}>
          <View style={bannerStyles.modeRow}>
            {ROOM_DISCUSSION_MODES.map((mode) => (
              <Pressable
                key={mode}
                onPress={() => void update({ mode })}
                disabled={pending}
                style={[bannerStyles.modeChip, room.mode === mode && bannerStyles.modeChipActive]}
              >
                <Text
                  style={[
                    bannerStyles.modeChipText,
                    room.mode === mode && bannerStyles.modeChipTextActive,
                  ]}
                >
                  {ROOM_MODE_LABELS[mode]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={bannerStyles.modeDescription}>{ROOM_MODE_DESCRIPTIONS[room.mode]}</Text>
          <View style={bannerStyles.modeRow}>
            <Text style={bannerStyles.roundsLabel}>Rounds</Text>
            {Array.from({ length: ROOM_MAX_ROUNDS }, (_, index) => index + 1).map((value) => (
              <Pressable
                key={value}
                onPress={() => void update({ maxRounds: value })}
                disabled={pending}
                style={[
                  bannerStyles.roundChip,
                  room.max_rounds === value && bannerStyles.modeChipActive,
                ]}
              >
                <Text
                  style={[
                    bannerStyles.modeChipText,
                    room.max_rounds === value && bannerStyles.modeChipTextActive,
                  ]}
                >
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "600",
  },
  headerSpacer: { flex: 1 },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonActive: {
    backgroundColor: colors.surfaceLift,
  },
  stopButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(248,113,113,0.5)",
    backgroundColor: "rgba(248,113,113,0.12)",
  },
  stopText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "600",
  },
  chipRail: {
    flexGrow: 0,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginRight: spacing.xs,
    paddingLeft: 3,
    paddingRight: spacing.sm,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLift,
  },
  chipPressed: { opacity: 0.7 },
  chipDisabled: { opacity: 0.55 },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    maxWidth: 120,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
  },
  settings: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    gap: spacing.xs,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  modeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  roundChip: {
    minWidth: 28,
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modeChipActive: {
    borderColor: colors.cyan,
    backgroundColor: `${colors.cyan}22`,
  },
  modeChipText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "600",
  },
  modeChipTextActive: {
    color: colors.text,
  },
  modeDescription: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 15,
  },
  roundsLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "600",
    marginRight: 2,
  },
});
