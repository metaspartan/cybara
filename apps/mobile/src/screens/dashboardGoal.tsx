import { Check, Clock3, Pause, Play, Square, Target } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import type {
  CybaraMobileApi,
  MobileSessionGoal,
  MobileSessionGoalAction,
  MobileSessionGoalStatus,
} from "../lib/api";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";

const STATUS_LABELS: Record<MobileSessionGoalStatus, string> = {
  active: "Working",
  paused: "Paused",
  blocked: "Blocked",
  complete: "Complete",
};

function mobileGoalStatusColor(status: MobileSessionGoalStatus): string {
  if (status === "active") return colors.green;
  if (status === "paused") return colors.amber;
  if (status === "blocked") return colors.red;
  return colors.cyan;
}

export function mobileGoalElapsedMs(goal: MobileSessionGoal, nowMs: number): number {
  const accumulated =
    typeof goal.activeMs === "number" && Number.isFinite(goal.activeMs) ? goal.activeMs : 0;
  if (goal.status !== "active") return accumulated;
  const resumedAt = Date.parse(goal.lastResumedAt ?? goal.createdAt);
  return accumulated + (Number.isFinite(resumedAt) ? Math.max(0, nowMs - resumedAt) : 0);
}

export function mobileGoalElapsedLabel(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function MobileGoalActionButton({
  action,
  busy,
  label,
  onPress,
}: {
  action: MobileSessionGoalAction;
  busy: boolean;
  label: string;
  onPress: () => void;
}) {
  const Icon =
    action === "pause"
      ? Pause
      : action === "resume"
        ? Play
        : action === "complete"
          ? Check
          : Square;
  return (
    <Pressable
      accessibilityLabel={`${label} goal`}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mobileGoalAction,
        action === "clear" && styles.mobileGoalActionDanger,
        pressed && styles.mobileGoalActionPressed,
        busy && styles.mobileGoalActionDisabled,
      ]}
    >
      <Icon
        color={action === "clear" ? colors.red : colors.textMuted}
        size={13}
        strokeWidth={2.3}
      />
      <Text
        style={[
          styles.mobileGoalActionText,
          action === "clear" && styles.mobileGoalActionDangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MobileGoalCard({
  api,
  sessionId,
  working,
}: {
  api: CybaraMobileApi;
  sessionId: string;
  working: boolean;
}) {
  const [goal, setGoal] = useState<MobileSessionGoal | null>(null);
  const [busyAction, setBusyAction] = useState<MobileSessionGoalAction | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestGeneration = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++requestGeneration.current;
    try {
      const nextGoal = await api.sessionGoal(sessionId);
      if (requestGeneration.current === generation) setGoal(nextGoal);
    } catch {
      return;
    }
  }, [api, sessionId]);

  useEffect(() => {
    setGoal(null);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(timer);
      requestGeneration.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (goal?.status !== "active") return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [goal?.status]);

  const runAction = useCallback(
    async (action: MobileSessionGoalAction): Promise<void> => {
      if (busyAction) return;
      setBusyAction(action);
      try {
        const nextGoal = await api.updateSessionGoal(sessionId, action);
        requestGeneration.current += 1;
        setGoal(nextGoal);
      } catch (error) {
        Alert.alert(
          "Unable to update goal",
          error instanceof Error ? error.message : "Request failed."
        );
      } finally {
        setBusyAction(null);
      }
    },
    [api, busyAction, sessionId]
  );

  if (!goal) return null;
  const statusColor = mobileGoalStatusColor(goal.status);
  const iterations = goal.loop?.iterations ?? 0;
  const checkpoint =
    goal.loop?.stoppedReason === "max_iterations" ||
    goal.loop?.stoppedReason === "max_duration" ||
    goal.loop?.stoppedReason === "error";
  const confirmAction = (action: "complete" | "clear"): void => {
    Alert.alert(
      action === "clear" ? "Clear this goal?" : "Mark this goal complete?",
      action === "clear"
        ? "The goal and its autonomous loop state will be removed."
        : "The autonomous loop will stop for this goal.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action === "clear" ? "Clear" : "Complete",
          style: action === "clear" ? "destructive" : "default",
          onPress: () => void runAction(action),
        },
      ]
    );
  };

  return (
    <View accessibilityLabel={`Goal ${STATUS_LABELS[goal.status]}`} style={styles.mobileGoalCard}>
      <View style={styles.mobileGoalHeader}>
        <Target color={colors.textMuted} size={17} strokeWidth={2.2} />
        <Text numberOfLines={2} style={styles.mobileGoalObjective}>
          {goal.objective}
        </Text>
        {working && goal.status === "active" ? (
          <ActivityIndicator color={colors.green} size="small" />
        ) : null}
      </View>
      <View style={styles.mobileGoalMetaRow}>
        <View style={styles.mobileGoalStatus}>
          <View style={[styles.mobileGoalStatusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.mobileGoalStatusText, { color: statusColor }]}>
            {STATUS_LABELS[goal.status]}
          </Text>
        </View>
        <View style={styles.mobileGoalMetaItem}>
          <Clock3 color={colors.textDim} size={12} strokeWidth={2.2} />
          <Text style={styles.mobileGoalMetaText}>
            {mobileGoalElapsedLabel(mobileGoalElapsedMs(goal, nowMs))}
          </Text>
        </View>
        {iterations > 0 ? (
          <Text style={styles.mobileGoalMetaText}>Iteration {iterations}</Text>
        ) : null}
        {checkpoint ? <Text style={styles.mobileGoalCheckpoint}>Checkpoint</Text> : null}
      </View>
      {goal.lastStatusNote ? (
        <Text numberOfLines={2} style={styles.mobileGoalNote}>
          {goal.lastStatusNote}
        </Text>
      ) : null}
      <View style={styles.mobileGoalActions}>
        {goal.status === "active" ? (
          <MobileGoalActionButton
            action="pause"
            busy={busyAction !== null}
            label="Pause"
            onPress={() => void runAction("pause")}
          />
        ) : (
          <MobileGoalActionButton
            action="resume"
            busy={busyAction !== null}
            label="Resume"
            onPress={() => void runAction("resume")}
          />
        )}
        {goal.status !== "complete" ? (
          <MobileGoalActionButton
            action="complete"
            busy={busyAction !== null}
            label="Complete"
            onPress={() => confirmAction("complete")}
          />
        ) : null}
        <MobileGoalActionButton
          action="clear"
          busy={busyAction !== null}
          label="Clear"
          onPress={() => confirmAction("clear")}
        />
      </View>
    </View>
  );
}
