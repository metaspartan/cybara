import { Bot, ChevronRight, MessagesSquare, Plus, Search, UsersRound } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { ROOM_MODE_LABELS } from "cybara-shared/room-mode";
import type { CybaraMobileApi } from "../lib/api";
import {
  deleteMobileBot,
  ensureMobileBotSession,
  listMobileBots,
  type MobileBotSummary,
  updateMobileBot,
} from "../lib/apiBots";
import type { AgentSummary, SessionSummary } from "../lib/api-types";
import { compactLastUpdatedLabel } from "../lib/dashboard";
import { haptics } from "../lib/haptics";
import { colors } from "../theme/liquidGlass";
import {
  botPreviewText,
  botRoleLabel,
  botUpdatedLabel,
  filterMobileBots,
  roomSessions,
} from "./dashboardBots";
import { BotAvatar } from "./dashboardBotAvatar";
import { botStyles as styles } from "./dashboardBotsStyles";
import { MobileBotCreateSheet } from "./dashboardBotCreateSheet";
import { MobileRoomCreateSheet } from "./dashboardRoomCreateSheet";
import { EmptyState, LoadingState } from "./dashboardPrimitives";

export function BotsPanel({
  api,
  agents,
  sessions,
  activeSessionIds,
  openSession,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  agents: AgentSummary[];
  sessions: SessionSummary[];
  activeSessionIds: readonly string[];
  openSession: (sessionId: string) => void;
  refreshSummary: () => void;
}) {
  const [bots, setBots] = useState<MobileBotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadBots = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        setBots(await listMobileBots(api));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setRefreshing(false);
      }
    },
    [api]
  );

  useEffect(() => {
    void loadBots(true);
  }, [loadBots]);

  const visibleBots = useMemo(
    () => filterMobileBots(bots ?? [], query, showHidden),
    [bots, query, showHidden]
  );
  const hiddenCount = (bots ?? []).filter((bot) => bot.hidden).length;
  const rooms = useMemo(() => roomSessions(sessions), [sessions]);
  const activeIds = useMemo(() => new Set(activeSessionIds), [activeSessionIds]);

  const openBot = async (bot: MobileBotSummary) => {
    if (openingId) return;
    setOpeningId(bot.id);
    haptics.select();
    try {
      const sessionId = await ensureMobileBotSession(api, bot.id);
      openSession(sessionId);
    } catch (cause) {
      Alert.alert("Could not open bot", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpeningId(null);
    }
  };

  const toggleBotFlag = async (
    bot: MobileBotSummary,
    patch: { hidden?: boolean; pinned?: boolean }
  ) => {
    try {
      await updateMobileBot(api, bot.id, patch);
      await loadBots(true);
    } catch (cause) {
      Alert.alert("Could not update bot", cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removeBot = async (bot: MobileBotSummary) => {
    try {
      haptics.warning();
      await deleteMobileBot(api, bot.id);
      haptics.success();
      await loadBots(true);
      refreshSummary();
    } catch (cause) {
      Alert.alert("Could not delete bot", cause instanceof Error ? cause.message : String(cause));
    }
  };

  const showBotActions = (bot: MobileBotSummary) => {
    haptics.medium();
    Alert.alert(bot.name, botRoleLabel(bot), [
      {
        text: bot.pinned ? "Unpin" : "Pin",
        onPress: () => void toggleBotFlag(bot, { pinned: !bot.pinned }),
      },
      {
        text: bot.hidden ? "Unhide" : "Hide",
        onPress: () => void toggleBotFlag(bot, { hidden: !bot.hidden }),
      },
      {
        text: "Delete bot",
        style: "destructive",
        onPress: () =>
          Alert.alert(
            "Delete bot",
            `Delete ${bot.name}, its conversation, agent configuration, and routines?`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => void removeBot(bot) },
            ]
          ),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const confirmDeleteRoom = (room: SessionSummary) => {
    haptics.medium();
    Alert.alert(
      room.title || "Untitled room",
      "Delete this group room and its shared transcript? The bots keep their own chats.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete room",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                haptics.warning();
                await api.deleteSession(room.id);
                haptics.success();
                refreshSummary();
              } catch (cause) {
                Alert.alert(
                  "Could not delete room",
                  cause instanceof Error ? cause.message : String(cause)
                );
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void loadBots();
            refreshSummary();
          }}
          tintColor={colors.textMuted}
        />
      }
    >
      <View style={styles.actionRow}>
        <Pressable
          onPress={() => setCreateOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primaryAction, pressed && styles.actionPressed]}
        >
          <Plus size={16} color={colors.text} />
          <Text style={styles.primaryActionText}>New bot</Text>
        </Pressable>
        <Pressable
          onPress={() => setRoomOpen(true)}
          disabled={(bots ?? []).filter((bot) => !bot.hidden).length < 2}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.secondaryAction,
            (bots ?? []).filter((bot) => !bot.hidden).length < 2 && styles.actionDisabled,
            pressed && styles.actionPressed,
          ]}
        >
          <MessagesSquare size={16} color={colors.text} />
          <Text style={styles.secondaryActionText}>New room</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Search size={14} color={colors.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search bots"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {hiddenCount > 0 ? (
          <Pressable onPress={() => setShowHidden((value) => !value)} style={styles.hiddenToggle}>
            <Text style={styles.hiddenToggleText}>
              {showHidden ? "Hide hidden" : `${hiddenCount} hidden`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Bots</Text>
        <Text style={styles.sectionCount}>{visibleBots.length}</Text>
      </View>
      {bots === null && !error ? (
        <LoadingState label="Loading bots" detail="Fetching your bot roster from the gateway." />
      ) : error ? (
        <EmptyState label="Bots unavailable" detail={error} />
      ) : visibleBots.length === 0 ? (
        <EmptyState
          label={query ? "No bots match" : "No bots yet"}
          detail={
            query
              ? "Try a different name, role, or model."
              : "Create a bot to give an agent a durable name, role, and its own persistent chat."
          }
        />
      ) : (
        <View style={styles.list}>
          {visibleBots.map((bot) => {
            const active = activeIds.has(bot.sessionId);
            return (
              <Pressable
                key={bot.id}
                onPress={() => void openBot(bot)}
                onLongPress={() => showBotActions(bot)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View>
                  <BotAvatar id={bot.id} name={bot.name} />
                  {active ? <View style={styles.presenceDot} /> : null}
                </View>
                <View style={styles.rowText}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {bot.name}
                    </Text>
                    {bot.pinned ? <View style={styles.pinDot} /> : null}
                    <Text style={styles.rowTime}>{botUpdatedLabel(bot)}</Text>
                  </View>
                  <Text style={styles.rowRole} numberOfLines={1}>
                    {botRoleLabel(bot)}
                    {bot.model ? ` · ${bot.model}` : ""}
                  </Text>
                  <Text style={styles.rowPreview} numberOfLines={2}>
                    {botPreviewText(bot)}
                  </Text>
                </View>
                {openingId === bot.id ? (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                ) : (
                  <ChevronRight size={16} color={colors.textDim} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Rooms</Text>
        <Text style={styles.sectionCount}>{rooms.length}</Text>
      </View>
      {rooms.length === 0 ? (
        <EmptyState
          label="No group rooms"
          detail="Start a room to put several bots in one shared conversation."
        />
      ) : (
        <View style={styles.list}>
          {rooms.map((room) => {
            const active = activeIds.has(room.id);
            return (
              <Pressable
                key={room.id}
                onPress={() => {
                  haptics.select();
                  openSession(room.id);
                }}
                onLongPress={() => confirmDeleteRoom(room)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.roomIcon}>
                  {active ? (
                    <ActivityIndicator size="small" color={colors.cyan} />
                  ) : (
                    <UsersRound size={18} color={colors.cyan} />
                  )}
                </View>
                <View style={styles.rowText}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {room.title || "Untitled room"}
                    </Text>
                    <Text style={styles.rowTime}>{compactLastUpdatedLabel(room)}</Text>
                  </View>
                  <Text style={styles.rowRole} numberOfLines={1}>
                    {room.room ? ROOM_MODE_LABELS[room.room.mode] : "Room"}
                    {room.room ? ` · ${room.room.participant_agent_ids.length} bots` : ""}
                  </Text>
                  {room.last_message?.content ? (
                    <Text style={styles.rowPreview} numberOfLines={2}>
                      {room.last_message.content}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight size={16} color={colors.textDim} />
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.footerNote}>
        <Bot size={12} color={colors.textDim} />
        <Text style={styles.footerNoteText}>
          Long-press a bot to pin, hide, or delete it, and a room to delete it. Bots keep their own
          memory and chat history.
        </Text>
      </View>

      <MobileBotCreateSheet
        api={api}
        agents={agents}
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(bot) => {
          setCreateOpen(false);
          void loadBots(true);
          refreshSummary();
          openSession(bot.sessionId);
        }}
      />
      <MobileRoomCreateSheet
        api={api}
        bots={(bots ?? []).filter((bot) => !bot.hidden)}
        visible={roomOpen}
        onClose={() => setRoomOpen(false)}
        onCreated={(sessionId) => {
          setRoomOpen(false);
          refreshSummary();
          openSession(sessionId);
        }}
      />
    </ScrollView>
  );
}
