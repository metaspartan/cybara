import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CalendarCheck, MessageSquare } from "lucide-react-native";
import { GlassPanel } from "./Glass";
import { CybaraMobileApi, type AgentSummary, type SessionSummary } from "../lib/api";
import { colors, radius, spacing, subscribeColors, typography } from "../theme/liquidGlass";

const SCHEDULE_PRESETS: Array<{ value: string; label: string }> = [
  { value: "*/15 * * * *", label: "Every 15 min" },
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 9 * * *", label: "Daily 9am" },
  { value: "0 9 * * 1", label: "Weekly (Mon)" },
  { value: "custom", label: "Custom cron" },
];

export function NewTaskPanel({
  accentColor,
  agents,
  api,
  onCreated,
}: {
  accentColor: string;
  agents: AgentSummary[];
  api: CybaraMobileApi;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [action, setAction] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    agents.find((agent) => agent.status === "running")?.id || agents[0]?.id
  );
  const [schedulePreset, setSchedulePreset] = useState<string>("0 9 * * *");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [customCron, setCustomCron] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schedule = schedulePreset === "custom" ? customCron.trim() : schedulePreset;
  const canCreate = Boolean(name.trim() && action.trim() && schedule);

  useEffect(() => {
    let active = true;
    void api
      .sessions()
      .then((items) => {
        if (active) setSessions(items);
      })
      .catch(() => {
        if (active) setSessions([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const create = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.createTask({
        name: name.trim(),
        action: action.trim(),
        agent_id: selectedAgentId,
        session_id: selectedSessionId,
        schedule,
        enabled: true,
      });
      if (result.success === false) {
        throw new Error("The gateway rejected the task.");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <GlassPanel elevated style={styles.panel}>
      <Text style={styles.sectionTitle}>Task name</Text>
      <View style={styles.field}>
        <TextInput
          editable={!creating}
          onChangeText={setName}
          placeholder="Daily report"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          value={name}
        />
      </View>

      <Text style={styles.sectionTitle}>Agent</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
        <Pressable
          onPress={() => setSelectedAgentId(undefined)}
          style={[
            styles.agentChip,
            !selectedAgentId && [styles.agentChipActive, { borderColor: accentColor }],
          ]}
        >
          <Text style={[styles.agentChipTitle, !selectedAgentId && { color: accentColor }]}>
            Gateway default
          </Text>
          <Text style={styles.agentChipDetail}>Auto route</Text>
        </Pressable>
        {agents.map((agent) => {
          const selected = selectedAgentId === agent.id;
          return (
            <Pressable
              key={agent.id}
              onPress={() => setSelectedAgentId(agent.id)}
              style={[
                styles.agentChip,
                selected && [styles.agentChipActive, { borderColor: accentColor }],
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.agentChipTitle, selected && { color: accentColor }]}
              >
                {agent.name}
              </Text>
              <Text numberOfLines={1} style={styles.agentChipDetail}>
                {[agent.model, agent.status].filter(Boolean).join(" - ") || "Configured"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.sectionTitle}>Chat context</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker}>
        <Pressable
          onPress={() => setSelectedSessionId(undefined)}
          style={[
            styles.agentChip,
            !selectedSessionId && [styles.agentChipActive, { borderColor: accentColor }],
          ]}
        >
          <CalendarCheck
            color={!selectedSessionId ? accentColor : colors.textMuted}
            size={17}
            strokeWidth={2.2}
          />
          <Text style={[styles.agentChipTitle, !selectedSessionId && { color: accentColor }]}>
            New chat
          </Text>
          <Text style={styles.agentChipDetail}>Separate chat each run</Text>
        </Pressable>
        {sessions.map((session) => {
          const selected = selectedSessionId === session.id;
          return (
            <Pressable
              key={session.id}
              onPress={() => setSelectedSessionId(session.id)}
              style={[
                styles.agentChip,
                selected && [styles.agentChipActive, { borderColor: accentColor }],
              ]}
            >
              <MessageSquare
                color={selected ? accentColor : colors.textMuted}
                size={17}
                strokeWidth={2.2}
              />
              <Text
                numberOfLines={1}
                style={[styles.agentChipTitle, selected && { color: accentColor }]}
              >
                {session.title?.trim() || `Chat ${session.id.slice(0, 8)}`}
              </Text>
              <Text numberOfLines={1} style={styles.agentChipDetail}>
                {session.message_count} messages
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.sectionTitle}>Action</Text>
      <View style={[styles.field, styles.multilineField]}>
        <TextInput
          editable={!creating}
          multiline
          onChangeText={setAction}
          placeholder="What should the agent do on each run?"
          placeholderTextColor={colors.textDim}
          style={[styles.input, styles.multilineInput]}
          textAlignVertical="top"
          value={action}
        />
      </View>

      <Text style={styles.sectionTitle}>Schedule</Text>
      <View style={styles.chipRow}>
        {SCHEDULE_PRESETS.map((preset) => {
          const selected = schedulePreset === preset.value;
          return (
            <Pressable
              key={preset.value}
              onPress={() => setSchedulePreset(preset.value)}
              style={[
                styles.scheduleChip,
                selected && [styles.scheduleChipActive, { borderColor: accentColor }],
              ]}
            >
              <Text style={[styles.scheduleChipText, selected && { color: accentColor }]}>
                {preset.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {schedulePreset === "custom" ? (
        <View style={styles.field}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!creating}
            onChangeText={setCustomCron}
            placeholder="*/30 * * * *"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={customCron}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityLabel="Create task"
        accessibilityRole="button"
        disabled={!canCreate || creating}
        onPress={create}
        style={[
          styles.createButton,
          {
            backgroundColor: canCreate ? accentColor : colors.inset,
            opacity: canCreate || creating ? 1 : 0.55,
          },
        ]}
      >
        {creating ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <>
            <CalendarCheck color={colors.text} size={18} strokeWidth={2.3} />
            <Text style={styles.createButtonText}>Create task</Text>
          </>
        )}
      </Pressable>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Could not create task</Text>
          <Text style={styles.errorDetail}>{error}</Text>
        </View>
      ) : null}
    </GlassPanel>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    panel: {
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.textMuted,
      fontSize: typography.label,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    field: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.md,
    },
    multilineField: {
      minHeight: 96,
      paddingVertical: spacing.xs,
    },
    input: {
      color: colors.text,
      fontSize: typography.body,
      includeFontPadding: false,
      minHeight: 46,
    },
    multilineInput: {
      lineHeight: 20,
      minHeight: 84,
      paddingTop: spacing.sm,
    },
    picker: {
      marginHorizontal: -spacing.xs,
    },
    agentChip: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 3,
      marginHorizontal: spacing.xs,
      minHeight: 64,
      padding: spacing.md,
      width: 168,
    },
    agentChipActive: {
      backgroundColor: colors.softCyan,
    },
    agentChipTitle: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "700",
    },
    agentChipDetail: {
      color: colors.textMuted,
      fontSize: typography.tiny,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    scheduleChip: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      minHeight: 40,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
    },
    scheduleChipActive: {
      backgroundColor: colors.softCyan,
    },
    scheduleChipText: {
      color: colors.text,
      fontSize: typography.label,
      fontWeight: "600",
    },
    createButton: {
      alignItems: "center",
      borderRadius: radius.md,
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "center",
      marginTop: spacing.xs,
      minHeight: 50,
    },
    createButtonText: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "800",
    },
    errorBox: {
      alignItems: "center",
      borderColor: colors.softRedBorder,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: spacing.xs,
      padding: spacing.md,
    },
    errorTitle: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "800",
    },
    errorDetail: {
      color: colors.textMuted,
      fontSize: typography.label,
      textAlign: "center",
    },
  });

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
