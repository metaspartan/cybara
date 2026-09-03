import { Check } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import {
  ROOM_DISCUSSION_MODES,
  ROOM_MAX_PARTICIPANTS,
  ROOM_MAX_ROUNDS,
  ROOM_MODE_DESCRIPTIONS,
  ROOM_MODE_LABELS,
  type RoomDiscussionMode,
} from "cybara-shared/room-mode";
import type { CybaraMobileApi } from "../lib/api";
import { createMobileRoom, type MobileBotSummary } from "../lib/apiBots";
import { haptics } from "../lib/haptics";
import { GlassButton } from "../components/Glass";
import { BotAvatar } from "./dashboardBotAvatar";
import { botRoleLabel } from "./dashboardBots";
import { botStyles as styles } from "./dashboardBotsStyles";

export function MobileRoomCreateSheet({
  api,
  bots,
  visible,
  onClose,
  onCreated,
}: {
  api: CybaraMobileApi;
  bots: MobileBotSummary[];
  visible: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<RoomDiscussionMode>("round_robin");
  const [maxRounds, setMaxRounds] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    haptics.select();
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= ROOM_MAX_PARTICIPANTS) return current;
      return [...current, id];
    });
  };

  const submit = async () => {
    if (busy || selectedIds.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const room = await createMobileRoom(api, {
        participantAgentIds: selectedIds,
        mode,
        maxRounds,
      });
      haptics.success();
      setSelectedIds([]);
      onCreated(room.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Start group room</Text>
          <Text style={styles.sheetDetail}>
            Pick up to {ROOM_MAX_PARTICIPANTS} bots to share one transcript. Each keeps its own role
            and memory.
          </Text>
          <ScrollView contentContainerStyle={{ gap: 8 }}>
            {bots.map((bot) => {
              const selected = selectedIds.includes(bot.id);
              return (
                <Pressable
                  key={bot.id}
                  onPress={() => toggle(bot.id)}
                  style={[styles.selectRow, selected && styles.selectRowActive]}
                >
                  <BotAvatar id={bot.id} name={bot.name} size={34} />
                  <View style={styles.selectText}>
                    <Text style={styles.selectTitle} numberOfLines={1}>
                      {bot.name}
                    </Text>
                    <Text style={styles.selectDetail} numberOfLines={1}>
                      {botRoleLabel(bot)}
                      {bot.model ? ` · ${bot.model}` : ""}
                    </Text>
                  </View>
                  <View style={[styles.check, selected && styles.checkActive]}>
                    {selected ? <Check size={13} color="#000" /> : null}
                  </View>
                </Pressable>
              );
            })}
            <Text style={styles.fieldLabel}>Discussion mode</Text>
            <View style={styles.chipRail}>
              {ROOM_DISCUSSION_MODES.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setMode(option)}
                  style={[styles.chip, mode === option && styles.chipActive]}
                >
                  <Text style={[styles.chipText, mode === option && styles.chipTextActive]}>
                    {ROOM_MODE_LABELS[option]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.sheetDetail}>{ROOM_MODE_DESCRIPTIONS[mode]}</Text>
            <Text style={styles.fieldLabel}>Rounds per message</Text>
            <View style={styles.chipRail}>
              {Array.from({ length: ROOM_MAX_ROUNDS }, (_, index) => index + 1).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setMaxRounds(value)}
                  style={[styles.chip, maxRounds === value && styles.chipActive]}
                >
                  <Text style={[styles.chipText, maxRounds === value && styles.chipTextActive]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.sheetActions}>
            <GlassButton label="Cancel" onPress={onClose} disabled={busy} />
            <GlassButton
              label={busy ? "Starting..." : "Start room"}
              onPress={() => void submit()}
              disabled={busy || selectedIds.length < 2}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
